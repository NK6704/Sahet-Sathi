import { env, twilioStatus } from "./env";

/* =====================================================================
   Sending an SMS, and being honest when we cannot.

   This is the whole SMS adapter for the app, and it is deliberately built
   on `fetch` against Twilio's REST API rather than on the `twilio` npm
   package. Adding a dependency to this project is not currently possible,
   and the part of Twilio this app needs is one HTTP POST with basic auth,
   so the package would buy retries and typings we do not use in exchange
   for an install we cannot perform.

   The credential state this file was written against matters, because it
   is the normal state rather than an edge case. TWILIO_API_KEY_SID and
   TWILIO_API_KEY_SECRET are set; TWILIO_ACCOUNT_SID is blank and no
   sender is configured. An API Key SID (`SK…`) authenticates the request
   as a username, but the REST path itself is
   /2010-04-01/Accounts/<AccountSid>/Messages.json, so the Account SID
   (`AC…`) is still required to know *where* to post. Half-configured
   Twilio is therefore the default, and an adapter that only worked when
   fully configured would be an adapter that never worked.

   So the contract here is not "send an SMS". It is "tell the caller
   exactly what happened to each message". Every return value is an
   SmsOutcome carrying a status and, whenever that status is not 'sent',
   a reason written for a human to read. Nothing here throws, and nothing
   here reports a message as sent when it was not: a missing Account SID
   produces a 'skipped' outcome with the variable named in plain words,
   which the SOS route then writes into a sos_deliveries row. Silence with
   a reason attached to it is a record. Silence on its own is a bug that
   looks like a working feature.

   One word deserves pinning down. 'sent' here means Twilio accepted the
   message for delivery and gave back a message SID. It does not mean a
   handset rang. Carrier-level delivery arrives later on a status webhook
   this app does not yet expose, so 'sent' is the strongest truthful claim
   available at the moment of the call and the UI must not upgrade it to
   'delivered'.

   Two standing rules. The API key secret is never logged, never returned
   and never put in a reason string. And no full phone number is ever
   logged: everything that reaches a log or a stored reason goes through
   maskNumber() first, including Twilio's own error text, because Twilio
   is fond of quoting the number back at you inside the message field.
   ===================================================================== */

export type SmsOutcome = {
  /**
   * 'sent' means Twilio accepted it and issued a SID. 'skipped' means we
   * deliberately did not try, and is a first-class outcome rather than a
   * soft failure — it is what a missing credential or an unusable number
   * produces. 'failed' means we tried and Twilio or the network said no.
   */
  status: "sent" | "skipped" | "failed";
  /** Always present for 'skipped' and 'failed'. Written for a human. */
  reason?: string;
  /** Twilio's message SID, only on success. */
  providerId?: string;
  channel: "sms";
};

const TWILIO_API_ROOT = "https://api.twilio.com/2010-04-01";

/**
 * Ten seconds. An SOS is the only thing in this app that sends SMS, and
 * the person who pressed the button is watching a spinner, so a request
 * that has not been answered by then is worth abandoning and recording as
 * failed rather than holding the response open behind it.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * An emergency with twelve emergency contacts must not open twelve
 * sockets at once, both because Twilio rate-limits per account and
 * because a burst of parallel TLS handshakes on a small box is the sort
 * of thing that turns a slow send into a failed one. Five at a time
 * finishes twelve messages in three rounds, which is fast enough that
 * nobody notices and gentle enough that nothing throttles us.
 */
const MAX_CONCURRENT_SENDS = 5;

/**
 * Kept as constants because the SOS route stores them in
 * sos_deliveries.error and a report that groups deliveries by reason is
 * only useful while the strings are stable.
 */
const REASON_INVALID_NUMBER = "not a valid mobile number";
const REASON_EMPTY_BODY = "the message body was empty";
const REASON_NO_MESSAGE_ID =
  "Twilio accepted the request but returned no message id, so this delivery cannot be confirmed";

// ---------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------

