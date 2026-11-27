import { describe, it, expect } from 'vitest';
import { wantedUnits, UIP_STARS, HELI_STARS } from '../src/systems/police';

describe('policía', () => {
  it('más unidades cuantas más estrellas, con tope', () => {
    expect(wantedUnits(0)).toBe(0);
    expect(wantedUnits(1)).toBe(1);
    expect(wantedUnits(3)).toBe(4);
    expect(wantedUnits(5)).toBe(6);
    for (let s = 1; s <= 5; s++) expect(wantedUnits(s)).toBeGreaterThanOrEqual(wantedUnits(s - 1));
  });
  it('la UIP llega antes que el helicóptero', () => {
    expect(UIP_STARS).toBeLessThan(HELI_STARS);
    expect(HELI_STARS).toBe(5);
  });
});
