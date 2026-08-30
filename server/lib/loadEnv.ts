import dotenv from "dotenv";

/* =====================================================================
   Loading .env, as its own module, for one specific reason.

   ES module imports are hoisted: every `import` in a file is resolved and
   evaluated before the first line of that file's own body runs. So a
   `dotenv.config()` call sitting at the top of server.ts still executes
   *after* every module server.ts imports has already been evaluated. Any
   module that reads process.env at module scope — env.ts does exactly
   that, deliberately, so the configuration is a frozen snapshot rather
   than something that can drift mid-request — would therefore see an
   empty environment and quietly decide that nothing is configured.

   Putting the load in its own module fixes it by exploiting the same
   hoisting rule. Imports are evaluated in source order, so as long as
   `import "./server/lib/loadEnv"` appears above the import of anything
   that reads configuration, the variables are in place before that
   module's body runs.

   The alternative would be a top-level `await import()`, which does work
   under tsx but breaks `npm run build`: that bundles to CJS, and CJS has
   no top-level await. This approach works identically in both.

   .env.local wins over .env because dotenv does not overwrite a variable
   that is already set, and loading the local file first is what makes it
   the override rather than the fallback.
   ===================================================================== */

dotenv.config({ path: ".env.local" });
dotenv.config();

/** Exported so the import cannot be dropped as unused by a bundler. */
export const envLoaded = true;
