import React from 'react';
import { HospitalCard } from '@/components/care/HospitalCard';
import { isHindiLang } from '@/services/i18n';

/* =============================================================
   Legacy adapter. Kept only so that existing imports of
   `FacilityCard` keep resolving — new code should import
   HospitalCard directly.

   /care used to read the `healthcare_facilities` table through
   /api/facilities/nearby. That table's placeholder rows have been
   deleted and the PM-JAY empanelment registry is now the only
   facility source, so this component no longer has a shape of its
   own: it normalises whatever a facility row still carries into the
   registry vocabulary and hands it to the one card that knows the
   honesty rules.

   What it deliberately does NOT carry across:

     timings, doctor_on_duty, emergency_ready, services
       Fields that only ever existed on placeholder rows. Rendering
       "24x7 Emergency" or a named doctor on duty from a row nobody
       has checked is exactly the claim this product must not make.

     source_name
       Only `source` is mapped. A row that does not carry the
       registry's own source string gets no source line and no
       empanelment stamp, rather than borrowing an official-looking
       one.
   ============================================================= */

function toRegistryShape(facility, deva) {
  const coords = facility.coordinates ?? {};

  return {
    id: facility.id,
    facilityId: facility.facility_id ?? null,
    name: deva && facility.name_hi ? facility.name_hi : facility.name,
    address: facility.address ?? null,
    phone: facility.phone ?? null,
    mobile: facility.mobile ?? null,
    // A text label such as 'Community Health Centre', not a registry
    // type code, so nothing here reads as Government or Private.
    type: facility.type ?? null,
    typeCode: null,
    // Services are not speciality codes and there is no code list to
    // resolve them against, so none are claimed.
    specialityCodes: [],
    district: facility.district ?? undefined,
    state: facility.state ?? null,
    latitude: facility.latitude ?? coords.lat ?? null,
    longitude: facility.longitude ?? coords.lng ?? null,
    // Printed, never computed: whatever measured this distance is the
    // only thing that knows what it was measured from.
    distanceKm: facility.distance_km ?? null,
    verification: facility.verification ?? null,
    source: facility.source ?? null,
    sourceUrl: facility.source_url ?? null,
    contactVerified: facility.contact_verified === true,
  };
}

export function FacilityCard({ facility, language = 'English', hi, className = '' }) {
  const deva = typeof hi === 'boolean' ? hi : Boolean(language) && isHindiLang(language);

  if (!facility?.name) return null;

  return (
    <HospitalCard
      hospital={toRegistryShape(facility, deva)}
      language={language}
      hi={deva}
      className={className}
    />
  );
}
