const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// 1. Update JSON schema to include speciality_code
code = code.replace(
  /facility_type: \{ type: Type\.STRING \},/,
  'facility_type: { type: Type.STRING },\n                    speciality_code: { type: Type.STRING },'
);

// 2. Add specialization instruction to system prompt
code = code.replace(
  /7\. LANGUAGE MATCHING: You MUST strictly reply in the EXACT same language that the user used in their question\. If they speak Hindi, reply in Hindi\. If they speak English, reply in English\./,
  `7. LANGUAGE MATCHING: You MUST strictly reply in the EXACT same language that the user used in their question. If they speak Hindi, reply in Hindi. If they speak English, reply in English.
  8. SPECIALIZATION MAPPING: If you recommend a hospital, determine the required medical specialization and include its exact 2-letter code in 'entities.speciality_code'. Codes: Cardiology (MC), Emergency (ER), General Medicine (MG), General Surgery (SG), Medical Oncology (MO), Obstetrics & Gynaecology (SO), Opthalmology (SE), Orthopaedics (SB), Paediatric Medical management (MP), Urology (SU). Leave empty if unsure.
  9. SCHEME IDENTIFICATION: If the user describes a condition that aligns with a specific health scheme (e.g., pregnancy -> Janani Suraksha, cancer/major surgery -> Ayushman PM-JAY), output it in 'entities.scheme_topic'.`
);

// 3. Update parsedResult block to pass speciality_code
code = code.replace(
  /const hospitals = await nearestHospitals\(userLat, userLng, 3, 25\);/,
  `const specialityCode = parsedResult.entities?.speciality_code || null;
        const hospitals = await nearestHospitals(userLat, userLng, 3, 25, specialityCode);`
);

// 4. Remove rule-based overrides that ignore AI
const schemeRegex = /\/\/ Check if query is about schemes\s+if \([\s\S]*?\}\)\);\s*\}/;
const careRegex = /\/\/ Check if query is about finding a clinic, doctor or hospital\s+if \([\s\S]*?\}\)\);\s*\}/;

code = code.replace(schemeRegex, '');
code = code.replace(careRegex, '');

fs.writeFileSync('server.ts', code);
console.log('Updated server.ts successfully!');
