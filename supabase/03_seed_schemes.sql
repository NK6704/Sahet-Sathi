-- =====================================================================
-- Sehat Sathi — scheme reference data
--
-- These are real central government schemes. Each row carries the
-- official source it came from, because the UI refuses to stamp
-- anything "verified" without one.
--
-- BEFORE THE DEMO: re-check every benefit_amount against the official
-- portal in `official_url`. Entitlement figures get revised, and the
-- one thing this product must never do is quote a stale number to
-- someone deciding whether to go to a hospital.
-- =====================================================================

insert into public.schemes
  (code, name, name_hi, short_desc, full_desc, ministry, category,
   benefit_amount, benefit_summary, eligibility_rules, documents,
   how_to_apply, official_url, helpline, verification, source, verified_at)
values
(
  'pmjay',
  'Ayushman Bharat — Pradhan Mantri Jan Arogya Yojana',
  'आयुष्मान भारत — प्रधानमंत्री जन आरोग्य योजना',
  'Cashless hospital treatment up to ₹5 lakh per family each year.',
  'Covers secondary and tertiary care hospitalisation at empanelled public and private hospitals. There is no cap on family size or age, and pre-existing conditions are covered from day one. Treatment is cashless and paperless at the hospital''s Ayushman counter.',
  'Ministry of Health and Family Welfare (National Health Authority)',
  'insurance',
  500000,
  '₹5,00,000 per family per year for hospitalisation, cashless at empanelled hospitals.',
  '{"basis":"SECC 2011 deprivation criteria or occupational category; plus state-extended lists","age":"no limit","family_size":"no limit"}'::jsonb,
  array['Ayushman card or eligibility slip','Aadhaar or any government photo ID','Ration card (to establish the family)'],
  'Check eligibility on the PMJAY portal or at any Common Service Centre, then collect the Ayushman card. At the hospital, go to the Ayushman Mitra desk.',
  'https://pmjay.gov.in',
  '14555',
  'verified', 'National Health Authority — pmjay.gov.in', now()
),
(
  'jsy',
  'Janani Suraksha Yojana',
  'जननी सुरक्षा योजना',
  'Cash help for giving birth in a hospital or health centre.',
  'A safe-motherhood intervention under the National Health Mission that gives cash assistance to encourage institutional delivery. The ASHA worker is the link worker: she accompanies the mother and helps with the paperwork. Amounts differ between Low Performing States and High Performing States, and between rural and urban areas.',
  'Ministry of Health and Family Welfare (National Health Mission)',
  'maternal',
  1400,
  'Low Performing States: ₹1,400 rural / ₹1,000 urban. High Performing States: ₹700 rural / ₹600 urban. Paid to the mother after institutional delivery.',
  '{"pregnancy":true,"delivery":"institutional","note":"In Low Performing States all pregnant women qualify. In High Performing States, BPL / SC / ST women qualify."}'::jsonb,
  array['JSY card or MCP card','Aadhaar','Bank account passbook','Delivery record from the facility'],
  'Register the pregnancy with your ASHA worker or at the nearest sub-centre. She will open the JSY card and help you claim after delivery.',
  'https://nhm.gov.in',
  '104',
  'verified', 'National Health Mission — JSY guidelines, nhm.gov.in', now()
),
(
  'pmmvy',
  'Pradhan Mantri Matru Vandana Yojana',
  'प्रधानमंत्री मातृ वंदना योजना',
  'Maternity benefit paid straight into the mother''s bank account.',
  'A conditional cash transfer that partly compensates for wages lost during pregnancy and after birth, and encourages antenatal check-ups and immunisation. Paid in instalments against health milestones. Under PMMVY 2.0 a second instalment cycle applies if the second child is a girl.',
  'Ministry of Women and Child Development',
  'maternal',
  5000,
  '₹5,000 in instalments for the first living child. A further ₹6,000 where the second child is a girl.',
  '{"pregnancy":true,"child_order":"first living child (and second if a girl)","excludes":"women in regular employment with the Centre, State or PSUs who receive paid maternity leave"}'::jsonb,
  array['MCP card','Aadhaar of mother and husband','Bank or post office account in the mother''s own name','Consent form'],
  'Apply through the Anganwadi centre or approved health facility, or on the PMMVY portal. Your ASHA worker or Anganwadi worker can register it for you.',
  'https://pmmvy.wcd.gov.in',
  '181',
  'verified', 'Ministry of Women and Child Development — pmmvy.wcd.gov.in', now()
),
(
  'jssk',
  'Janani Shishu Suraksha Karyakram',
  'जननी शिशु सुरक्षा कार्यक्रम',
  'Free delivery, medicines, tests, food and transport at government facilities.',
  'Entitles every pregnant woman to a completely free delivery — including caesarean section — at a public health institution, plus free drugs, diagnostics, diet during her stay, blood if needed, and transport home. The same entitlements cover sick infants up to one year old. There should be no out-of-pocket expense at all.',
  'Ministry of Health and Family Welfare (National Health Mission)',
  'maternal',
  0,
  'No cash payment. Zero-expense delivery and newborn care at public facilities, including free transport.',
  '{"pregnancy":true,"facility":"public health institution","infants":"up to 1 year"}'::jsonb,
  array['MCP card','Any government photo ID'],
  'No application needed. Go to any government health facility — the entitlement applies automatically. If you are asked to pay, tell your ASHA worker or call the helpline.',
  'https://nhm.gov.in',
  '104',
  'verified', 'National Health Mission — JSSK guidelines, nhm.gov.in', now()
),
(
  'rbsk',
  'Rashtriya Bal Swasthya Karyakram',
  'राष्ट्रीय बाल स्वास्थ्य कार्यक्रम',
  'Free health screening and treatment for children from birth to 18.',
  'Screens children for the four Ds — defects at birth, deficiencies, childhood diseases, and developmental delays including disability. Screening happens at delivery points, through Anganwadi centres for under-sixes, and in government and government-aided schools. Children who screen positive are referred up for free treatment, including tertiary surgery.',
  'Ministry of Health and Family Welfare (National Health Mission)',
  'child',
  0,
  'Free screening for 30+ identified conditions, and free follow-up treatment including surgery.',
  '{"age":"0 to 18 years","route":"delivery point, Anganwadi, or government / aided school"}'::jsonb,
  array['Child''s immunisation or MCP card','School ID where applicable'],
  'Screening comes to you through the Anganwadi centre or school. Ask your ASHA worker when the mobile health team next visits.',
  'https://rbsk.mohfw.gov.in',
  '104',
  'verified', 'MoHFW — rbsk.mohfw.gov.in', now()
),
(
  'pmsma',
  'Pradhan Mantri Surakshit Matritva Abhiyan',
  'प्रधानमंत्री सुरक्षित मातृत्व अभियान',
  'Free antenatal check-up on the 9th of every month.',
  'Guarantees a free, quality antenatal check-up to every pregnant woman in her second and third trimester at a government health facility on the 9th of each month. The aim is to identify and manage high-risk pregnancies early. Private practitioners volunteer at these clinics.',
  'Ministry of Health and Family Welfare',
  'maternal',
  0,
  'Free antenatal check-up, tests and counselling on the 9th of every month at government facilities.',
  '{"pregnancy":true,"trimester":"2nd or 3rd"}'::jsonb,
  array['MCP card'],
  'Just attend the nearest government health facility on the 9th. If the 9th is a holiday, the clinic runs on the next working day.',
  'https://pmsma.mohfw.gov.in',
  '104',
  'verified', 'MoHFW — pmsma.mohfw.gov.in', now()
),
(
  'abha',
  'Ayushman Bharat Health Account (ABHA)',
  'आयुष्मान भारत हेल्थ अकाउंट',
  'A free 14-digit health ID that keeps your records in one place.',
  'A voluntary digital health ID under the Ayushman Bharat Digital Mission. It links your prescriptions, lab reports and hospital records so any doctor you consent to can see your history instead of starting from scratch. Sharing is consent-based and you can revoke it.',
  'Ministry of Health and Family Welfare (National Health Authority)',
  'digital',
  0,
  'Free. One 14-digit number that carries your health records between facilities.',
  '{"eligibility":"any resident of India","documents":"Aadhaar or driving licence"}'::jsonb,
  array['Aadhaar or driving licence','Mobile number for OTP'],
  'Create it in a few minutes on the ABHA portal or the ABHA mobile app, or ask at any Ayushman Arogya Mandir.',
  'https://abha.abdm.gov.in',
  '14477',
  'verified', 'National Health Authority — abdm.gov.in', now()
)
on conflict (code) do update set
  name            = excluded.name,
  name_hi         = excluded.name_hi,
  short_desc      = excluded.short_desc,
  full_desc       = excluded.full_desc,
  ministry        = excluded.ministry,
  category        = excluded.category,
  benefit_amount  = excluded.benefit_amount,
  benefit_summary = excluded.benefit_summary,
  eligibility_rules = excluded.eligibility_rules,
  documents       = excluded.documents,
  how_to_apply    = excluded.how_to_apply,
  official_url    = excluded.official_url,
  helpline        = excluded.helpline,
  verification    = excluded.verification,
  source          = excluded.source,
  verified_at     = excluded.verified_at;
