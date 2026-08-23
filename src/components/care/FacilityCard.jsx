import React from 'react';
import { Phone, Navigation, Clock3, Stethoscope, Pill, Building2, ShieldCheck, HeartPulse } from 'lucide-react';

export function FacilityCard({ facility, language = 'Hindi' }) {
  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  const getIcon = (type) => {
    if (type.includes('Pharmacy') || type.includes('Janaushadhi') || type.includes('औषधि')) return Pill;
    if (type.includes('District') || type.includes('Hospital') || type.includes('चिकित्सालय')) return Building2;
    if (type.includes('Arogya') || type.includes('Sub-Centre') || type.includes('आरोग्य')) return HeartPulse;
    return Stethoscope;
  };

  const Icon = getIcon(facility.type);

  const handleDirections = () => {
    if (facility.coordinates) {
      window.open(`https://www.google.com/maps/search/?api=1&query=${facility.coordinates.lat},${facility.coordinates.lng}`, '_blank');
    } else {
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(facility.name + ' ' + facility.address)}`, '_blank');
    }
  };

  return (
    <div
      id={`card-facility-${facility.id}`}
      className="lift-card flex flex-col justify-between rounded-3xl border border-[#ded5c2] bg-[#fbf8ef] p-5 shadow-xs transition hover:border-[#1f655d]"
      data-testid={`card-facility-${facility.id}`}
    >
      <div>
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#dceee9] text-[#1f655d]">
            <Icon size={24} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#f2e7d5] px-2.5 py-0.5 text-[10px] font-bold text-[#8a572a]">
                {facility.type}
              </span>
              {facility.emergency_ready && (
                <span className="rounded-full bg-[#fce9e6] px-2 py-0.5 text-[10px] font-bold text-[#b74636]">
                  24x7 Emergency Ready
                </span>
              )}
            </div>

            <h3 className="mt-1 font-display text-lg font-bold leading-tight text-[#214e4a]">
              {isHindi && facility.name_hi ? facility.name_hi : facility.name}
            </h3>

            <p className="mt-1 text-xs text-[#627a72]">
              📍 {facility.address} · <span className="font-bold text-[#1f655d]">{facility.distance_km} km away</span>
            </p>
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-[#f5efe2] p-2.5 text-xs text-[#3a5851]">
          <p className="flex items-center gap-1.5 font-semibold">
            <Clock3 size={14} className="text-[#8a572a]" /> {facility.timings}
          </p>
          {facility.doctor_on_duty && (
            <p className="mt-1 text-[11px] text-[#627a72]">
              👨‍⚕️ {facility.doctor_on_duty}
            </p>
          )}
        </div>

        {facility.services && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {facility.services.slice(0, 4).map((srv, idx) => (
              <span key={idx} className="rounded-lg bg-[#eef5f1] px-2 py-0.5 text-[11px] text-[#2c534c]">
                {srv}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex gap-2 border-t border-[#ded5c2] pt-3">
        <a
          href={`tel:${facility.phone}`}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[#cbd9cc] bg-[#fbf7ec] px-3 py-2 text-xs font-bold text-[#1f655d] transition hover:bg-[#e9f2eb]"
          data-testid={`btn-call-facility-${facility.id}`}
        >
          <Phone size={14} />
          <span>{isHindi ? 'कॉल करें' : 'Call Facility'}</span>
        </a>

        <button
          type="button"
          onClick={handleDirections}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#1f655d] px-3 py-2 text-xs font-bold text-[#f9f2df] transition hover:bg-[#18534c]"
          data-testid={`btn-directions-facility-${facility.id}`}
        >
          <Navigation size={14} />
          <span>{isHindi ? 'रास्ता देखें' : 'Directions'}</span>
        </button>
      </div>
    </div>
  );
}
