import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { WorldData } from '../src/world/realData';

/**
 * Comprobaciones de los datos del mapa (public/data/madrid.json). Buscan las trampas de OSM que ya
 * nos han mordido: contornos de puente etiquetados como edificio, índices rotos, coordenadas fuera.
 */
const data = JSON.parse(readFileSync(new URL('../public/data/madrid.json', import.meta.url), 'utf8')) as WorldData;
const B = data.bounds;

describe('datos de madrid.json', () => {
  it('todas las calles apuntan a nodos que existen', () => {
    const n = data.roadNodes.length / 2;
    const bad = data.roads.filter((r) => r.n.some((i) => !Number.isInteger(i) || i < 0 || i >= n));
    expect(bad.map((r) => r.id)).toEqual([]);
  });

  it('los edificios tienen planta y altura válidas', () => {
    // h = 0 se admite: OSM no trae la altura y buildings.ts pone cinco plantas
    const bad = data.buildings.filter((b) => b.pts.length < 6 || b.pts.length % 2 || !(b.h >= 0) || b.pts.some((v) => !Number.isFinite(v)));
    expect(bad.map((b) => b.id)).toEqual([]);
  });

  it('pocos edificios sin altura (si salen muchos, el script de datos ha perdido las alturas)', () => {
    expect(data.buildings.filter((b) => !(b.h > 0)).length).toBeLessThan(20);
  });

  it('todo está dentro de los límites del mapa (con 300 m de margen)', () => {
    const out = (x: number, z: number) => x < B.x0 - 300 || x > B.x1 + 300 || z < B.z0 - 300 || z > B.z1 + 300;
    const bad = data.buildings.filter((b) => out(b.pts[0], b.pts[1]));
    expect(bad.map((b) => b.id)).toEqual([]);
  });

  it('los únicos «edificios» con nombre de puente son los que el juego sustituye (Segovia y del Rey)', () => {
    const bridges = data.buildings.filter((b) => /^(puente|pasarela|presa|viaducto)\b/i.test((b as { name?: string }).name ?? ''));
    expect(bridges.map((b) => (b as { name?: string }).name).sort()).toEqual(['Puente de Segovia', 'Puente del Rey']);
  });

  it('siguen existiendo los edificios con interior', () => {
    const names = new Set(data.buildings.map((b) => (b as { name?: string }).name));
    for (const n of ['Mercado de San Miguel', 'Círculo de Bellas Artes']) expect(names.has(n), n).toBe(true);
  });
});
