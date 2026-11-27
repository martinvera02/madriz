import { describe, it, expect } from 'vitest';
import { makeGreenAt, makePlaceNamer } from '../src/world/places';
import type { AreaData } from '../src/world/realData';

describe('makeGreenAt', () => {
  it('es 0 donde no hay árboles y satura en 1 en un bosque', () => {
    const trees: number[] = [];
    for (let i = 0; i < 100; i++) trees.push(500 + (i % 10) * 3, 500 + Math.floor(i / 10) * 3);
    const green = makeGreenAt(trees);
    expect(green(0, 0)).toBe(0);
    expect(green(510, 510)).toBe(1);
  });

  it('cuenta las celdas vecinas, no solo la propia', () => {
    const green = makeGreenAt([45, 5]); // un árbol en la celda (1, 0)
    expect(green(5, 5)).toBeCloseTo(1 / 40);
    expect(green(200, 200)).toBe(0);
  });
});

describe('makePlaceNamer', () => {
  const sq = (x0: number, z0: number, s: number) => [x0, z0, x0 + s, z0, x0 + s, z0 + s, x0, z0 + s];
  const areas: AreaData[] = [
    { kind: 'grass', name: 'Parque Grande', pts: sq(0, 0, 200) },
    { kind: 'plaza', name: 'Plaza Chica', pts: sq(50, 50, 20) },
    { kind: 'water', name: 'Estanque', pts: sq(100, 100, 30) },
  ];
  const name = makePlaceNamer(areas, (x) => (x > 1000 ? 'Calle Mayor' : null));

  it('elige el área con nombre más pequeña que contiene el punto', () => {
    expect(name(60, 60)).toBe('Plaza Chica');
    expect(name(10, 10)).toBe('Parque Grande');
  });
  it('ignora las áreas que no son plaza, césped o bosque', () => {
    expect(name(110, 110)).toBe('Parque Grande');
  });
  it('cae en la calle más cercana y, si no hay, en «Madrid»', () => {
    expect(name(2000, 2000)).toBe('Calle Mayor');
    expect(name(-500, -500)).toBe('Madrid');
  });
});
