import { SolarApp } from '@/components/solar-app';
import { Suspense } from 'react';

export default function HomePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-950" />}>
      <SolarApp />
    </Suspense>
  );
}
