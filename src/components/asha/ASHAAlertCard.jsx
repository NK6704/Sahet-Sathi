import React from 'react';
import { Siren, Phone, MapPin, CheckCircle2, Clock, AlertTriangle, Send } from 'lucide-react';

export function ASHAAlertCard({ alert, onUpdateStatus, language = 'Hindi' }) {
  const isHindi = language === 'हिन्दी' || language === 'Hindi';
  const isCritical = alert.urgency === 'critical';

  const statusColors = {
    pending: 'bg-[#fcedea] text-[#b74636] border-[#f5b8ac]',
    acknowledged: 'bg-[#fef3c7] text-[#92400e] border-[#fde68a]',
    dispatched: 'bg-[#e0f2fe] text-[#0369a1] border-[#bae6fd]',
    resolved: 'bg-[#dcfce7] text-[#15803d] border-[#bbf7d0]'
  };

  return (
    <div
      id={`card-asha-alert-${alert.id}`}
      className={`lift-card rounded-3xl border p-5 shadow-xs transition ${
        isCritical ? 'border-[#b74636] bg-[#fffaf9]' : 'border-[#ded5c2] bg-[#fbf8ef]'
      }`}
      data-testid={`card-asha-alert-${alert.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`grid h-8 w-8 place-items-center rounded-xl ${
              isCritical ? 'bg-[#b74636] text-white' : 'bg-[#e76f46] text-white'
            }`}
          >
            <Siren size={16} />
          </span>
          <div>
            <h4 className="font-display text-base font-bold text-[#214e4a]">{alert.patient_name}</h4>
            <p className="text-[11px] text-[#637d74]">
              <Clock size={11} className="inline mr-1" />
              {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>

        <span
          className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${
            statusColors[alert.status] || 'bg-gray-100 text-gray-700'
          }`}
        >
          {alert.status}
        </span>
      </div>

      <div className="mt-3 rounded-2xl bg-[#f5efe2] p-3 text-xs text-[#294f4b]">
        <p className="font-bold text-[#b74636]">
          ⚠️ {alert.emergency_type}
        </p>
        <p className="mt-1 text-[#4a635b]">
          {alert.symptoms}
        </p>
        <p className="mt-2 flex items-center gap-1 text-[11px] text-[#627a72]">
          <MapPin size={12} className="text-[#c36a42]" /> {alert.location}
        </p>
      </div>

      {alert.notes && (
        <p className="mt-2 text-[11px] italic text-[#637d74]">
          📝 {alert.notes}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#ded5c2] pt-3">
        <a
          href={`tel:${alert.patient_phone}`}
          className="flex items-center gap-1 rounded-full border border-[#cbd9cc] bg-[#fbf7ec] px-3 py-1.5 text-xs font-bold text-[#1f655d] hover:bg-[#e9f2eb]"
        >
          <Phone size={13} /> {alert.patient_phone}
        </a>

        <div className="flex items-center gap-1.5">
          {alert.status === 'pending' && (
            <button
              onClick={() => onUpdateStatus(alert.id, 'acknowledged', 'ASHA worker acknowledged case')}
              className="rounded-full bg-[#1f655d] px-3 py-1.5 text-xs font-bold text-[#f9f2df] hover:bg-[#18534c]"
            >
              {isHindi ? 'स्वीकार करें' : 'Acknowledge'}
            </button>
          )}

          {alert.status === 'acknowledged' && (
            <button
              onClick={() => onUpdateStatus(alert.id, 'dispatched', 'Ambulance / Health Worker dispatched')}
              className="rounded-full bg-[#0284c7] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#0369a1]"
            >
              {isHindi ? 'मदद भेजी गई' : 'Mark Dispatched'}
            </button>
          )}

          {alert.status === 'dispatched' && (
            <button
              onClick={() => onUpdateStatus(alert.id, 'resolved', 'Patient treated and safely admitted')}
              className="rounded-full bg-[#16a34a] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#15803d]"
            >
              {isHindi ? 'मामला हल हुआ' : 'Mark Resolved'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
