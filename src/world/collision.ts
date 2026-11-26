const OFFSET = 8192; // el mundo cabe en ±8 km

// `h` = altura absoluta de la parte superior; `y0` = altura absoluta de la parte inferior
// (por debajo se puede pasar: soportales, bajo un puente…).
export interface BoxCollider { kind: 'box'; minX: number; maxX: number; minZ: number; maxZ: number; h: number; y0?: number; }
export interface CircleCollider { kind: 'circle'; x: number; z: number; r: number; h: number; y0?: number; }
/** Pared fina entre dos puntos (aristas de los edificios reales). */
export interface SegCollider { kind: 'seg'; ax: number; az: number; bx: number; bz: number; h: number; y0?: number; }
export type Collider = BoxCollider | CircleCollider | SegCollider;

export interface Hit { nx: number; nz: number; depth: number; }

/**
 * Colisiones 2D (planta) con altura. Hash espacial de celdas fijas: cada collider
 * se registra en todas las celdas que toca, y las consultas solo miran las celdas cercanas.
 */
export class CollisionWorld {
  private readonly cell = 20;
  private readonly cols = Math.ceil((OFFSET * 2) / 20);
  private readonly cells = new Map<number, Collider[]>();

  private key(cx: number, cz: number) { return cz * this.cols + cx; }
  private cellOf(v: number) { return Math.floor((v + OFFSET) / this.cell); }

  add(c: Collider) {
    const [minX, maxX, minZ, maxZ] = c.kind === 'box'
      ? [c.minX, c.maxX, c.minZ, c.maxZ]
      : c.kind === 'circle'
        ? [c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r]
        : [Math.min(c.ax, c.bx), Math.max(c.ax, c.bx), Math.min(c.az, c.bz), Math.max(c.az, c.bz)];
    for (let cz = this.cellOf(minZ); cz <= this.cellOf(maxZ); cz++) {
      for (let cx = this.cellOf(minX); cx <= this.cellOf(maxX); cx++) {
        const k = this.key(cx, cz);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(c);
      }
    }
  }

  addBox(minX: number, minZ: number, maxX: number, maxZ: number, h: number) {
    this.add({ kind: 'box', minX, maxX, minZ, maxZ, h });
  }
  addCircle(x: number, z: number, r: number, h: number, y0?: number) {
    this.add({ kind: 'circle', x, z, r, h, y0 });
  }
  addSeg(ax: number, az: number, bx: number, bz: number, h: number, y0?: number) {
    this.add({ kind: 'seg', ax, az, bx, bz, h, y0 });
  }

  private seen = new Set<Collider>();
  private out: Collider[] = [];
  query(x: number, z: number, r: number): Collider[] {
    this.seen.clear();
    this.out.length = 0;
    for (let cz = this.cellOf(z - r); cz <= this.cellOf(z + r); cz++) {
      for (let cx = this.cellOf(x - r); cx <= this.cellOf(x + r); cx++) {
        const arr = this.cells.get(this.key(cx, cz));
        if (!arr) continue;
        for (const c of arr) if (!this.seen.has(c)) { this.seen.add(c); this.out.push(c); }
      }
    }
    return this.out;
  }

