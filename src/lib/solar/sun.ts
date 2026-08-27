import * as SunCalc from 'suncalc';
import type { SunSnapshot } from './types';

const DEG_TO_RAD = Math.PI / 180;
const NEW_YORK_TIME_ZONE = 'America/New_York';

export function getSunSnapshot(date: Date, latitude: number, longitude: number): SunSnapshot {
  const position = SunCalc.getPosition(date, latitude, longitude);
  const times = SunCalc.getTimes(date, latitude, longitude);
  const altitudeDegrees = position.altitude;
  return {
    azimuthDegrees: (position.azimuth + 360) % 360,
    altitudeDegrees,
    sunrise: times.sunrise ?? date,
    sunset: times.sunset ?? date,
    daylight: altitudeDegrees > 0,
  };
}

export function panelDirectLightFactor(
  panelAzimuthDegrees: number,
  panelTiltDegrees: number,
  sun: Pick<SunSnapshot, 'azimuthDegrees' | 'altitudeDegrees'>,
): number {
  if (sun.altitudeDegrees <= 0) return 0;
  const sunAzimuth = sun.azimuthDegrees * DEG_TO_RAD;
  const sunAltitude = sun.altitudeDegrees * DEG_TO_RAD;
  const panelAzimuth = panelAzimuthDegrees * DEG_TO_RAD;
  const panelTilt = panelTiltDegrees * DEG_TO_RAD;
  const sunEast = Math.sin(sunAzimuth) * Math.cos(sunAltitude);
  const sunNorth = Math.cos(sunAzimuth) * Math.cos(sunAltitude);
  const sunUp = Math.sin(sunAltitude);
  const normalEast = Math.sin(panelAzimuth) * Math.sin(panelTilt);
  const normalNorth = Math.cos(panelAzimuth) * Math.sin(panelTilt);
  const normalUp = Math.cos(panelTilt);
  return Math.max(0, Math.min(1, sunEast * normalEast + sunNorth * normalNorth + sunUp * normalUp));
}

export function sunPathForDate(
  date: Date,
  latitude: number,
  longitude: number,
  intervalMinutes = 10,
): Array<{ azimuthDegrees: number; altitudeDegrees: number }> {
  const times = SunCalc.getTimes(date, latitude, longitude);
  if (!times.sunrise || !times.sunset) return [];
  const start = times.sunrise.getTime();
  const end = times.sunset.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const result = [];
  for (let time = start; time <= end; time += intervalMinutes * 60_000) {
    const snapshot = getSunSnapshot(new Date(time), latitude, longitude);
    if (snapshot.daylight) {
      result.push({ azimuthDegrees: snapshot.azimuthDegrees, altitudeDegrees: snapshot.altitudeDegrees });
    }
  }
  return result;
}

function partsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value('year'), month: value('month'), day: value('day'),
    hour: value('hour'), minute: value('minute'), second: value('second'),
  };
}

export function newYorkDateTimeToDate(dateIso: string, minuteOfDay: number): Date {
  const [year, month, day] = dateIso.split('-').map(Number);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = targetUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = partsInTimeZone(new Date(guess), NEW_YORK_TIME_ZONE);
    const representedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    guess -= representedUtc - targetUtc;
  }
  return new Date(guess);
}

export function currentNewYorkDateAndMinute(date = new Date()) {
  const parts = partsInTimeZone(date, NEW_YORK_TIME_ZONE);
  return {
    dateIso: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
    minuteOfDay: parts.hour * 60 + parts.minute,
  };
}

export function formatNewYorkTime(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: NEW_YORK_TIME_ZONE,
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}
