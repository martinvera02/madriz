import { describe, it, expect } from 'vitest';
import { shatter, dent, isCollapsed, wheelAt, intactFraction, triCentroid } from '../src/entities/vehicleDamage';

/** Dos triángulos: uno en el morro (z = 2) y otro en la zaga (z = -2). */
const twoTris = () => new Float32Array([
  -0.5, 1, 2, 0.5, 1, 2, 0, 1.5, 2,
  -0.5, 1, -2, 0.5, 1, -2, 0, 1.5, -2,
]);

describe('daño visible', () => {
  it('shatter rompe solo lo que está cerca del golpe', () => {
    const a = twoTris();
    const bits = shatter(a, 0, 1.2, 2, 0.6);
    expect(bits).toHaveLength(1);
    expect(isCollapsed(a, 0)).toBe(true);
    expect(isCollapsed(a, 1)).toBe(false);
    // lo ya roto no vuelve a romperse
    expect(shatter(a, 0, 1.2, 2, 0.6)).toHaveLength(0);
  });

  it('shatter respeta el filtro de triángulos', () => {
    const a = twoTris();
    expect(shatter(a, 0, 1.2, 0, 5, (t) => t === 1)).toHaveLength(1);
    expect(isCollapsed(a, 0)).toBe(false);
  });

  it('la abolladura hunde hacia dentro y no pasa del límite', () => {
    const a = new Float32Array([0, 0.75, 2]);
    const orig = a.slice();
    expect(dent(a, orig, 0, 0.75, 2, 0, 1, 1, 10, 0.35)).toBe(true);
    expect(a[2]).toBeLessThan(2);
    expect(Math.hypot(a[0] - orig[0], a[1] - orig[1], a[2] - orig[2])).toBeCloseTo(0.35, 5);
    // lejos del golpe no se mueve nada
    const b = new Float32Array([0, 0.75, -2]);
    expect(dent(b, b.slice(), 0, 0.75, 2, 0, 1, 1, 0.2)).toBe(false);
  });

  it('un disparo bajo junto a una rueda la pincha; uno alto no', () => {
    const wheels = [{ x: 0.8, z: 1.3, r: 0.33 }, { x: -0.8, z: 1.3, r: 0.33 }, { x: 0.8, z: -1.3, r: 0.33 }, { x: -0.8, z: -1.3, r: 0.33 }];
    expect(wheelAt(wheels, 0.85, 0.3, -1.25)).toBe(2);
    expect(wheelAt(wheels, 0.85, 1.2, -1.25)).toBe(-1);
    expect(wheelAt(wheels, 0, 0.3, 0)).toBe(-1);
  });

  it('cuenta los faros que quedan', () => {
    const a = twoTris();
    expect(intactFraction(a, [0, 1])).toBe(1);
    shatter(a, ...triCentroid(a, 0), 0.1);
    expect(intactFraction(a, [0, 1])).toBe(0.5);
    expect(intactFraction(a, [])).toBe(1);
  });
});
