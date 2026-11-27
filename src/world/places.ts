import type { AreaData } from './realData';
import { pointInRing } from './buildings';

/**
 * Consultas de lugar que no dependen de la escena: cuánto verde hay alrededor (para pájaros y grillos)
 * y cómo se llama el sitio donde está el jugador.
 */

/** Densidad de arbolado 0..1 en un radio de ~60 m, a partir de las coordenadas de los árboles (x, z, x, z…). */
export function makeGreenAt(trees: ArrayLike<number>, cell = 40) {
  const cells = new Map<string, number>();
  for (let i = 0; i + 1 < trees.length; i += 2) {
    const k = Math.floor(trees[i] / cell) + ',' + Math.floor(trees[i + 1] / cell);
    cells.set(k, (cells.get(k) ?? 0) + 1);
  }
  return (x: number, z: number) => {
    let n = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) n += cells.get((Math.floor(x / cell) + i) + ',' + (Math.floor(z / cell) + j)) ?? 0;
    return Math.min(1, n / 40);
  };
}

/**
 * Nombre del lugar: la plaza o el parque con nombre más pequeño que contiene el punto; si no hay,
 * lo que devuelva `street` (la calle más cercana) o «Madrid».
 */
export function makePlaceNamer(areas: AreaData[], street: (x: number, z: number) => string | null | undefined) {
  const named = areas.filter((a) => a.name && (a.kind === 'plaza' || a.kind === 'grass' || a.kind === 'wood')).map((a) => {
    let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < a.pts.length; i += 2) {
      xmin = Math.min(xmin, a.pts[i]); xmax = Math.max(xmax, a.pts[i]);
      zmin = Math.min(zmin, a.pts[i + 1]); zmax = Math.max(zmax, a.pts[i + 1]);
    }
    return { a, xmin, xmax, zmin, zmax, area: (xmax - xmin) * (zmax - zmin) };
  }).sort((p, q) => p.area - q.area);
  return (x: number, z: number): string => {
    for (const n of named) {
      if (x < n.xmin || x > n.xmax || z < n.zmin || z > n.zmax) continue;
      if (pointInRing(x, z, n.a.pts)) return n.a.name!;
    }
    return street(x, z) || 'Madrid';
  };
}