  /**
   * Empuja un círculo (x,z,r) fuera de los colliders cuya altura supere `y`.
   * Modifica `pos` y devuelve la normal acumulada del choque (o null si no hubo).
   */
  resolveCircle(pos: { x: number; z: number }, r: number, y = 0): Hit | null {
    let hit: Hit | null = null;
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      for (const c of this.query(pos.x, pos.z, r + 1)) {
        if (c.h <= y + 0.35) continue; // se puede pasar por encima (bordillos, saltos)
        if (c.y0 !== undefined && y + 1.6 < c.y0) continue; // se puede pasar por debajo
        const h = c.kind === 'box' ? pushBox(pos, r, c) : c.kind === 'circle' ? pushCircle(pos, r, c) : pushSeg(pos, r, c);
        if (h) {
          any = true;
          if (!hit) hit = { nx: 0, nz: 0, depth: 0 };
          hit.nx += h.nx; hit.nz += h.nz; hit.depth = Math.max(hit.depth, h.depth);
        }
      }
      if (!any) break;
    }
    if (hit) {
      const l = Math.hypot(hit.nx, hit.nz) || 1;
      hit.nx /= l; hit.nz /= l;
    }
    return hit;
  }

  /** ¿El punto está dentro de algún sólido? (para la cámara) */
  pointBlocked(x: number, y: number, z: number): boolean {
    for (const c of this.query(x, z, 0.5)) {
      if (y > c.h || (c.y0 !== undefined && y < c.y0)) continue;
      if (c.kind === 'seg') {
        if (segDist2(x, z, c) < 0.25) return true;
        continue;
      }
      if (c.kind === 'box') {
        if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return true;
      } else if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) return true;
    }
    return false;
  }

  /** Altura del suelo sólido bajo el punto (para subirse encima de cosas bajas). */
  groundHeight(x: number, z: number, y: number, floor = 0): number {
    let g = floor;
    for (const c of this.query(x, z, 0.3)) {
      if (c.h > y + 0.35 || c.kind === 'seg') continue;
      const inside = c.kind === 'box'
        ? x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ
        : (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r;
      if (inside && c.h > g) g = c.h;
    }
    return g;
  }
}

function pushBox(pos: { x: number; z: number }, r: number, b: BoxCollider): Hit | null {
  const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
  const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
  let dx = pos.x - cx;
  let dz = pos.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 > r * r) return null;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    dx /= d; dz /= d;
    const depth = r - d;
    pos.x += dx * depth; pos.z += dz * depth;
    return { nx: dx, nz: dz, depth };
  }
  // Centro dentro de la caja: salir por el lado más cercano
  const l = pos.x - b.minX, rr = b.maxX - pos.x, t = pos.z - b.minZ, bt = b.maxZ - pos.z;
  const m = Math.min(l, rr, t, bt);
  if (m === l) { pos.x = b.minX - r; return { nx: -1, nz: 0, depth: l + r }; }
  if (m === rr) { pos.x = b.maxX + r; return { nx: 1, nz: 0, depth: rr + r }; }
  if (m === t) { pos.z = b.minZ - r; return { nx: 0, nz: -1, depth: t + r }; }
  pos.z = b.maxZ + r;
  return { nx: 0, nz: 1, depth: bt + r };
}

function segDist2(x: number, z: number, s: SegCollider) {
  const dx = s.bx - s.ax, dz = s.bz - s.az;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
  const px = s.ax + dx * t, pz = s.az + dz * t;
  return (x - px) ** 2 + (z - pz) ** 2;
}

function pushSeg(pos: { x: number; z: number }, r: number, s: SegCollider): Hit | null {
  const dx = s.bx - s.ax, dz = s.bz - s.az;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((pos.x - s.ax) * dx + (pos.z - s.az) * dz) / l2));
  const px = s.ax + dx * t, pz = s.az + dz * t;
  let nx = pos.x - px, nz = pos.z - pz;
  const d2 = nx * nx + nz * nz;
  if (d2 >= r * r) return null;
  const d = Math.sqrt(d2);
  if (d < 1e-5) { nx = -dz; nz = dx; } // justo encima: empujar según la normal del segmento
  const l = Math.hypot(nx, nz) || 1;
  nx /= l; nz /= l;
  const depth = r - d;
  pos.x += nx * depth; pos.z += nz * depth;
  return { nx, nz, depth };
}

function pushCircle(pos: { x: number; z: number }, r: number, c: CircleCollider): Hit | null {
  let dx = pos.x - c.x;
  let dz = pos.z - c.z;
  const rr = r + c.r;
  const d2 = dx * dx + dz * dz;
  if (d2 >= rr * rr) return null;
  const d = Math.sqrt(d2) || 1e-4;
  dx /= d; dz /= d;
  const depth = rr - d;
  pos.x += dx * depth; pos.z += dz * depth;
  return { nx: dx, nz: dz, depth };
}
