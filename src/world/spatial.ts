import type { WorldData } from './realData';

/** Índice espacial de los tramos de calzada (calles con coches) para consultas rápidas. */
export class CarwayIndex {
  private cells = new Map<string, number[][]>();
  private readonly C = 30;

  constructor(data: WorldData, filter: (hw: string, car: boolean, bridge: boolean) => boolean = (_h, car, br) => car && !br) {
    const N = data.roadNodes;
    data.roads.forEach((r, ri) => {
      if (!filter(r.hw, !!r.car, !!r.br)) return;
      for (let k = 1; k < r.n.length; k++) {
        const seg = [N[r.n[k - 1] * 2], N[r.n[k - 1] * 2 + 1], N[r.n[k] * 2], N[r.n[k] * 2 + 1], r.w / 2, ri];
        const x0 = Math.floor((Math.min(seg[0], seg[2]) - seg[4]) / this.C), x1 = Math.floor((Math.max(seg[0], seg[2]) + seg[4]) / this.C);
        const z0 = Math.floor((Math.min(seg[1], seg[3]) - seg[4]) / this.C), z1 = Math.floor((Math.max(seg[1], seg[3]) + seg[4]) / this.C);
        for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
          const key = i + ',' + j;
          let arr = this.cells.get(key);
          if (!arr) this.cells.set(key, (arr = []));
          arr.push(seg);
        }
      }
    });
  }

  /** ¿El punto está sobre una calzada (con margen extra `pad`)? Puede ignorar una vía concreta. */
  on(x: number, z: number, pad = 0, ignoreRoad = -1): boolean {
    const arr = this.cells.get(Math.floor(x / this.C) + ',' + Math.floor(z / this.C));
    if (!arr) return false;
    for (const [ax, az, bx, bz, hw, ri] of arr) {
      if (ri === ignoreRoad) continue;
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-6;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const r = hw + pad;
      if ((x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2 < r * r) return true;
    }
    return false;
  }

  /** Tramo de calzada más cercano (hasta ~30 m): dirección y distancia al eje. */
  nearest(x: number, z: number): { dx: number; dz: number; d: number; px: number; pz: number; hw: number } | null {
    let best: { dx: number; dz: number; d: number; px: number; pz: number; hw: number } | null = null;
    const ci = Math.floor(x / this.C), cj = Math.floor(z / this.C);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      for (const [ax, az, bx, bz, hw] of this.cells.get(i + ',' + j) ?? []) {
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-6;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        const px = ax + dx * t, pz = az + dz * t;
        const d = Math.hypot(x - px, z - pz);
        if (!best || d < best.d) { const l = Math.sqrt(l2); best = { dx: dx / l, dz: dz / l, d, px, pz, hw }; }
      }
    }
    return best;
  }
}

/** Índice de plantas de edificios para saber si un punto cae dentro de alguno. */
export class FootprintIndex {
  private cells = new Map<string, { pts: number[]; top: number; id: number }[]>();
  private readonly C = 25;

  add(pts: number[], top: number, id: number) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
      z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]);
    }
    const e = { pts, top, id };
    for (let i = Math.floor(x0 / this.C); i <= Math.floor(x1 / this.C); i++) {
      for (let j = Math.floor(z0 / this.C); j <= Math.floor(z1 / this.C); j++) {
        const key = i + ',' + j;
        let arr = this.cells.get(key);
        if (!arr) this.cells.set(key, (arr = []));
        arr.push(e);
      }
    }
  }

  /** Altura de la cubierta del edificio que contiene el punto (o -Infinity), ignorando `selfId`. */
  topAt(x: number, z: number, selfId = -1): number {
    let best = -Infinity;
    for (const e of this.cells.get(Math.floor(x / this.C) + ',' + Math.floor(z / this.C)) ?? []) {
      if (e.id === selfId || e.top <= best) continue;
      if (inRing(x, z, e.pts)) best = e.top;
    }
    return best;
  }
}

export function inRing(x: number, z: number, pts: number[]) {
  let inside = false;
  for (let i = 0, j = pts.length / 2 - 1; i < pts.length / 2; j = i++) {
    const xi = pts[i * 2], zi = pts[i * 2 + 1], xj = pts[j * 2], zj = pts[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Rectángulo orientado mínimo aproximado (por componentes principales). */
export function obb(pts: number[]) {
  const n = pts.length / 2;
  let cx = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += pts[i * 2]; cz += pts[i * 2 + 1]; }
  cx /= n; cz /= n;
  // probar la orientación de cada arista y quedarse con la de menor área
  let best = { area: Infinity, ux: 1, uz: 0, l: 0, w: 0, cx, cz };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ux = pts[j * 2] - pts[i * 2], uz = pts[j * 2 + 1] - pts[i * 2 + 1];
    const l = Math.hypot(ux, uz);
    if (l < 0.3) continue;
    ux /= l; uz /= l;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = pts[k * 2] - cx, z = pts[k * 2 + 1] - cz;
      const a = x * ux + z * uz, b = -x * uz + z * ux;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    const area = (a1 - a0) * (b1 - b0);
    if (area < best.area) {
      const ma = (a0 + a1) / 2, mb = (b0 + b1) / 2;
      best = { area, ux, uz, l: a1 - a0, w: b1 - b0, cx: cx + ux * ma - uz * mb, cz: cz + uz * ma + ux * mb };
    }
  }
  if (best.w > best.l) best = { ...best, ux: -best.uz, uz: best.ux, l: best.w, w: best.l };
  return best;
}
