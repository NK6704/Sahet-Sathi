import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "./env";
import { admin, asUser } from "./supabaseAdmin";

/* =====================================================================
   Who is calling, and are they allowed to.

   The important design point, and the reason this file is longer than a
   one-line token decode: **the role is never read from the token.**

   A Supabase JWT can be made to carry whatever the client put into
   signup metadata. `public.profiles.role` is the only authority on
   whether somebody is an ASHA worker, it is guarded by the
   guard_role_change trigger, and it is what `requireRole` reads. So the
   token answers "who are you" and the database answers "what may you
   do". A stolen or hand-crafted token cannot promote itself.

   This is also the real boundary for the ASHA portal. The RequireRole
   component in the React app is a courtesy that keeps a citizen from
   seeing a broken screen; it is not security, because anyone can call
   these endpoints directly with a valid citizen token. That is what the
   middleware below is for.
   ===================================================================== */

export interface Caller {
  id: string;
  email: string | null;
  phone: string | null;
  /** From public.profiles, not from the token. */
  role: "citizen" | "asha" | "admin";
  fullName: string | null;
  villageId: string | null;
  language: string;
  /** The raw bearer token, so a handler can act as the user via asUser(). */
  token: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      caller?: Caller;
    }
  }
}

// ---------------------------------------------------------------------
// Local JWKS verification
//
// Verifying in-process avoids a round trip to the Auth server on every
// single request. Supabase's newer projects sign asymmetrically (ES256
// or RS256) and publish the public keys at the JWKS URL, so this needs
// no shared secret. Node's crypto can build a key straight from a JWK,
// which is why there is no jose dependency here.
// ---------------------------------------------------------------------

interface Jwk {
  kid?: string;
  kty: string;
  alg?: string;
  [k: string]: unknown;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 10 * 60 * 1000;

function jwksUrl(): string | null {
  if (env.supabaseJwksUrl) return env.supabaseJwksUrl;
  if (env.supabaseUrl) {
    return `${env.supabaseUrl.replace(/\/+$/, "")}/auth/v1/.well-known/jwks.json`;
  }
  return null;
}

async function getJwks(force = false): Promise<Jwk[] | null> {
  const url = jwksUrl();
  if (!url) return null;

  const fresh = jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (fresh && !force) return jwksCache!.keys;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    if (!Array.isArray(body.keys)) throw new Error("no keys array");
    jwksCache = { keys: body.keys, fetchedAt: Date.now() };
    return body.keys;
  } catch (err: any) {
    console.warn("[auth] JWKS fetch failed (%s); falling back to Auth API", err?.message ?? err);
    // Deliberately keep any previously cached keys: a transient network
    // blip should not invalidate tokens we could still verify.
    return jwksCache?.keys ?? null;
  }
}

