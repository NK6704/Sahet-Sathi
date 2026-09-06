const fs = require('fs');
let code = fs.readFileSync('server/routes/hospitals.ts', 'utf8');

code = code.replace(
  /export async function nearestHospitals\([\s\S]*?\): Promise<\{ hospitals: Record<string, unknown>\[\]; note: string \| null \}> \{/,
  `export async function nearestHospitals(
  lat: unknown,
  lng: unknown,
  limit = 3,
  radiusKm = 25,
  speciality: string | null = null,
): Promise<{ hospitals: Record<string, unknown>[]; note: string | null }> {`
);

code = code.replace(
  /const \{ data, error \} = await admin\(\)\.rpc\(\"hospitals_nearby\", \{[\s\S]*?p_offset: 0,\n\s*\}\);/,
  `const { data, error } = await admin().rpc("hospitals_nearby", {
      p_lat: latitude,
      p_lng: longitude,
      p_radius_km: clamp(radiusKm, 1, 100),
      p_type: null,
      p_speciality: speciality,
      p_limit: clamp(Math.trunc(limit), 1, 20),
      p_offset: 0,
    });`
);

fs.writeFileSync('server/routes/hospitals.ts', code);
console.log('Updated server/routes/hospitals.ts with flexible regex!');
