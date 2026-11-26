import type { WorldData, RoadData } from '../world/realData';

/** Velocidad de crucero (m/s) por tipo de vía. */
export const SPEED: Record<string, number> = {
  motorway: 22, trunk: 18, primary: 13.9, secondary: 12.5, tertiary: 11, unclassified: 9, residential: 8.3,
  living_street: 5.5, service: 5, motorway_link: 14, trunk_link: 12, primary_link: 10, secondary_link: 10, tertiary_link: 9,
};

export interface Edge {
  id: number;
  from: number;
  to: number;
  road: RoadData;
  len: number;
  dx: number; // dirección unitaria
  dz: number;
}

/**
 * Grafo dirigido de la red viaria real (OSM). Respeta los sentidos únicos para el tráfico.
 * Para peatones se construye sin sentidos y con calles peatonales, aceras, escaleras…
 */
export class RoadGraph {
  readonly edges: Edge[] = [];
  readonly out = new Map<number, Edge[]>();
  readonly N: number[];

  constructor(data: WorldData, readonly mode: 'cars' | 'walk') {
    this.N = data.roadNodes;
    for (const r of data.roads) {
      if (mode === 'cars' && (!r.car || r.hw === 'service')) continue;
      if (mode === 'walk' && (r.hw === 'motorway' || r.hw === 'trunk' || r.hw === 'motorway_link' || r.hw === 'trunk_link')) continue;
      for (let i = 1; i < r.n.length; i++) {
        const a = r.n[i - 1], b = r.n[i];
        if (a === b) continue;
        const fwd = mode === 'walk' || r.ow !== -1;
        const back = mode === 'walk' || !r.ow;
        if (fwd) this.addEdge(a, b, r);
        if (back) this.addEdge(b, a, r);
      }
    }
  }

  private addEdge(from: number, to: number, road: RoadData) {
    const N = this.N;
    const dx = N[to * 2] - N[from * 2], dz = N[to * 2 + 1] - N[from * 2 + 1];
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    const e: Edge = { id: this.edges.length, from, to, road, len, dx: dx / len, dz: dz / len };
    this.edges.push(e);
    let arr = this.out.get(from);
    if (!arr) this.out.set(from, (arr = []));
    arr.push(e);
  }

