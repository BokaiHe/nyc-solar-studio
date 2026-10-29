import { NextRequest, NextResponse } from 'next/server';
import { findNycBuilding, findNycBuildingById } from '@/lib/nyc/building-index';
import { buildNycModel } from '@/lib/nyc/geometry';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // A building picked from the map's footprint outlines is fetched by id.
  const id = request.nextUrl.searchParams.get('id');
  if (id !== null) {
    if (!id || id.length > 200) return NextResponse.json({ code: 'INVALID_BUILDING' }, { status: 400 });
    try {
      const building = findNycBuildingById(id);
      if (!building) return NextResponse.json({ code: 'NO_MODEL_DATA' }, { status: 404 });
      return NextResponse.json(buildNycModel(building), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      console.error('NYC model lookup failed', error instanceof Error ? error.message : 'unknown');
      return NextResponse.json({ code: 'MODEL_SERVICE_ERROR' }, { status: 503 });
    }
  }
  const lat = request.nextUrl.searchParams.get('lat');
  const lng = request.nextUrl.searchParams.get('lng');
  const latitude = Number(lat), longitude = Number(lng);
  if (!lat || !lng || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return NextResponse.json({ code: 'INVALID_LOCATION' }, { status: 400 });
  }
  try {
    const building = findNycBuilding({ latitude, longitude });
    if (!building) return NextResponse.json({ code: 'NO_MODEL_DATA' }, { status: 404 });
    return NextResponse.json(buildNycModel(building), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('NYC model lookup failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ code: 'MODEL_SERVICE_ERROR' }, { status: 503 });
  }
}
