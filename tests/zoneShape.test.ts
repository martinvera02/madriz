import { describe, it, expect } from 'vitest';
import { inZone, outsideCells } from '../src/world/zoneShape';

// centro ancho abajo y norte más estrecho y desplazado arriba (como el mapa real)
const centro = { x0: -2000, x1: 2000, z0: -1500, z1: 1600 };
const norte = { x0: -800, x1: 2900, z0: -7600, z1: -1500 };
const bounds = { x0: -2000, x1: 2900, z0: -7600, z1: 1600 };

describe('forma del mapa', () => {
  it('sabe qué puntos están dentro', () => {
    expect(inZone([centro, norte], 0, 0)).toBe(true);
    expect(inZone([centro, norte], 1000, -6000)).toBe(true);
    expect(inZone([centro, norte], -1500, -6000)).toBe(false);
    expect(inZone([centro, norte], 2500, 0)).toBe(false);
  });

  it('cierra exactamente las esquinas vacías del envoltorio', () => {
    const cells = outsideCells([centro, norte], bounds);
    const area = (b: { x0: number; x1: number; z0: number; z1: number }) => (b.x1 - b.x0) * (b.z1 - b.z0);
    const total = area(bounds), inside = area(centro) + area(norte);
    expect(cells.reduce((s, c) => s + area(c), 0)).toBeCloseTo(total - inside);
    for (const c of cells) expect(inZone([centro, norte], (c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2)).toBe(false);
  });

  it('una zona rectangular no tiene huecos', () => {
    expect(outsideCells([centro], centro)).toEqual([]);
  });
});
