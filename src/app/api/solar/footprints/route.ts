import { NextRequest, NextResponse } from 'next/server';
import { footprintsInBounds } from '@/lib/nyc/footprint-index';

export const runtime = 'nodejs';

// Street-level views only: about 1.5 km across at New York's latitude.
const MAX_SPAN_DEGREES = 0.02;
const LIMIT = 3000;

export async function GET(request: NextRequest) {
  const read = (key: string) => Number(request.nextUrl.searchParams.get(key));
  const bounds = { south: read('s'), west: read('w'), north: read('n'), east: read('e') };
  if (Object.values(bounds).some((value) => !Number.isFinite(value)) || bounds.north <= bounds.south || bounds.east <= bounds.west) {
    return NextResponse.json({ code: 'INVALID_BOUNDS' }, { status: 400 });
  }
  if (bounds.north - bounds.south > MAX_SPAN_DEGREES || bounds.east - bounds.west > MAX_SPAN_DEGREES) {
    return NextResponse.json({ code: 'AREA_TOO_LARGE' }, { status: 400 });
  }
  try {
    const result = footprintsInBounds(bounds, LIMIT);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, max-age=3600' } });
  } catch (error) {
    const unavailable = error instanceof Error && error.message === 'FOOTPRINTS_UNAVAILABLE';
    if (!unavailable) console.error('NYC footprint lookup failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ code: unavailable ? 'FOOTPRINTS_UNAVAILABLE' : 'MODEL_SERVICE_ERROR' }, { status: 503 });
  }
}
