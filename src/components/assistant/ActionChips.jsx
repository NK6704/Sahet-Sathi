import React from 'react';
import { ArrowRight, Phone, FileText, MapPin, AlertTriangle, UserCheck } from 'lucide-react';
import { useLocation } from 'wouter';

export function ActionChips({ actions = [], onActionClick }) {
  const [, setLocation] = useLocation();

  if (!actions || actions.length === 0) return null;

  const handleClick = (action) => {
    if (onActionClick) {
      onActionClick(action);
      return;
    }

    if (action.link) {
      if (action.link.startsWith('tel:')) {
        window.location.href = action.link;
      } else {
        setLocation(action.link);
      }
    } else if (action.type === 'call_emergency') {
      window.location.href = `tel:${action.number || '108'}`;
    }
  };

  const getIcon = (type) => {
    switch (type) {
      case 'call_emergency':
      case 'call_care':
        return Phone;
      case 'open_scheme':
        return FileText;
      case 'find_care':
        return MapPin;
      case 'notify_asha':
        return UserCheck;
      default:
        return ArrowRight;
    }
  };

  return (
    <div id="chips-action-suggestions" className="flex flex-wrap gap-2" data-testid="container-action-chips">
      {actions.map((action, index) => {
        const Icon = getIcon(action.type);
        const isEmergency = action.type === 'call_emergency';

        return (
          <button
            key={index}
            id={`btn-action-chip-${index}`}
            type="button"
            onClick={() => handleClick(action)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition hover:-translate-y-0.5 active:scale-95 shadow-2xs ${
              isEmergency
                ? 'bg-[#b74636] text-[#fff7e9] hover:bg-[#9d3729]'
                : 'bg-[#1f655d] text-[#f9f2df] hover:bg-[#18534c]'
            }`}
            data-testid={`chip-action-${index}`}
          >
            <Icon size={13} />
            <span>{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}
