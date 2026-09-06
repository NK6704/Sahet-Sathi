const fs = require('fs');
let code = fs.readFileSync('server/routes/hospitals.ts', 'utf8');

const mappingCode = `
const SPECIALITY_MAP: Record<string, string> = {
  'MC': '100002', // Cardiology
  'SE': '100013', // Ophthalmology
  'SB': '100015', // Orthopaedics
  'SO': '100012', // Obstetrics & Gynaecology
  'MP': '100017', // Paediatric Medical management
  'SU': '100023', // Urology
  'ER': '100001', // Emergency Room
  'MG': '100001', // General Medicine
  'SG': '100006', // General Surgery
  'MO': '100008', // Medical Oncology
  'MN': '100010', // Neo-natal care
};
`;

code = code.replace(
  /export const hospitalsRouter = Router\(\);/,
  mappingCode + '\nexport const hospitalsRouter = Router();'
);

code = code.replace(
  /p_speciality: speciality,/g,
  'p_speciality: speciality ? (SPECIALITY_MAP[speciality] || speciality) : null,'
);

fs.writeFileSync('server/routes/hospitals.ts', code);
console.log('Updated server/routes/hospitals.ts with SPECIALITY_MAP!');
