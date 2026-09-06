const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  /9\. SCHEME IDENTIFICATION: If the user describes a condition that aligns with a specific health scheme \(e\.g\., pregnancy -> Janani Suraksha, cancer\/major surgery -> Ayushman PM-JAY\), output it in 'entities\.scheme_topic'\./,
  `9. SCHEME IDENTIFICATION: If the user describes a condition that aligns with a specific health scheme, populate 'related_schemes' with exactly one of these objects:
     - { "id": "pmjay-ayushman", "title": "Ayushman Bharat PM-JAY", "benefit_summary": "Up to ₹5 lakh of cashless hospital care a year for eligible families", "link": "/schemes/pmjay-ayushman" } (for major surgeries, cancer, severe illness)
     - { "id": "janani-suraksha", "title": "Janani Suraksha Yojana (JSY)", "benefit_summary": "Cash assistance for institutional delivery", "link": "/schemes/janani-suraksha" } (for pregnancy/maternity)`
);

fs.writeFileSync('server.ts', code);
console.log('Updated server.ts with scheme ID instructions!');