/**
 * A real Indian mobile number is ten digits beginning 6, 7, 8 or 9, and
 * this is the rule that lets a bare ten-digit string be given a +91
 * without guessing.
 *
 * What it can and cannot catch is worth stating plainly, because the
 * temptation is to describe it as a landline filter and it is not one. It
 * does reject a landline in a circle whose area code starts 1 to 5 —
 * 011 for Delhi, 022 for Mumbai, 033 for Kolkata, 044 for Chennai — since
 * stripping the trunk zero leaves a leading digit no mobile has. It
 * cannot reject one whose area code starts 6 to 9, and 0755 for Bhopal
 * and 080 for Bangalore both do, so 0755-2440022 becomes +917552440022
 * and is accepted here. There is no way to tell those apart from a mobile
 * by length and leading digit alone; it would take an STD code table this
 * app does not carry.
 *
 * That is a limitation rather than a hole, because of where the mistake
 * surfaces. A landline that gets through is handed to Twilio, Twilio
 * refuses it as unreachable, and the recipient ends up with a 'failed'
 * delivery row carrying Twilio's own explanation. Nobody is told the
 * message arrived. The cost of the gap is one wasted API call and a
 * delivery record that names the problem, which is the right side of the
 * trade compared with rejecting real mobile numbers in Bhopal.
 */
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/**
 * Turns what somebody actually typed into E.164, or returns null.
 *
 * Accepts 98261-55443, 9826155443, 09826155443, +919826155443,
 * 919826155443 and 0091 9826155443, with spaces, hyphens, dots and
 * parentheses anywhere in them, because a phone number copied off a
 * scrap of paper has all of those in it.
 *
 * The one thing it will not do is guess a country code. A number that
 * declares its own — anything starting + or 00 — is taken at its word and
 * only length-checked, since this app has no business deciding that a
 * foreign-looking number is really Indian. A number with no country code
 * is only accepted when it matches the Indian mobile rule above, which is
 * a stated assumption rather than a guess: this is an app for ASHA
 * workers in India and every number in it is a domestic one. Anything
 * else returns null and becomes a 'skipped' delivery, because a message
 * addressed to a number nobody holds is worse than an admitted gap.
 */
export function normaliseMobile(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const cleaned = raw.replace(/[\s\-().]/g, "");
  if (cleaned === "") return null;

  // 00 is the old international access prefix and means exactly what +
  // means. Rewriting it here keeps the branch below to one case.
  const candidate = cleaned.startsWith("00") ? `+${cleaned.slice(2)}` : cleaned;

  if (candidate.startsWith("+")) {
    const digits = candidate.slice(1);
    if (!/^\d+$/.test(digits)) return null;
    // An explicit +91 is still checked against the mobile rule, because
    // the country code being present does not make the rest of it a
    // number that can receive a text.
    if (digits.startsWith("91")) {
      const local = digits.slice(2);
      return INDIAN_MOBILE.test(local) ? `+91${local}` : null;
    }
    // Some other country, already in E.164. E.164 allows fifteen digits
    // at most and nothing shorter than about eight is a subscriber
    // number, so that is the whole of what can be checked from here.
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  if (!/^\d+$/.test(candidate)) return null;

  // A single leading zero is the domestic trunk prefix, which is how
  // every number in India is written down and none is dialled abroad.
  if (candidate.length === 11 && candidate.startsWith("0")) {
    const local = candidate.slice(1);
    return INDIAN_MOBILE.test(local) ? `+91${local}` : null;
  }
  if (candidate.length === 12 && candidate.startsWith("91")) {
    const local = candidate.slice(2);
    return INDIAN_MOBILE.test(local) ? `+91${local}` : null;
  }
  if (candidate.length === 10) {
    return INDIAN_MOBILE.test(candidate) ? `+91${candidate}` : null;
  }

  return null;
}

/**
 * The only form of a phone number that may appear in a log line. Four
 * digits is enough for the person reading the log to match it against a
 * contact they already know about, and not enough to be a phone number.
 */
export function maskNumber(value: unknown): string {
  const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
  if (digits.length < 4) return "****";
  return `****${digits.slice(-4)}`;
}

/**
 * Twilio quotes the number back inside its error text — "The 'To' number
 * +919826155443 is not a valid phone number" is a real message — and
 * that text ends up both in a log line and in sos_deliveries.error. So
 * any run of eight or more digits in a provider message is masked before
 * it is allowed anywhere. Shorter runs are left alone because they are
 * Twilio's own error codes, which are the useful part.
 */
function scrubNumbers(text: string): string {
  return text.replace(/\+?\d[\d\s().-]{5,20}\d/g, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 8 ? maskNumber(match) : match;
  });
}

