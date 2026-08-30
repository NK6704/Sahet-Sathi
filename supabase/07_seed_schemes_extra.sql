-- =====================================================================
-- Sehat Sathi — scheme reference data, part two
--
-- Additive. Run this AFTER 03_seed_schemes.sql. It adds the other
-- national programmes a family actually asks an ASHA worker about:
-- the Arogya Mandir down the road, the 70-plus cover for a
-- grandparent, vaccines, the Anganwadi ration, dialysis, TB, the
-- generic medicine shop, elderly care. Nothing here overwrites a row
-- from 03 — every code is new — and the upsert is keyed on `code` the
-- same way, so this file is safe to re-run.
--
-- Three rows are stamped 'unverified' on purpose:
--
--   npy    Ni-kshay Poshan Yojana. The monthly nutrition amount was
--          revised after the scheme launched. benefit_amount is NULL.
--   ran    Rashtriya Arogya Nidhi. The assistance ceiling and the
--          income limit have both moved. Neither is quoted.
--   hmcpf  Health Minister's Cancer Patient Fund. Same — the sanction
--          limit is left out.
--
-- That is the rule this table exists to enforce, not a gap in it. A
-- NULL the UI omits is correct; a figure we half-remember is a family
-- travelling for money that is not coming. The same reasoning governs
-- the helplines and links left NULL below: 104, 14555 and 14477 are
-- the only numbers quoted here, because they are the only ones 03
-- already stands behind. No placeholder numbers, anywhere.
--
-- BEFORE THE DEMO: fill the three unverified rows from the current
-- programme orders, then flip verification and set verified_at.
-- =====================================================================

insert into public.schemes
  (code, name, name_hi, short_desc, full_desc, ministry, category,
   benefit_amount, benefit_summary, eligibility_rules, documents,
   how_to_apply, official_url, helpline, verification, source, verified_at)
