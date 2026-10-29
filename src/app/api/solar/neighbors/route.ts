import { NextRequest, NextResponse } from 'next/server';
import { findNeighborBuildings, findNycBuildingById } from '@/lib/nyc/building-index';
import { buildNeighborMesh } from '@/lib/nyc/geometry';
import type { NeighborMesh } from '@/lib/solar/types';

export const runtime = 'nodejs';

const RADIUS_METERS = 200;
// Parsing a dense block's CityGML takes a while; keep recent results in memory.
const CACHE_SIZE = 30;
const cache = new Map<string, NeighborMesh>();

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id || id.length > 200) return NextResponse.json({ code: 'INVALID_BUILDING' }, { status: 400 });
  try {
    let mesh = cache.get(id);
    if (!mesh) {
      const target = findNycBuildingById(id);
      if (!target) return NextResponse.json({ code: 'NO_MODEL_DATA' }, { status: 404 });
      mesh = buildNeighborMesh(target, findNeighborBuildings(target, RADIUS_METERS), RADIUS_METERS);
      cache.set(id, mesh);
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
    }
    return NextResponse.json(mesh, { headers: { 'Cache-Control': 'private, max-age=86400' } });
  } catch (error) {
    console.error('NYC neighbor lookup failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ code: 'MODEL_SERVICE_ERROR' }, { status: 503 });
  }
}
