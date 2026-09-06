const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  /8\. SPECIALIZATION MAPPING: If you recommend a hospital, determine the required medical specialization and include its exact 2-letter code in 'entities\.speciality_code'\. Codes: Cardiology \(MC\), Emergency \(ER\), General Medicine \(MG\), General Surgery \(SG\), Medical Oncology \(MO\), Obstetrics & Gynaecology \(SO\), Opthalmology \(SE\), Orthopaedics \(SB\), Paediatric Medical management \(MP\), Urology \(SU\)\. Leave empty if unsure\./,
  `8. SPECIALIZATION MAPPING: When a user describes a health condition (e.g. chest pain, heart issue, pregnancy, fracture), YOU MUST output the matching 2-letter code in 'entities.speciality_code'. ALWAYS output a code. Codes: Cardiology for chest pain/heart (MC), Emergency (ER), General Medicine (MG), General Surgery (SG), Medical Oncology (MO), Obstetrics & Gynaecology (SO), Opthalmology for eyes (SE), Orthopaedics for bones (SB), Paediatric Medical management (MP), Urology (SU).`
);

fs.writeFileSync('server.ts', code);
console.log('Updated server.ts with stronger prompt!');