values
(
  'aam',
  'Ayushman Arogya Mandir (Ayushman Bharat Health and Wellness Centre)',
  'आयुष्मान आरोग्य मंदिर',
  'Your nearest upgraded sub-centre or PHC — free medicines, free basic tests, and screening for BP, sugar and common cancers.',
  'Sub-centres and primary health centres upgraded to deliver comprehensive primary health care instead of only mother-and-child services. They were called Health and Wellness Centres until 2023, when they were renamed Ayushman Arogya Mandir. The service package covers pregnancy and childbirth care, newborn and child health, adolescent health, family planning, communicable diseases, screening and management of hypertension, diabetes and oral, breast and cervical cancer, elderly and palliative care, basic emergency care, eye and ENT problems, mental health and oral health. Essential medicines and a list of diagnostic tests are free at the centre, a Community Health Officer is posted there, and teleconsultation with a doctor is available. Screening for hypertension, diabetes and the three common cancers is offered to everyone aged 30 and above.',
  'Ministry of Health and Family Welfare (National Health Mission)',
  'primary_care',
  0,
  'Free essential medicines, free listed diagnostic tests and free NCD screening at the centre. No cash payment.',
  '{"open_to_all":true,"ncd_screening_age_min":30}'::jsonb,
  array['Any government photo ID','ABHA number, if you have one'],
  'No application. Walk in to the Ayushman Arogya Mandir for your village or ward. Your ASHA worker knows which centre covers your habitation and on which day the Community Health Officer holds the NCD clinic.',
  'https://nhm.gov.in',
  '104',
  'verified', 'MoHFW — Ayushman Bharat Health and Wellness Centre programme, National Health Mission', now()
),
(
  'vay_vandana',
  'Ayushman Vay Vandana — PM-JAY cover for everyone aged 70 and above',
  'आयुष्मान वय वंदना',
  'Free hospital treatment up to ₹5 lakh a year for anyone aged 70 or above, whatever the family earns.',
  'An expansion of Pradhan Mantri Jan Arogya Yojana to all senior citizens aged 70 and above, with no income test at all. A separate Ayushman Vay Vandana card is issued to the senior citizen. Where the family already has PM-JAY cover, the members aged 70 and above get their own top-up of ₹5 lakh a year that the rest of the family cannot draw on. Seniors already covered by CGHS, ECHS or the CAPF health scheme have to choose between that scheme and this one; those with private insurance or ESIC cover can take this in addition. Treatment is cashless at empanelled hospitals, exactly as in the rest of PM-JAY.',
  'Ministry of Health and Family Welfare (National Health Authority)',
  'insurance',
  500000,
  '₹5,00,000 a year of cashless hospital treatment for the 70-plus members of the household, over and above any existing PM-JAY family cover.',
  '{"age_min":70,"income_tested":false}'::jsonb,
  array['Aadhaar showing age 70 or above','Ayushman Vay Vandana card, once it is issued'],
  'Register with Aadhaar e-KYC on the PM-JAY portal or the Ayushman app, or ask at any Ayushman Arogya Mandir or Common Service Centre. Your ASHA worker can start the registration; the card is downloaded once it is approved.',
  'https://pmjay.gov.in',
  '14555',
  'verified', 'National Health Authority — Ayushman Vay Vandana, PM-JAY expansion for citizens aged 70 and above', now()
),
(
  'rksk',
  'Rashtriya Kishor Swasthya Karyakram',
  'राष्ट्रीय किशोर स्वास्थ्य कार्यक्रम',
  'Free, confidential health advice and care for boys and girls aged 10 to 19.',
  'The adolescent health programme. It works on six areas: nutrition and anaemia, sexual and reproductive health, non-communicable diseases, substance misuse, injuries and violence including gender-based violence, and mental health. Services reach adolescents through Adolescent Friendly Health Clinics at PHCs, CHCs and district hospitals, through trained peer educators in the village, and on Adolescent Health Days. Counselling at the clinic is confidential and an adolescent may come without a parent. Weekly iron and folic acid tablets are given through schools and Anganwadi centres.',
  'Ministry of Health and Family Welfare (National Health Mission)',
  'adolescent',
  0,
  'Free counselling, examination, iron and folic acid supplements and referral. No cash payment.',
  '{"age_min":10,"age_max":19}'::jsonb,
  array['Aadhaar or school ID, only if asked'],
  'Ask your ASHA worker or the village peer educator when the Adolescent Friendly Health Clinic runs at your PHC or CHC, then walk in. School students are also covered through the school health programme.',
  'https://nhm.gov.in',
  '104',
  'verified', 'MoHFW — Rashtriya Kishor Swasthya Karyakram, National Health Mission', now()
),
(
  'uip',
  'Universal Immunisation Programme and Mission Indradhanush',
  'सार्वभौमिक टीकाकरण कार्यक्रम और मिशन इंद्रधनुष',
  'Every vaccine in the national schedule, free — plus catch-up rounds for children who missed a dose.',
  'Routine immunisation gives free vaccines to children and to pregnant women against tuberculosis, diphtheria, pertussis, tetanus, polio, hepatitis B, Haemophilus influenzae type b, measles and rubella, rotavirus diarrhoea and pneumococcal pneumonia, with Japanese encephalitis vaccine in endemic districts. Sessions are held on fixed Village Health and Nutrition Days at the Anganwadi centre or sub-centre. Mission Indradhanush is the catch-up drive that goes house to house to find children under two and pregnant women who were missed or only partly vaccinated, and completes their schedule. Doses are recorded on the Mother and Child Protection card, and a child who has missed a dose does not have to start the schedule again.',
  'Ministry of Health and Family Welfare (National Health Mission)',
  'child',
  0,
  'All vaccines in the national schedule, free, at the Anganwadi centre or health facility.',
  '{"age_max":16,"catch_up_age_max":2}'::jsonb,
  array['Mother and Child Protection (MCP) card','Immunisation card, where one is issued separately'],
  'No application. Ask your ASHA or Anganwadi worker for the date of the next Village Health and Nutrition Day, and take the MCP card so the dose is recorded.',
  'https://nhm.gov.in',
  '104',
  'verified', 'MoHFW — Universal Immunisation Programme and Mission Indradhanush, National Health Mission', now()
),
(
  'poshan',
  'Poshan Abhiyaan — Anganwadi supplementary nutrition',
  'पोषण अभियान',
  'Supplementary nutrition, monthly weighing and feeding advice at the Anganwadi centre for children under six and for pregnant and nursing mothers.',
  'Poshan Abhiyaan is the national nutrition mission; what a family actually receives comes through the Anganwadi centre under the Integrated Child Development Services scheme. Children from six months to six years get supplementary nutrition — a hot cooked meal for the older children, take-home ration for the younger ones — with monthly weighing and growth monitoring, pre-school education from three years, and immunisation and health check-ups. Pregnant women and nursing mothers get take-home ration and counselling on breastfeeding and complementary feeding. A child found severely underweight or wasted gets extra ration and is referred to a Nutrition Rehabilitation Centre. Weights and heights are entered on the Poshan Tracker, so ask the Anganwadi worker to show you the child''s growth chart rather than only telling you it is fine.',
  'Ministry of Women and Child Development',
  'nutrition',
  0,
  'Free supplementary nutrition and monthly growth monitoring for children under six, and take-home ration for pregnant and nursing mothers.',
  '{"age_max":6}'::jsonb,
  array['MCP card','Aadhaar of the mother or the child','Birth certificate of the child, if you have it'],
  'Register the child — or yourself, if you are pregnant — at the Anganwadi centre for your habitation. The Anganwadi worker enters the name on the Poshan Tracker and the ration starts from that month.',
  'https://wcd.gov.in',
  null,
  'verified', 'Ministry of Women and Child Development — POSHAN Abhiyaan and ICDS supplementary nutrition', now()
),
(
  'pmndp',
  'Pradhan Mantri National Dialysis Programme',
  'प्रधानमंत्री राष्ट्रीय डायलिसिस कार्यक्रम',
  'Free haemodialysis at district hospitals for patients whose kidneys have failed.',
  'Set up under the National Health Mission so that a patient on dialysis does not have to travel to a city or pay a private centre. Dialysis units run at district hospitals, usually with a private partner under a public-private arrangement, and the session, the dialyser and the consumables are free to the patient. How many sessions are free, and whether the state limits the benefit to below-poverty-line patients or offers it to everyone, is decided by the state government — confirm the local rule at the district hospital before a family travels. Several states also run units at sub-district and community health centre level.',
  'Ministry of Health and Family Welfare (National Health Mission)',
  'chronic',
  0,
  'Free haemodialysis sessions at participating district hospitals. The number of free sessions, and any income condition, are set by the state.',
  '{"basis":"advised haemodialysis for kidney failure","facility":"participating district hospital"}'::jsonb,
  array['Doctor''s referral or prescription advising dialysis','Recent kidney function test reports','Aadhaar or any government photo ID','Ration card or BPL certificate, where the state asks for it'],
  'Take the nephrologist''s or physician''s advice to the dialysis unit at the district hospital. Your ASHA worker can find out which hospital in the district has a working unit and how slots are given, which saves a wasted journey.',
  'https://nhm.gov.in',
  '104',
  'verified', 'MoHFW — Pradhan Mantri National Dialysis Programme, National Health Mission', now()
),
(
  'ntep',
  'National Tuberculosis Elimination Programme',
  'राष्ट्रीय क्षय रोग उन्मूलन कार्यक्रम',
  'Free TB testing and free medicines for the whole course, at any government facility.',
  'Testing for tuberculosis — sputum microscopy and molecular tests — and the entire course of anti-TB medicines are free in the public system, for drug-sensitive and drug-resistant TB alike. Treatment is recorded on Ni-kshay, the national TB portal, and treatment support is arranged close to home so the patient is not travelling every day. Household contacts are screened and offered preventive treatment. A cough lasting more than two weeks, weight loss, evening fever or blood in the sputum should be tested; the test is free and needs no referral letter. Private doctors are required to notify TB cases, and a patient being treated privately can still take the free medicines.',
  'Ministry of Health and Family Welfare (Central TB Division)',
  'infectious',
  0,
  'Free diagnosis and the full course of free medicines. This programme pays no cash — the nutrition support is a separate scheme.',
  '{"basis":"anyone with TB symptoms or a TB diagnosis","facility":"any government health facility"}'::jsonb,
  array['Aadhaar or any government photo ID','Earlier prescriptions or test reports, if you have them'],
  'Go to the nearest PHC, CHC or district hospital and ask for a TB test, or tell your ASHA worker — she can arrange sputum collection in the village and follow up the result.',
  'https://mohfw.gov.in',
  '104',
  'verified', 'MoHFW — Central TB Division, National Tuberculosis Elimination Programme', now()
),
(
  'npy',
  'Ni-kshay Poshan Yojana — nutrition support during TB treatment',
  'नि-क्षय पोषण योजना',
  'A monthly payment into the patient''s own bank account for food, for as long as TB treatment lasts.',
  'Every notified TB patient is entitled to a monthly cash transfer for nutritional support, paid by direct benefit transfer for the whole duration of treatment. The patient has to be registered on Ni-kshay with Aadhaar and a bank account for the money to move, and that is the step which usually fails — an account in a relative''s name will stall the transfer. The monthly amount was revised upward after the scheme started, so this row quotes no figure: ask the Senior Treatment Supervisor or the District TB Officer for the amount in force before telling a family what to expect. Separately, a donor can support a patient with a monthly food basket under Ni-kshay Mitra.',
  'Ministry of Health and Family Welfare (Central TB Division)',
  'nutrition',
  null,
  'A monthly nutrition payment by direct benefit transfer for the full course of treatment. The current amount is deliberately not recorded here — confirm it with the District TB Officer before quoting it.',
  '{"basis":"TB patient notified on Ni-kshay","bank_account":"in the patient''s own name"}'::jsonb,
  array['Aadhaar','Bank account passbook in the patient''s own name','Ni-kshay registration number or TB treatment card'],
  'The health worker who starts the treatment registers the patient on Ni-kshay — give the Aadhaar and bank details at that point. If nothing arrives after the first month, ask the Senior Treatment Supervisor at the TB unit to check the Ni-kshay entry.',
  'https://mohfw.gov.in',
  null,
  'unverified', 'MoHFW Central TB Division — Ni-kshay Poshan Yojana. The monthly amount is not confirmed in this build and has been left blank on purpose; check the current Central TB Division order before quoting it.', null
),
(
  'ran',
  'Rashtriya Arogya Nidhi',
  'राष्ट्रीय आरोग्य निधि',
  'Financial help for a poor patient needing treatment for a life-threatening illness at a government super-speciality hospital.',
  'A central fund that pays towards treatment for patients living below the poverty line who need care for a life-threatening condition at a government super-speciality hospital or a central institute. The application is made by the treating hospital, not by the family on its own: the hospital certifies the diagnosis, sends an estimate of the cost, and the money is released to the hospital rather than to the patient. Many of these institutes hold a revolving fund so that smaller amounts can be sanctioned locally without going to the ministry. The ceiling on assistance and the income limit have both been revised over the years, so this row quotes neither — the medical social work department at the treating hospital has the figures and the form in force.',
  'Ministry of Health and Family Welfare',
  'treatment_support',
  null,
  'A grant towards the cost of treatment, paid to the treating government hospital. The ceiling is deliberately not recorded here.',
  '{"basis":"patient living below the poverty line with a life-threatening illness","facility":"government super-speciality hospital or central institute"}'::jsonb,
  array['Income certificate or BPL ration card','Diagnosis and cost estimate from the treating government hospital','Aadhaar','Bank account details of the patient'],
  'Ask for the medical social work department or the welfare officer at the government hospital where the treatment is being done — they fill the application and forward it. A family cannot usefully apply without the hospital''s estimate.',
  'https://mohfw.gov.in',
  null,
  'unverified', 'MoHFW — Rashtriya Arogya Nidhi. The assistance ceiling and income limit are not confirmed in this build and have been left blank on purpose; the treating hospital''s welfare officer holds the current limits.', null
),
(
  'hmcpf',
  'Health Minister''s Cancer Patient Fund',
  null,
  'Financial help for a poor cancer patient being treated at a Regional Cancer Centre or another approved government institute.',
  'A fund within Rashtriya Arogya Nidhi meant specifically for cancer. It works through the Regional Cancer Centres and other approved government institutions, which hold a revolving fund so that assistance for a poor patient can be sanctioned by the institution itself; larger amounts go to the ministry. As with the rest of Rashtriya Arogya Nidhi the application starts in the treating institution and the money goes to the institution, not to the family. The sanction limits have changed over time and are not quoted here. Check the PM-JAY entitlement first — cancer treatment packages are covered there, and that route needs no application to any fund.',
  'Ministry of Health and Family Welfare',
  'treatment_support',
  null,
  'A grant towards the cost of cancer treatment, sanctioned through the treating Regional Cancer Centre. The limit is deliberately not recorded here.',
  '{"basis":"cancer patient living below the poverty line","facility":"Regional Cancer Centre or approved government institute"}'::jsonb,
  array['Income certificate or BPL ration card','Diagnosis and treatment estimate from the Regional Cancer Centre','Aadhaar','Bank account details of the patient'],
  'Ask the medical social worker at the Regional Cancer Centre treating the patient. Have the PM-JAY card checked at the same time, because a covered package is faster than a grant.',
  'https://mohfw.gov.in',
  null,
  'unverified', 'MoHFW — Health Minister''s Cancer Patient Fund, under Rashtriya Arogya Nidhi. The sanction limit is not confirmed in this build and has been left blank on purpose.', null
),
(
  'janaushadhi',
  'Pradhan Mantri Bhartiya Janaushadhi Pariyojana',
  'प्रधानमंत्री भारतीय जनऔषधि परियोजना',
  'Government generic medicine shops — the same medicine as the branded pack, at a much lower price.',
  'A network of Janaushadhi Kendras selling quality generic medicines and surgical items. Supplies are procured from WHO-GMP certified manufacturers and batches are tested at accredited laboratories. The scheme publishes its prices as 50 to 90 per cent below the branded equivalents, and the price list is displayed at the counter — a prescription written for a salt such as amoxicillin can be filled here at the generic price instead of the brand a chemist offers. Sanitary napkins are sold under the Suvidha brand at a nominal price, which is on the same list. Anyone can buy: there is no eligibility test, no card and no registration.',
  'Department of Pharmaceuticals, Ministry of Chemicals and Fertilizers (Pharmaceuticals and Medical Devices Bureau of India)',
  'medicines',
  null,
  'Generic medicines at the published Janaushadhi price, which the scheme states is 50 to 90 per cent below the branded equivalent. Not a cash benefit — you simply pay less at the counter.',
  '{"open_to_all":true,"prescription":"needed only for prescription-only medicines"}'::jsonb,
  array['Doctor''s prescription, for medicines that need one'],
  'No registration. Take the prescription to a Janaushadhi Kendra and ask for the generic. If the counter says it is unavailable, ask them to check the salt on the list — the same medicine is often stocked under a different pack size.',
  'https://janaushadhi.gov.in',
  null,
  'verified', 'Department of Pharmaceuticals — Pradhan Mantri Bhartiya Janaushadhi Pariyojana', now()
),
(
  'npncd',
  'National Programme for Prevention and Control of Non-Communicable Diseases',
  null,
  'Free screening and free treatment for blood pressure, diabetes and three common cancers, from age 30.',
  'Population-based screening for hypertension, diabetes and oral, breast and cervical cancer is offered to everyone aged 30 and above. The ASHA worker fills the risk assessment checklist in the household and the screening itself is done at the Ayushman Arogya Mandir by the Community Health Officer. Anyone who screens positive is confirmed and treated at the NCD clinic at the CHC or district hospital, and free medicines for blood pressure and diabetes are issued from there, so a patient on treatment collects a refill without paying. The programme was earlier called NPCDCS. Because these are lifelong conditions, the most useful thing an ASHA worker does here is make sure the monthly refill actually happens.',
  'Ministry of Health and Family Welfare (National Health Mission)',
  'chronic',
  0,
  'Free screening from age 30, and free medicines for hypertension and diabetes from the NCD clinic or the Ayushman Arogya Mandir.',
  '{"age_min":30,"basis":"population-based screening for hypertension, diabetes and oral, breast and cervical cancer"}'::jsonb,
  array['Any government photo ID','The NCD or treatment card, once one is issued'],
  'Ask your ASHA worker to fill the community-based assessment checklist, then attend the NCD day at the Ayushman Arogya Mandir. If you are already on BP or sugar medicines, carry the old prescription so the refill can be issued.',
  'https://nhm.gov.in',
  '104',
  'verified', 'MoHFW — National Programme for Prevention and Control of Non-Communicable Diseases (earlier NPCDCS), National Health Mission', now()
),
(
  'nphce',
  'National Programme for Health Care of the Elderly',
  null,
  'Dedicated free care for people aged 60 and above — a geriatric OPD at the district hospital and weekly clinics closer to home.',
  'Builds services for older people into the existing system: a geriatric outpatient clinic and reserved beds at the district hospital, weekly geriatric clinics at community health centres, and rehabilitation support at PHC and sub-centre level. Regional Geriatric Centres at medical colleges take referrals for specialist care. Services cover treatment of age-related illness, physiotherapy, and help with hearing and vision problems. Home visits are meant to be arranged for a bedridden older person, which is worth asking about when the patient cannot travel — that is the entitlement families most often do not know exists.',
  'Ministry of Health and Family Welfare (National Health Mission)',
  'elderly',
  0,
  'Free geriatric consultation, treatment and rehabilitation at government facilities. No cash payment.',
  '{"age_min":60}'::jsonb,
  array['Aadhaar or any proof of age showing 60 or above'],
  'Ask at the district hospital for the geriatric OPD day, or ask your ASHA worker which CHC near you holds the weekly geriatric clinic. Anyone aged 70 or above should be registered for Ayushman Vay Vandana at the same visit.',
  'https://mohfw.gov.in',
  '104',
  'verified', 'MoHFW — National Programme for Health Care of the Elderly, National Health Mission', now()
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

-- ---------------------------------------------------------------------
-- Report the split, so whoever runs this can see what still needs a
-- source before the demo. The unverified count is expected to be
-- non-zero; it is a to-do list, not a failure.
-- ---------------------------------------------------------------------
do $$
declare
  v_total      int;
  v_verified   int;
  v_unverified int;
  v_inferred   int;
  v_pending    text;
begin
  select count(*),
         count(*) filter (where verification = 'verified'),
         count(*) filter (where verification = 'unverified'),
         count(*) filter (where verification = 'inferred')
    into v_total, v_verified, v_unverified, v_inferred
  from public.schemes;

  select string_agg(code, ', ' order by code)
    into v_pending
  from public.schemes
  where verification <> 'verified';

  raise notice 'schemes: % rows total — % verified, % unverified, % inferred.',
    v_total, v_verified, v_unverified, v_inferred;

  if v_pending is null then
    raise notice 'Every scheme row carries a source and is stamped verified.';
  else
    raise notice 'Not stamped verified (a figure was left NULL rather than guessed): %', v_pending;
  end if;
end $$;
