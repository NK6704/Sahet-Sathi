const fs = require('fs');
let code = fs.readFileSync('server/routes/hospitals.ts', 'utf8');

const target1 = `export async function nearestHospitals(
  lat: unknown,
  lng: unknown,
  limit = 3,
  radiusKm = 25,
): Promise<{ hospitals: Record<string, unknown>[]; note: string | null }> {`;

const repl1 = `export async function nearestHospitals(
  lat: unknown,
  lng: unknown,
  limit = 3,
  radiusKm = 25,
  speciality: string | null = null,
): Promise<{ hospitals: Record<string, unknown>[]; note: string | null }> {`;

const target2 = `const { data, error } = await admin().rpc("hospitals_nearby", {
      p_lat: latitude,
      p_lng: longitude,
      p_radius_km: clamp(radiusKm, 1, 100),
      p_type: null,
      p_speciality: null,
      p_limit: clamp(Math.trunc(limit), 1, 20),
      p_offset: 0,
    });`;

const repl2 = `const { data, error } = await admin().rpc("hospitals_nearby", {
      p_lat: latitude,
      p_lng: longitude,
      p_radius_km: clamp(radiusKm, 1, 100),
      p_type: null,
      p_speciality: speciality,
      p_limit: clamp(Math.trunc(limit), 1, 20),
      p_offset: 0,
    });`;

code = code.replace(target1, repl1);
code = code.replace(target2, repl2);

fs.writeFileSync('server/routes/hospitals.ts', code);
console.log('Updated server/routes/hospitals.ts with string replacement!');
