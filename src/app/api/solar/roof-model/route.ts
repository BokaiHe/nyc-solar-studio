import { NextRequest, NextResponse } from 'next/server';
import { buildRoofModel } from '@/lib/solar/roof-model';
import { findGbaBuilding } from '@/lib/gba/building-index';
import { buildGbaLod1Model } from '@/lib/gba/lod1-model';

export const runtime = 'nodejs';

const modelCache = new Map<string, { expiresAt: number; model: Awaited<ReturnType<typeof buildRoofModel>> }>();

export async function GET(request: NextRequest) {
  const latitude = Number(request.nextUrl.searchParams.get('lat'));
  const longitude = Number(request.nextUrl.searchParams.get('lng'));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json({ code: 'INVALID_LOCATION' }, { status: 400 });
  }
  const cacheKey = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  const cached = modelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.model, { headers: { 'Cache-Control': 'private, max-age=300' } });
  }
  const location = { latitude, longitude };
  const gbaBuilding = findGbaBuilding(location);
  if (gbaBuilding) {
    const model = buildGbaLod1Model(gbaBuilding);
    modelCache.set(cacheKey, { model, expiresAt: Date.now() + 5 * 60 * 1000 });
    return NextResponse.json(model, { headers: { 'Cache-Control': 'private, max-age=300' } });
  }
  const apiKey = process.env.GOOGLE_SOLAR_API_KEY;
  if (!apiKey) return NextResponse.json({ code: 'SERVER_NOT_CONFIGURED' }, { status: 500 });
  const params = new URLSearchParams({
    'location.latitude': latitude.toFixed(6),
    'location.longitude': longitude.toFixed(6),
    radius_meters: '40',
    pixel_size_meters: '0.5',
    required_quality: 'BASE',
    key: apiKey,
  });
  try {
    const layersResponse = await fetch(`https://solar.googleapis.com/v1/dataLayers:get?${params}`, { cache: 'no-store' });
    if (layersResponse.status === 404) return NextResponse.json({ code: 'NO_MODEL_DATA' }, { status: 404 });
    if (!layersResponse.ok) return NextResponse.json({ code: 'LAYER_SERVICE_ERROR' }, { status: 502 });
    const urls = await layersResponse.json() as {
      dsmUrl: string;
      maskUrl: string;
      imageryQuality: string;
      imageryDate?: { year: number; month: number; day: number };
    };
    const model = await buildRoofModel(urls, apiKey, location);
    modelCache.set(cacheKey, { model, expiresAt: Date.now() + 5 * 60 * 1000 });
    return NextResponse.json(model, { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch (error) {
    console.error('roof-model', error);
    return NextResponse.json({ code: 'MODEL_BUILD_ERROR' }, { status: 502 });
  }
}
