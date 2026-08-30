import React from 'react';
import { ArrowRight, Phone, FileText, MapPin, UserCheck } from 'lucide-react';
import { useLocation } from 'wouter';

/* =============================================================
   The next thing you can do.

   These turn an answer into an action, which is the whole point of
   the assistant. Emergency actions are the one case that gets the
   siren colour, and they are never mixed in visually with the
   ordinary ones — a person scanning in a panic must not have to
   read to find the call button.
   ============================================================= */

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
    <div
      id="chips-action-suggestions"
      className="flex flex-wrap gap-2"
      data-testid="container-action-chips"
    >
      {actions.map((action, index) => {
        const Icon = getIcon(action.type);
        const isEmergency = action.type === 'call_emergency';

        return (
          <button
            key={index}
            id={`btn-action-chip-${index}`}
            type="button"
            onClick={() => handleClick(action)}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border-[1.5px] px-3.5
              text-[0.8rem] font-semibold transition-[transform,background-color] active:translate-y-px ${
                isEmergency
                  ? 'border-siren bg-siren text-white hover:bg-siren/90'
                  : 'border-ink bg-ink text-paper hover:bg-seal hover:border-seal'
              }`}
            data-testid={`chip-action-${index}`}
          >
            <Icon size={13} aria-hidden="true" />
            <span>{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}
