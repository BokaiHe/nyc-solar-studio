import { describe, expect, it } from 'vitest';
import type { ConceptPanel } from '@/lib/solar/types';
import { collides, panelAxes, rowPanelIds, similarPanelIds, snapToArray } from './panel-ops';

const size = { widthMeters: 1, heightMeters: 2 };
const rack = (id: number, x: number, z: number, y = 10, azimuthDegrees = 180): ConceptPanel => ({
  id, position: [x, y, z], azimuthDegrees, tiltDegrees: 10, landscape: false, mount: 'rack',
});

// Two rows of three south-facing racks on a roof at 10 m, plus one on a bulkhead.
const panels: ConceptPanel[] = [
  rack(1, 0, 0), rack(2, 1.05, 0), rack(3, 2.1, 0),
  rack(4, 0, 3), rack(5, 1.05, 3), rack(6, 2.1, 3),
  rack(7, 0, 0, 14),
];

describe('panel selection helpers', () => {
  it('points the panel axes toward the facing side', () => {
    const { forward, across } = panelAxes(180);
    expect(forward[0]).toBeCloseTo(0);
    expect(forward[1]).toBeCloseTo(1);
    expect(across[0]).toBeCloseTo(-1);
  });

  it('selects one row on one roof level', () => {
    expect(rowPanelIds(panels, panels[1]).sort()).toEqual([1, 2, 3]);
  });

  it('selects every panel on the same roof level with the same orientation', () => {
    expect(similarPanelIds(panels, panels[0]).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(similarPanelIds([...panels, rack(8, 5, 5, 10, 90)], panels[0])).not.toContain(8);
  });

  it('detects collisions on the same level only', () => {
    expect(collides([0.2, 10, 0.1], panels, 0.7)).toBe(true);
    expect(collides([0.2, 12, 0.1], panels.slice(0, 6), 0.7)).toBe(false);
    expect(collides([0.2, 10, 0.1], panels, 0.7, new Set([1]))).toBe(false);
  });
});

describe('snapToArray', () => {
  it('snaps a rack to the next column and row of the nearest array', () => {
    const candidate = { ...rack(0, 3.3, 0.4), position: [3.3, 10.1, 0.4] as [number, number, number] };
    const snapped = snapToArray(candidate, panels.slice(0, 6), size, 0.8);
    expect(snapped?.[0]).toBeCloseTo(3.15);
    expect(snapped?.[1]).toBeCloseTo(10);
    expect(snapped?.[2]).toBeCloseTo(0);

    const nextRow = snapToArray({ ...candidate, position: [0.1, 10, 5.4] }, panels.slice(0, 6), size, 0.8);
    // Row pitch is 2 m × cos 10° + 0.8 m.
    expect(nextRow?.[2]).toBeCloseTo(3 + 2 * Math.cos((10 * Math.PI) / 180) + 0.8, 2);
  });

  it('steps flush panels down the slope', () => {
    const tilt = 30;
    const flush: ConceptPanel = { id: 1, position: [0, 8, 1], azimuthDegrees: 180, tiltDegrees: tilt, landscape: false, mount: 'flush' };
    const snapped = snapToArray({ ...flush, position: [0, 7, 2.8] }, [flush], size, 0.8);
    const pitch = 2 + 0.05;
    expect(snapped?.[2]).toBeCloseTo(1 + pitch * Math.cos((tilt * Math.PI) / 180));
    expect(snapped?.[1]).toBeCloseTo(8 - pitch * Math.sin((tilt * Math.PI) / 180));
  });

  it('does not snap to panels that face another way or sit far away', () => {
    expect(snapToArray(rack(0, 3, 0, 10, 90), panels, size, 0.8)).toBeNull();
    expect(snapToArray(rack(0, 20, 20), panels, size, 0.8)).toBeNull();
  });
});
