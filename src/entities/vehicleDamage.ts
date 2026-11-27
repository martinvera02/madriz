/**
 * Daño visible de los vehículos, sobre geometrías sin índices (tres vértices seguidos por triángulo),
 * en coordenadas locales del coche: +x izquierda, +y arriba, +z delante.
 *
 * Funciones puras sobre Float32Array para poder probarlas sin escena.
 */

/** Centroide del triángulo `t` (índice de triángulo, no de vértice). */
export function triCentroid(arr: ArrayLike<number>, t: number): [number, number, number] {
  const i = t * 9;
  return [(arr[i] + arr[i + 3] + arr[i + 6]) / 3, (arr[i + 1] + arr[i + 4] + arr[i + 7]) / 3, (arr[i + 2] + arr[i + 5] + arr[i + 8]) / 3];
}

/** ¿El triángulo ya está roto (sus tres vértices juntos)? */
export function isCollapsed(arr: ArrayLike<number>, t: number) {
  const i = t * 9;
  return arr[i] === arr[i + 3] && arr[i] === arr[i + 6] && arr[i + 1] === arr[i + 4] && arr[i + 1] === arr[i + 7] && arr[i + 2] === arr[i + 5] && arr[i + 2] === arr[i + 8];
}

/**
 * Rompe (encoge hasta su centroide, así deja de verse) los triángulos cuyo centroide quede a menos de `r`
 * del punto. `only` limita a ciertos triángulos (p. ej. solo faros). Devuelve los centroides de lo roto
 * para soltar esquirlas en ese sitio.
 */
export function shatter(arr: Float32Array, px: number, py: number, pz: number, r: number, only?: (t: number) => boolean): [number, number, number][] {
  const out: [number, number, number][] = [];
  const n = arr.length / 9, r2 = r * r;
  for (let t = 0; t < n; t++) {
    if (only && !only(t)) continue;
    if (isCollapsed(arr, t)) continue;
    const c = triCentroid(arr, t);
    if ((c[0] - px) ** 2 + (c[1] - py) ** 2 + (c[2] - pz) ** 2 > r2) continue;
    const i = t * 9;
    for (let k = 0; k < 9; k += 3) { arr[i + k] = c[0]; arr[i + k + 1] = c[1]; arr[i + k + 2] = c[2]; }
    out.push(c);
  }
  return out;
}

/**
 * Abolladura: hunde los vértices a menos de `r` del punto en la dirección (lx, lz) del golpe, con caída
 * suave, sin alejarse más de `limit` de la forma original. Devuelve si movió algo.
 */
export function dent(arr: Float32Array, orig: ArrayLike<number>, px: number, py: number, pz: number,
  lx: number, lz: number, r: number, depth: number, limit = 0.35): boolean {
  let moved = false;
  for (let i = 0; i < arr.length; i += 3) {
    const ddx = arr[i] - px, ddy = arr[i + 1] - py, ddz = arr[i + 2] - pz;
    const dist = Math.sqrt(ddx * ddx + ddy * ddy * 0.5 + ddz * ddz);
    if (dist > r) continue;
    const f = depth * (1 - dist / r) ** 2;
    const nx = arr[i] - lx * f, ny = arr[i + 1] - f * 0.25, nz = arr[i + 2] - lz * f;
    const ox = orig[i], oy = orig[i + 1], oz = orig[i + 2];
    const dd = Math.hypot(nx - ox, ny - oy, nz - oz);
    const lim = dd > limit ? limit / dd : 1;
    arr[i] = ox + (nx - ox) * lim; arr[i + 1] = oy + (ny - oy) * lim; arr[i + 2] = oz + (nz - oz) * lim;
    moved = true;
  }
  return moved;
}

/** Rueda alcanzada por un disparo en el punto local (o -1): cerca del buje y por debajo de su parte alta. */
export function wheelAt(wheels: { x: number; z: number; r: number }[], lx: number, ly: number, lz: number) {
  let best = -1, bd = Infinity;
  wheels.forEach((w, i) => {
    if (ly > w.r * 2 + 0.05) return;
    const d = Math.hypot(lx - w.x, lz - w.z);
    if (d < w.r + 0.18 && d < bd) { bd = d; best = i; }
  });
  return best;
}

/** Fracción de faros que siguen enteros (para la luz que proyecta el coche del jugador). */
export function intactFraction(arr: ArrayLike<number>, tris: number[]) {
  if (!tris.length) return 1;
  let ok = 0;
  for (const t of tris) if (!isCollapsed(arr, t)) ok++;
  return ok / tris.length;
}
