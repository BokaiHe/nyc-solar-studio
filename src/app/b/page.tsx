import { SolarApp } from '@/components/solar-app';
import { Suspense } from 'react';

export default function SharedBuildingPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-950" />}>
      <SolarApp />
    </Suspense>
  );
}
