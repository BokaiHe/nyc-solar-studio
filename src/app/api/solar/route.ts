import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const latitude = Number(request.nextUrl.searchParams.get('lat'));
  const longitude = Number(request.nextUrl.searchParams.get('lng'));
  const apiKey = process.env.GOOGLE_SOLAR_API_KEY;

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return NextResponse.json({ code: 'INVALID_LOCATION' }, { status: 400 });
  }

  if (!apiKey) {
    return NextResponse.json({ code: 'SERVER_NOT_CONFIGURED' }, { status: 500 });
  }

  const params = new URLSearchParams({
    'location.latitude': latitude.toString(),
    'location.longitude': longitude.toString(),
    requiredQuality: 'HIGH',
    key: apiKey,
  });

  try {
    const response = await fetch(
      `https://solar.googleapis.com/v1/buildingInsights:findClosest?${params}`,
      { cache: 'no-store' },
    );

    if (response.status === 404) {
      return NextResponse.json({ code: 'NO_DATA' }, { status: 404 });
    }
    if (!response.ok) {
      return NextResponse.json({ code: 'SERVICE_ERROR' }, { status: 502 });
    }

    return NextResponse.json(await response.json());
  } catch {
    return NextResponse.json({ code: 'SERVICE_ERROR' }, { status: 502 });
  }
}