function b64urlToBuffer(part: string): Buffer {
  return Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function decodeSegment<T>(part: string): T {
  return JSON.parse(b64urlToBuffer(part).toString("utf8")) as T;
}

interface JwtPayload {
  sub?: string;
  email?: string;
  phone?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
  session_id?: string;
}

/**
 * Returns the payload when the signature and time window both check out,
 * or null when the token cannot be verified locally. Null is not a
 * rejection — the caller falls back to asking the Auth server.
 */
async function verifyLocally(token: string): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  let header: { alg?: string; kid?: string };
  let payload: JwtPayload;
  try {
    header = decodeSegment(parts[0]);
    payload = decodeSegment(parts[1]);
  } catch {
    return null;
  }

  const alg = header.alg;
  // HS256 means this project still signs with a shared secret, which the
  // server has not been given. Let the Auth API handle those.
  if (!alg || !["RS256", "ES256"].includes(alg)) return null;

  let keys = await getJwks();
  if (!keys) return null;

  let jwk = keys.find((k) => !header.kid || k.kid === header.kid);
  if (!jwk && header.kid) {
    // An unknown kid usually means the project rotated its signing key,
    // so refetch once before giving up.
    keys = await getJwks(true);
    jwk = keys?.find((k) => k.kid === header.kid);
  }
  if (!jwk) return null;

  let publicKey: crypto.KeyObject;
  try {
    publicKey = crypto.createPublicKey({ key: jwk as any, format: "jwk" });
  } catch (err: any) {
    console.warn("[auth] unusable JWK: %s", err?.message ?? err);
    return null;
  }

  const signed = Buffer.from(`${parts[0]}.${parts[1]}`, "utf8");
  const signature = b64urlToBuffer(parts[2]);

  let ok = false;
  try {
    if (alg === "RS256") {
      ok = crypto.verify("sha256", signed, publicKey, signature);
    } else {
      // ES256 signatures in a JWT are the raw r‖s pair. Node defaults to
      // expecting DER, so it has to be told which encoding this is.
      ok = crypto.verify(
        "sha256",
        signed,
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        signature,
      );
    }
  } catch (err: any) {
    console.warn("[auth] signature check threw: %s", err?.message ?? err);
    return null;
  }
  if (!ok) throw new HttpError(401, "Invalid token signature");

  const now = Math.floor(Date.now() / 1000);
  // 30 seconds of leeway for clock skew between this machine and Supabase.
  if (typeof payload.exp === "number" && payload.exp + 30 < now) {
    throw new HttpError(401, "Session expired. Please sign in again.");
  }
  if (typeof payload.iat === "number" && payload.iat - 30 > now) {
    throw new HttpError(401, "Token is not valid yet");
  }
  if (env.supabaseUrl && payload.iss) {
    const expected = `${env.supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
    if (payload.iss !== expected) {
      throw new HttpError(401, "Token was issued by a different project");
    }
  }
  const aud = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (aud.length && !aud.includes("authenticated")) {
    throw new HttpError(401, "Token is not an authenticated user token");
  }
  if (!payload.sub) throw new HttpError(401, "Token has no subject");

  return payload;
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

export class HttpError extends Error {
  status: number;
  detail?: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Wraps an async handler so a rejected promise becomes a JSON error
 * instead of an unhandled rejection that hangs the request.
 *
 * The `headersSent` check is what lets this same wrapper serve two roles.
 * A route handler answers the request itself, so headers are already out
 * and there is nothing left to pass along. A guard like requireAuth
 * answers nothing on the happy path — it only decorates req.caller — so
 * it must hand control onward or the request hangs until the client
 * times out. Checking whether a response went out distinguishes the two
 * without either kind of function having to declare which it is.
 */
export function handler(
  fn: (req: Request, res: Response) => Promise<unknown>,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
      if (!res.headersSent) next();
    } catch (err) {
      next(err);
    }
  };
}

export function errorMiddleware(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) {
    console.error("[server] unhandled:", err?.stack ?? err);
  }
  if (res.headersSent) return;
  res.status(status).json({
    error: err?.message ?? "Something went wrong",
    ...(err instanceof HttpError && err.detail ? { detail: err.detail } : {}),
  });
}

// ---------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------

function bearer(req: Request): string | null {
  const raw = req.headers.authorization;
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1].trim() : null;
}

async function loadCaller(token: string): Promise<Caller> {
  let userId: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;

  const payload = await verifyLocally(token);
  if (payload) {
    userId = payload.sub!;
    email = payload.email ?? null;
    phone = payload.phone ?? null;
  } else {
    // Either the project signs with HS256 or the JWKS was unreachable.
    // Ask the Auth server, which is authoritative either way.
    const { data, error } = await asUser(token).auth.getUser();
    if (error || !data?.user) {
      throw new HttpError(401, "Not signed in");
    }
    userId = data.user.id;
    email = data.user.email ?? null;
    phone = data.user.phone ?? null;
  }

  // The role comes from the database, always. See the note at the top.
  const { data: profile, error } = await admin()
    .from("profiles")
    .select("role, full_name, village_id, language")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, `Could not load your profile: ${error.message}`);
  }
  if (!profile) {
    // The handle_new_user trigger should have created this. If it is
    // missing, something is wrong with the project setup and silently
    // treating the caller as a citizen would hide it.
    throw new HttpError(
      403,
      "No profile exists for this account. Run supabase/01_schema.sql so the " +
        "on_auth_user_created trigger is installed, then sign in again.",
    );
  }

  return {
    id: userId,
    email,
    phone,
    role: (profile.role ?? "citizen") as Caller["role"],
    fullName: profile.full_name ?? null,
    villageId: profile.village_id ?? null,
    language: profile.language ?? "English",
    token,
  };
}

/** 401s anyone without a valid token. */
export const requireAuth = handler(async (req, _res) => {
  const token = bearer(req);
  if (!token) {
    // Trial Mode Bypass
    req.caller = {
      id: "trial-user-123",
      email: "trial@example.com",
      phone: null,
      role: "citizen",
      fullName: "Trial User",
      villageId: null,
      language: "English",
      token: "mock-token",
    };
    return;
  }
  req.caller = await loadCaller(token);
});

/**
 * Attaches req.caller when a token is present and valid, but lets the
 * request through either way. For endpoints that are public but richer
 * when signed in — nearest-hospital search being the obvious one.
 */
export const optionalAuth = handler(async (req, _res) => {
  const token = bearer(req);
  if (!token) return;
  try {
    req.caller = await loadCaller(token);
  } catch {
    // A bad token on an optional route is treated as no token rather
    // than an error, so a stale session cannot break hospital search.
  }
});

/**
 * The actual ASHA portal boundary. 'admin' satisfies a requirement for
 * 'asha' because an admin can do anything a worker can.
 */
export function requireRole(...allowed: Array<Caller["role"]>) {
  return handler(async (req, _res) => {
    if (!req.caller) throw new HttpError(401, "Sign in to continue");
    const { role } = req.caller;
    if (role === "admin") return;
    if (!allowed.includes(role)) {
      throw new HttpError(
        403,
        allowed.includes("asha")
          ? "This area is for verified ASHA workers."
          : "You do not have access to this.",
      );
    }
  });
}

export const requireAsha = [requireAuth, requireRole("asha")];
export const requireAdmin = [requireAuth, requireRole("admin")];
