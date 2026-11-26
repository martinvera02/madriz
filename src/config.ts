// Escala del mundo: 1 unidad = 1 metro. El mapa es una rejilla de GRID x GRID casillas de TILE metros.
export const TILE = 20;
export const GRID = 120;
export const WORLD = TILE * GRID; // 2400 m de lado
export const HALF = WORLD / 2;

/** Centro de la casilla i (eje X o Z) en coordenadas de mundo. */
export function tileCenter(i: number): number {
  return (i - GRID / 2) * TILE + TILE / 2;
}

/** Casilla que contiene la coordenada de mundo x. */
export function worldToTile(x: number): number {
  return Math.floor((x + HALF) / TILE);
}

// Generador pseudoaleatorio con semilla (mulberry32): el mapa sale igual en cada partida.
export function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Diferencia angular normalizada a (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
