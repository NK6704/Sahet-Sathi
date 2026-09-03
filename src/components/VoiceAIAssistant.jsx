/* =============================================================
   DEAD FILE — safe to delete.

   This was an earlier, self-contained voice assistant component,
   superseded by src/pages/Assistant.jsx plus
   src/components/assistant/AssistantMessage.jsx.

   Nothing imports it. It was emptied rather than left in place for
   two reasons:

     · It still read the OLD response contract of
       POST /api/assistant/message — `related_schemes`,
       `nearby_hospitals`, `source_type` — which the server no
       longer sends. Copying from it would silently produce a
       screen that renders no hospitals and no written summary.
     · It fell back to a hard-coded location, `Mandi, Sehore`,
       whenever the profile had none. That is the exact bug the
       assistant and home screens were fixed for: a distance
       measured from a village the person has never been to.

   The contents were removed rather than the file, because this
   sandbox cannot delete files. Delete it on your machine:

     del src\components\VoiceAIAssistant.jsx

   Verified orphaned with:
     rg "VoiceAIAssistant" src/
   ============================================================= */

export {};