// ---------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------

/**
 * twilioStatus() reports the missing variables by name, which is right
 * for /api/health but wrong for a screen a villager reads. These phrases
 * are the same facts in words that survive being shown to somebody who
 * has never seen an environment file, while still naming the variable so
 * that whoever has to fix it knows precisely what to set.
 */
const MISSING_PHRASES: Record<string, string> = {
  TWILIO_ACCOUNT_SID: "TWILIO_ACCOUNT_SID",
  TWILIO_API_KEY_SID: "TWILIO_API_KEY_SID",
  TWILIO_API_KEY_SECRET: "TWILIO_API_KEY_SECRET",
  "TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID":
    "a sender (TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID)",
};

function joinPhrases(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function notConfiguredReason(missing: string[]): string {
  const phrases = missing.map((name) => MISSING_PHRASES[name] ?? name);
  const verb = phrases.length === 1 ? "is" : "are";
  return `SMS is not configured: ${joinPhrases(phrases)} ${verb} not set`;
}

/**
 * Answerable without sending anything, which is the point of it. The SOS
 * config endpoint calls this so the UI can warn somebody that SMS is not
 * wired up *before* the emergency rather than during it, and the same
 * reason string is what every skipped delivery row will carry, so the
 * warning and the record agree word for word.
 */
export function smsAvailability(): { ready: boolean; reason: string | null } {
  const status = twilioStatus();
  if (status.ready) return { ready: true, reason: null };
  return { ready: false, reason: notConfiguredReason(status.missing) };
}

// ---------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------

/**
 * Turns a non-2xx from Twilio into something somebody can act on.
 * "failed" on its own tells a supervisor nothing; Twilio's own `message`
 * field usually says exactly what is wrong, and its numeric `code` is
 * what their documentation is indexed by, so both are carried through.
 */
function rejectionReason(httpStatus: number, payload: any): string {
  const message =
    typeof payload?.message === "string" && payload.message.trim() !== ""
      ? scrubNumbers(payload.message.trim())
      : null;
  const code = typeof payload?.code === "number" ? payload.code : null;
  const where =
    code === null ? `HTTP ${httpStatus}` : `HTTP ${httpStatus}, Twilio code ${code}`;

  // Called out separately because this is the exact failure the comment
  // at the top of env.ts warns about: an API key that is valid in itself
  // but does not belong to the account named in the URL. Left as a
  // generic rejection it looks like a bad phone number, which sends
  // whoever is debugging it in entirely the wrong direction.
  if (httpStatus === 401 || httpStatus === 403) {
    return (
      `Twilio refused the credentials (${where})` +
      `${message ? `: ${message}` : ""}. The API key pair and TWILIO_ACCOUNT_SID ` +
      `must belong to the same Twilio account.`
    );
  }

  if (message) return `Twilio rejected the message (${where}): ${message}`;
  return `Twilio rejected the message (${where}) and gave no explanation`;
}

/**
 * One message. Never throws, never rejects: everything that can go wrong
 * comes back as an SmsOutcome, because the caller is in the middle of
 * recording an emergency and an exception thrown from here would lose
 * the whole broadcast over one bad phone number.
 */
export async function sendSms(to: string, body: string): Promise<SmsOutcome> {
  const availability = smsAvailability();
  if (!availability.ready) {
    // Checked before the number is even looked at, so that a half
    // configured server gives the same reason for every recipient and a
    // reader of the delivery table can tell at a glance that the problem
    // was the server rather than the contact list.
    return { channel: "sms", status: "skipped", reason: availability.reason! };
  }

  const number = normaliseMobile(to);
  if (!number) {
    return { channel: "sms", status: "skipped", reason: REASON_INVALID_NUMBER };
  }

  const text = typeof body === "string" ? body.trim() : "";
  if (text === "") {
    // A blank SMS costs the same as a useful one and tells the recipient
    // nothing, so it is a skip rather than a send.
    return { channel: "sms", status: "skipped", reason: REASON_EMPTY_BODY };
  }

  const form = new URLSearchParams();
  form.set("To", number);
  form.set("Body", text);
  // A Messaging Service is preferred when one is configured, because it
  // owns the sender pool and the compliance settings; a bare From number
  // is the fallback for a single-number account.
  if (env.twilioMessagingServiceSid) {
    form.set("MessagingServiceSid", env.twilioMessagingServiceSid);
  } else {
    form.set("From", env.twilioFromNumber!);
  }

  const url = `${TWILIO_API_ROOT}/Accounts/${encodeURIComponent(
    env.twilioAccountSid!,
  )}/Messages.json`;

  // The API Key SID takes the place of the Account SID as the basic-auth
  // username. That is the whole reason both values have to be present:
  // one signs the request, the other addresses it.
  const authorization = `Basic ${Buffer.from(
    `${env.twilioApiKeySid}:${env.twilioApiKeySecret}`,
    "utf8",
  ).toString("base64")}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err: any) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    const reason = timedOut
      ? `Could not reach Twilio: the request timed out after ${
          REQUEST_TIMEOUT_MS / 1000
        } seconds`
      : `Could not reach Twilio: ${scrubNumbers(
          String(err?.message ?? "the connection failed"),
        )}`;
    // 'failed' rather than 'skipped'. We did try, and a network fault is
    // worth telling apart from a decision not to send.
    console.warn("[sms] no answer from Twilio for %s: %s", maskNumber(number), reason);
    return { channel: "sms", status: "failed", reason };
  }

  // Read as text first and parse defensively. A gateway sitting in front
  // of the API can answer with HTML, and a JSON parse error thrown from
  // here would be indistinguishable from a real send failure.
  const raw = await response.text().catch(() => "");
  let payload: any = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const reason = rejectionReason(response.status, payload);
    console.warn("[sms] Twilio refused a message to %s: %s", maskNumber(number), reason);
    return { channel: "sms", status: "failed", reason };
  }

  const sid =
    typeof payload?.sid === "string" && payload.sid.trim() !== ""
      ? payload.sid.trim()
      : null;
  if (!sid) {
    // A 2xx with no SID leaves nothing to look the message up by, so it
    // cannot honestly be called sent even though Twilio was happy.
    console.warn(
      "[sms] Twilio answered %d with no message id for %s",
      response.status,
      maskNumber(number),
    );
    return { channel: "sms", status: "failed", reason: REASON_NO_MESSAGE_ID };
  }

  console.info("[sms] Twilio accepted a message to %s (sid %s)", maskNumber(number), sid);
  return { channel: "sms", status: "sent", providerId: sid };
}

/**
 * Several messages, at most MAX_CONCURRENT_SENDS in flight, with the
 * outcomes returned in the same order as the input so the caller can pair
 * outcome[i] with recipient[i] without matching on phone numbers.
 *
 * Like sendSms it never rejects. One unreachable contact must not stop
 * the other eleven, which is the entire reason this is a pool with
 * per-message error handling rather than a Promise.all over sendSms.
 */
export async function sendSmsBatch(
  messages: Array<{ to: string; body: string }>,
): Promise<SmsOutcome[]> {
  const queue = Array.isArray(messages) ? messages : [];
  const outcomes: SmsOutcome[] = new Array(queue.length);

  let cursor = 0;
  async function drain(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= queue.length) return;

      const message = queue[index];
      try {
        outcomes[index] = await sendSms(message?.to ?? "", message?.body ?? "");
      } catch (err: any) {
        // sendSms is written not to throw, so reaching this is a bug in
        // this file rather than a Twilio problem. It still has to produce
        // an outcome, because a hole in the outcomes array would become a
        // recipient with no delivery record at all.
        outcomes[index] = {
          channel: "sms",
          status: "failed",
          reason: `The SMS adapter failed unexpectedly: ${scrubNumbers(
            String(err?.message ?? err),
          )}`,
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_SENDS, queue.length) }, () => drain()),
  );

  return outcomes;
}
