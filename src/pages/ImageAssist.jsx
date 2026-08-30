import React from 'react';
import { useAppState } from '@/state/store';
import PrescriptionScanner from '@/components/PrescriptionScanner';

export function ImageAssist() {
  const { language } = useAppState();

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 pb-24 md:pb-12 space-y-6">
      <PrescriptionScanner language={language} />
    </main>
  );
}
