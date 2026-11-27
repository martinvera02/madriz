import { describe, it, expect } from 'vitest';
import { Ground } from '../src/world/roads';
import type { Terrain } from '../src/world/terrain';

/** Terreno plano a 10 m: las pruebas solo miran los tableros. */
const flat = { heightAt: () => 10 } as unknown as Terrain;

describe('Ground.heightAt', () => {
  it('sin tableros devuelve el terreno', () => {
    expect(new Ground(flat).heightAt(3, 4)).toBe(10);
  });

  it('un puente cuenta si vienes de arriba y no si pasas por debajo', () => {
    const g = new Ground(flat);
    g.addDeckSegment(0, 0, 100, 0, 16, 16, 5);
    expect(g.heightAt(50, 0)).toBe(16);
    expect(g.heightAt(50, 0, 16.1)).toBe(16);
    expect(g.heightAt(50, 0, 10)).toBe(10); // por debajo del puente
    expect(g.heightAt(50, 8)).toBe(10); // fuera del ancho
  });

  it('interpola la altura a lo largo de una rampa', () => {
    const g = new Ground(flat);
    g.addDeckSegment(0, 0, 100, 0, 12, 22, 5);
    expect(g.heightAt(50, 0)).toBeCloseTo(17);
  });

  it('un suelo interior vale bajo la calle si ya estás en él (sótanos, túnel)', () => {
    const g = new Ground(flat);
    g.addDeckSegment(0, 0, 40, 0, 2.5, 2.5, 6, true); // 7,5 m bajo el terreno
    expect(g.heightAt(20, 0, 2.6)).toBeCloseTo(2.5);
    // desde la calle (sin altura o a la altura del terreno) no se cae al sótano
    expect(g.heightAt(20, 0)).toBe(10);
    expect(g.heightAt(20, 0, 10)).toBe(10);
  });

  it('con varias plantas interiores elige la que tienes justo debajo', () => {
    const g = new Ground(flat);
    g.addDeckSegment(0, 0, 40, 0, 10, 10, 6, true);
    g.addDeckSegment(0, 0, 40, 0, 14, 14, 6, true);
    expect(g.heightAt(20, 0, 10.1)).toBe(10);
    expect(g.heightAt(20, 0, 14.2)).toBe(14);
  });
});
