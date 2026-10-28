import { SolarStudio } from '@/components/studio/solar-studio';
import { Suspense } from 'react';

export default function SharedBuildingPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-200" />}>
      <SolarStudio />
    </Suspense>
  );
}
