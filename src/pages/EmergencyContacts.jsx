import React from 'react';
import { Phone } from 'lucide-react';
import { useAppState } from '@/state/store';
import { Btn, Card, Eyebrow } from '@/components/ds';

export function EmergencyContacts() {
  const { language } = useAppState();
  const isHi = language === 'हिन्दी' || language === 'Hindi';

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 pb-24 md:pb-12 space-y-6">
      <div className="border-b pb-4">
        <Eyebrow>{isHi ? 'आपातकालीन संपर्क' : 'Emergency Contacts'}</Eyebrow>
        <h1 className="mt-2 font-display text-3xl font-bold">
          {isHi ? 'तुरंत कॉल करें' : 'Call for help'}
        </h1>
      </div>

      <div className="space-y-4">
        <Card className="p-5">
          <p className="font-semibold">108 — {isHi ? 'एम्बुलेंस' : 'Ambulance'}</p>
          <div className="mt-3 flex gap-3">
            <Btn as="a" href="tel:108" variant="primary">
              <Phone size={16} aria-hidden="true" />
              {isHi ? '108 कॉल करें' : 'Call 108'}
            </Btn>
          </div>
        </Card>

        <Card className="p-5">
          <p className="font-semibold">112 — {isHi ? 'आपातकालीन नंबर' : 'All emergencies'}</p>
          <div className="mt-3 flex gap-3">
            <Btn as="a" href="tel:112" variant="primary">
              <Phone size={16} aria-hidden="true" />
              {isHi ? '112 कॉल करें' : 'Call 112'}
            </Btn>
          </div>
        </Card>
      </div>
    </main>
  );
}
