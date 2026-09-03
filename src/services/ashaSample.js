/* =============================================================
   DEAD FILE — safe to delete.

   This used to hold the ASHA portal's sample dataset: a fictional
   worker ("Demo ASHA worker", code DEMO-0001, "Demo Sub-centre")
   plus invented alerts, referrals, facilities and camps, all of
   which src/services/asha.js returned whenever no Supabase project
   was configured.

   That fallback has been removed. A portal that shows an invented
   referral is more dangerous than one that shows an error, because
   the worker may act on it — visit a household that does not exist,
   or trust a patient list that is missing the real cases. With no
   project configured, src/services/asha.js now throws one clear
   error and the pages render their error state.

   The contents were removed rather than the file, because this
   sandbox cannot delete files. Delete it on your machine:

     del src\services\ashaSample.js

   Nothing imports it. Verified with:
     rg "ashaSample" src/
   ============================================================= */

export {};