  private cells: Map<string, Edge[]> | null = null;
  private buildIndex() {
    this.cells = new Map();
    for (const e of this.edges) {
      const ax = this.x(e.from), az = this.z(e.from), bx = this.x(e.to), bz = this.z(e.to);
      const steps = Math.ceil(e.len / 10);
      const seen = new Set<string>();
      for (let k = 0; k <= steps; k++) {
        const key = `${Math.floor((ax + ((bx - ax) * k) / steps) / 25)},${Math.floor((az + ((bz - az) * k) / steps) / 25)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let arr = this.cells.get(key);
        if (!arr) this.cells.set(key, (arr = []));
        arr.push(e);
      }
    }
  }

  /** Arista más cercana usando un índice espacial (radio de búsqueda ~50 m). */
  nearestEdgeFast(x: number, z: number, filter?: (e: Edge) => boolean): Edge | null {
    if (!this.cells) this.buildIndex();
    let best: Edge | null = null, bd = Infinity;
    const ci = Math.floor(x / 25), cj = Math.floor(z / 25);
    for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
      for (const e of this.cells!.get(`${ci + di},${cj + dj}`) ?? []) {
        if (filter && !filter(e)) continue;
        const ax = this.x(e.from), az = this.z(e.from);
        const t = Math.max(0, Math.min(e.len, (x - ax) * e.dx + (z - az) * e.dz));
        const d = (x - ax - e.dx * t) ** 2 + (z - az - e.dz * t) ** 2;
        if (d < bd) { bd = d; best = e; }
      }
    }
    return best;
  }

  /** Aristas en un radio de ~50 m, con la distancia al punto y el parámetro de la proyección (m). */
  edgesNear(x: number, z: number): { e: Edge; d: number; t: number }[] {
    if (!this.cells) this.buildIndex();
    const out: { e: Edge; d: number; t: number }[] = [];
    const seen = new Set<number>();
    const ci = Math.floor(x / 25), cj = Math.floor(z / 25);
    for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
      for (const e of this.cells!.get(`${ci + di},${cj + dj}`) ?? []) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        const ax = this.x(e.from), az = this.z(e.from);
        const t = Math.max(0, Math.min(e.len, (x - ax) * e.dx + (z - az) * e.dz));
        out.push({ e, t, d: Math.hypot(x - ax - e.dx * t, z - az - e.dz * t) });
      }
    }
    return out;
  }

  x(n: number) { return this.N[n * 2]; }
  z(n: number) { return this.N[n * 2 + 1]; }

  /** Siguiente arista al llegar al final de `e`: prefiere seguir por la misma calle y evita giros de 180°. */
  next(e: Edge, rng: () => number): Edge | null {
    const opts = this.out.get(e.to) ?? [];
    const cands = opts.filter((o) => o.to !== e.from);
    if (!cands.length) return opts[0] ?? null; // calle sin salida: media vuelta
    const same = cands.filter((o) => o.road === e.road || (o.road.name && o.road.name === e.road.name));
    if (same.length && rng() < 0.6) return same[Math.floor(rng() * same.length)];
    // ponderar por lo recto del giro
    const w = cands.map((o) => Math.max(0.05, 1 + (o.dx * e.dx + o.dz * e.dz)));
    let s = w.reduce((a, b) => a + b, 0) * rng();
    for (let i = 0; i < cands.length; i++) { s -= w[i]; if (s <= 0) return cands[i]; }
    return cands[cands.length - 1];
  }

  /** Arista aleatoria con punto medio a una distancia [minR, maxR] de (x,z). */
  randomEdgeNear(x: number, z: number, minR: number, maxR: number, rng: () => number, filter?: (e: Edge) => boolean): Edge | null {
    for (let tries = 0; tries < 60; tries++) {
      const e = this.edges[Math.floor(rng() * this.edges.length)];
      const mx = (this.x(e.from) + this.x(e.to)) / 2, mz = (this.z(e.from) + this.z(e.to)) / 2;
      const d = Math.hypot(mx - x, mz - z);
      if (d < minR || d > maxR) continue;
      if (filter && !filter(e)) continue;
      return e;
    }
    // Búsqueda exhaustiva como último recurso
    const pool = this.edges.filter((e) => {
      const mx = (this.x(e.from) + this.x(e.to)) / 2, mz = (this.z(e.from) + this.z(e.to)) / 2;
      const d = Math.hypot(mx - x, mz - z);
      return d >= minR && d <= maxR && (!filter || filter(e));
    });
    return pool.length ? pool[Math.floor(rng() * pool.length)] : null;
  }

  /** Arista más cercana a un punto (para colocar el coche del jugador, etc.). */
  nearestEdge(x: number, z: number, filter?: (e: Edge) => boolean): { e: Edge; t: number; d: number } | null {
    let best: { e: Edge; t: number; d: number } | null = null;
    for (const e of this.edges) {
      if (filter && !filter(e)) continue;
      const ax = this.x(e.from), az = this.z(e.from);
      const t = Math.max(0, Math.min(1, ((x - ax) * e.dx + (z - az) * e.dz) / e.len));
      const px = ax + e.dx * e.len * t, pz = az + e.dz * e.len * t;
      const d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) best = { e, t, d };
    }
    return best;
  }

  /** Desplazamiento lateral del carril (positivo = a la derecha del sentido de marcha). */
  laneOffset(e: Edge, bias = 0): number {
    const r = e.road;
    if (this.mode === 'walk') return r.car ? r.w / 2 + 1.6 : bias * Math.max(0, r.w / 2 - 0.8);
    if (!r.ow) return Math.max(1.4, Math.min(r.w / 4, 2.8));
    // Sentido único: se circula por la mitad izquierda/central; el cordón de la derecha es para aparcar
    const free = Math.max(0, r.w / 2 - 2.0);
    return (bias * 0.5 - 0.5) * free;
  }

  /** Punto en la arista a distancia `s` del inicio, desplazado `off` a la derecha. */
  pointOn(e: Edge, s: number, off: number, out: { x: number; z: number }) {
    // derecha de la dirección (dx,dz) en planta con Z hacia el sur: (-dz, dx)
    out.x = this.x(e.from) + e.dx * s - e.dz * off;
    out.z = this.z(e.from) + e.dz * s + e.dx * off;
    return out;
  }
}
