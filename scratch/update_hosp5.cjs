const fs = require('fs');
let code = fs.readFileSync('server/routes/hospitals.ts', 'utf8');

code = code.replace(
  /p_speciality: null,/g,
  'p_speciality: speciality ? (SPECIALITY_MAP[speciality] || speciality) : null,'
);

code = code.replace(
  /query\.contains\(\"speciality_codes\", \[speciality\]\);/,
  'query.contains("speciality_codes", [SPECIALITY_MAP[speciality] || speciality]);'
);

fs.writeFileSync('server/routes/hospitals.ts', code);
console.log('Fixed p_speciality null mapping!');
