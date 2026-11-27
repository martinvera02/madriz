import { describe, it, expect } from 'vitest';
import { findCover, shielded, alongCover } from '../src/systems/cover';

/** Un muro alto en z = 0 (de x = -10 a 10) y un murete bajo (1 m) en x = 20. */
const solid = (x: number, y: number, z: number) =>
  (Math.abs(z) < 0.15 && Math.abs(x) < 10 && y < 3) || (Math.abs(x - 20) < 0.3 && Math.abs(z) < 3 && y < 1);

describe('coberturas', () => {
  it('encuentra el muro y su normal apunta hacia el jugador', () => {
    const c = findCover(solid, 0, 0, 1)!;
    expect(c).not.toBeNull();
    expect(c.nz).toBeCloseTo(1, 1);
    expect(c.low).toBe(false);
  });

  it('distingue una cobertura baja', () => {
    const c = findCover(solid, 19, 0, 0)!;
    expect(c.low).toBe(true);
    expect(c.nx).toBeCloseTo(-1, 1);
  });

  it('nada a menos de 1,5 m: no hay cobertura', () => {
    expect(findCover(solid, 0, 0, 5)).toBeNull();
  });

  it('protege del tirador que está al otro lado, no del que está a tu lado', () => {
    const c = findCover(solid, 0, 0, 1)!;
    expect(shielded(c, true, 0, -20)).toBe(true);
    expect(shielded(c, true, 0, 20)).toBe(false);
    // asomado para apuntar ya no protege
    expect(shielded(c, false, 0, -20)).toBe(false);
  });

  it('el movimiento a cubierto va a lo largo del muro', () => {
    const c = findCover(solid, 0, 0, 1)!;
    const [tx, tz] = alongCover(c, 1);
    expect(Math.abs(tx)).toBeCloseTo(1, 1);
    expect(Math.abs(tz)).toBeLessThan(0.2);
  });
});
