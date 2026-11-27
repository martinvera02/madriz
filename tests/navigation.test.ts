import { describe, it, expect } from 'vitest';
import { RoadGraph } from '../src/systems/roadGraph';
import { Navigation, fmtDist, fmtEta } from '../src/systems/navigation';
import type { WorldData, RoadData } from '../src/world/realData';

/**
 * Cuadrícula de 3×3 cruces separados 100 m:
 *   0 — 1 — 2
 *   |   |   |
 *   3 — 4 — 5
 *   |   |   |
 *   6 — 7 — 8
 * La calle 0→1→2 es de sentido único hacia el este.
 */
function grid(): WorldData {
  const roadNodes: number[] = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) roadNodes.push(i * 100, j * 100);
  let id = 0;
  const road = (n: number[], ow?: 1 | -1): RoadData => ({ id: id++, hw: 'residential', w: 8, car: 1, n, ow } as RoadData);
  const roads = [
    road([0, 1, 2], 1), road([3, 4, 5]), road([6, 7, 8]),
    road([0, 3, 6]), road([1, 4, 7]), road([2, 5, 8]),
  ];
  return { roadNodes, roads } as unknown as WorldData;
}

describe('RoadGraph', () => {
  it('respeta los sentidos únicos en coche y no a pie', () => {
    const d = grid();
    const cars = new RoadGraph(d, 'cars');
    const walk = new RoadGraph(d, 'walk');
    const has = (g: RoadGraph, a: number, b: number) => (g.out.get(a) ?? []).some((e) => e.to === b);
    expect(has(cars, 0, 1)).toBe(true);
    expect(has(cars, 1, 0)).toBe(false);
    expect(has(walk, 1, 0)).toBe(true);
  });
});

describe('Navigation.find (A*)', () => {
  const d = grid();
  const nav = new Navigation(new RoadGraph(d, 'cars'), new RoadGraph(d, 'walk'));

  it('encuentra ruta y termina en el destino', () => {
    const r = nav.find(0, 100, Math.PI / 2, true, 200, 200, )!;
    expect(r).not.toBeNull();
    const n = r.pts.length;
    expect(r.pts[n - 2]).toBeCloseTo(200);
    expect(r.pts[n - 1]).toBeCloseTo(200);
    expect(r.length).toBeGreaterThan(250);
    expect(r.eta).toBeGreaterThan(0);
  });

  it('en coche no va contra dirección; a pie sí atajan', () => {
    // de (200,0) a (0,0): en coche no puede ir por la calle de arriba hacia el oeste
    const car = nav.find(200, 0, -Math.PI / 2, true, 0, 0)!;
    const foot = nav.find(200, 0, -Math.PI / 2, false, 0, 0)!;
    expect(car).not.toBeNull();
    expect(foot).not.toBeNull();
    expect(car.length).toBeGreaterThan(foot.length + 100);
    // la ruta a pie va por arriba: nunca baja de z = 50
    for (let i = 1; i < foot.pts.length; i += 2) expect(foot.pts[i]).toBeLessThan(50);
  });
});

describe('formato', () => {
  it('distancias y tiempos en español', () => {
    expect(fmtDist(347)).toBe('350 m');
    expect(fmtDist(1500)).toMatch(/^1,5 km$/);
    expect(fmtEta(20)).toBe('1 min');
    expect(fmtEta(600)).toBe('10 min');
  });
});
