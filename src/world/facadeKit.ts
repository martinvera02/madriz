import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PlacedBuilding } from './buildings';
import { pointInRing } from './buildings';

/*
 * Kit de fachada en relieve: cornisas, impostas, zócalos, pilastras, columnas,
 * balaustradas, pináculos… colocados sobre las aristas exteriores reales (OSM) de un edificio.
 * Todo se acumula por material y se fusiona en pocas mallas.
 */

export interface FacadeEdge {
  ax: number; az: number; bx: number; bz: number;
  nx: number; nz: number; // normal hacia fuera
  len: number;
  ground: number; // cota de la calle bajo el edificio
  top: number; // cota de la cubierta de la parte
  part: PlacedBuilding;
}

/** Aristas exteriores de un conjunto de partes: sin las compartidas entre partes ni las medianeras con otros edificios. */
export function outerEdges(parts: PlacedBuilding[], neighbours: PlacedBuilding[]): FacadeEdge[] {
  const raw: FacadeEdge[] = [];
  for (const p of parts) {
    const pts = p.data.pts, n = pts.length / 2;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
    }
    const flip = area > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.8) continue;
      raw.push({ ax, az, bx, bz, nx: ((bz - az) / len) * flip, nz: (-(bx - ax) / len) * flip, len, ground: p.ground, top: p.top, part: p });
    }
  }
  const others = neighbours.filter((q) => !parts.includes(q));
  const isCovered = (x: number, z: number, y: number, self: PlacedBuilding) => {
    for (const q of parts) if (q !== self && q.top >= y - 0.5 && pointInRing(x, z, q.data.pts)) return true;
    for (const q of others) if (q.top >= y - 3 && pointInRing(x, z, q.data.pts)) return true;
    return false;
  };
  // Una arista es exterior si justo delante de ella (a 0,8 m) no hay otra parte igual de alta ni otro edificio
  const outer = raw.filter((e) => {
    let covered = 0;
    for (const t of [0.2, 0.5, 0.8]) {
      const x = e.ax + (e.bx - e.ax) * t + e.nx * 0.8, z = e.az + (e.bz - e.az) * t + e.nz * 0.8;
      if (isCovered(x, z, e.top, e.part)) covered++;
    }
    return covered < 2;
  });
  return mergeRuns(outer);
}

/**
 * Une aristas consecutivas y alineadas (Catastro trocea las fachadas en muchas partes) en "paños"
 * continuos, para que las esquinas (y sus sillares) solo aparezcan donde la fachada gira de verdad.
 */
function mergeRuns(edges: FacadeEdge[]): FacadeEdge[] {
  const key = (x: number, z: number) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
  const byStart = new Map<string, FacadeEdge[]>();
  for (const e of edges) {
    const k = key(e.ax, e.az);
    let arr = byStart.get(k);
    if (!arr) byStart.set(k, (arr = []));
    arr.push(e);
  }
  const used = new Set<FacadeEdge>();
  const out: FacadeEdge[] = [];
  const hasPrev = new Set<FacadeEdge>();
  for (const e of edges) for (const n of byStart.get(key(e.bx, e.bz)) ?? []) {
    if (n !== e && n.nx * e.nx + n.nz * e.nz > 0.995 && Math.abs(n.top - e.top) < 2.5) hasPrev.add(n);
  }
  for (const start of edges) {
    if (used.has(start) || hasPrev.has(start)) continue;
    let cur = { ...start };
    used.add(start);
    for (;;) {
      const next = (byStart.get(key(cur.bx, cur.bz)) ?? []).find((n) => !used.has(n) && n.nx * cur.nx + n.nz * cur.nz > 0.995 && Math.abs(n.top - cur.top) < 2.5);
      if (!next) break;
      used.add(next);
      cur = { ...cur, bx: next.bx, bz: next.bz, len: Math.hypot(next.bx - cur.ax, next.bz - cur.az), ground: Math.min(cur.ground, next.ground) };
    }
    out.push(cur);
  }
  for (const e of edges) if (!used.has(e)) out.push(e); // ciclos cerrados sueltos
  return out;
}

export class FacadeKit {
  private geos = new Map<string, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();

  constructor(private mats: Record<string, THREE.Material>) {}

  push(mat: string, g: THREE.BufferGeometry) {
    let arr = this.geos.get(mat);
    if (!arr) this.geos.set(mat, (arr = []));
    const ng = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') ng.deleteAttribute(k);
    if (!ng.attributes.uv) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
    arr.push(ng);
  }

  /** Caja orientada con la fachada: u a lo largo de la arista (0..len), d hacia fuera desde el plano de fachada. */
  box(mat: string, e: FacadeEdge, u0: number, u1: number, y0: number, y1: number, d0: number, d1: number) {
    if (u1 - u0 < 0.01 || y1 - y0 < 0.01 || d1 - d0 < 0.005) return;
    const dx = (e.bx - e.ax) / e.len, dz = (e.bz - e.az) / e.len;
    const um = (u0 + u1) / 2, dm = (d0 + d1) / 2;
    const g = new THREE.BoxGeometry(u1 - u0, y1 - y0, d1 - d0);
    const ang = Math.atan2(-dz, dx); // eje X local → dirección de la arista
    this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
    this.v.set(e.ax + dx * um + e.nx * dm, (y0 + y1) / 2, e.az + dz * um + e.nz * dm);
    this.m.compose(this.v, this.q, this.sc.set(1, 1, 1));
    g.applyMatrix4(this.m);
    this.push(mat, g);
  }

  /** Banda horizontal (cornisa, imposta, zócalo) a lo largo de toda la arista. */
  band(mat: string, e: FacadeEdge, y0: number, y1: number, depth: number, overhang = 0.3) {
    this.box(mat, e, -overhang, e.len + overhang, y0, y1, -0.05, depth);
  }

  /** Cornisa con perfil escalonado (tres molduras). */
  cornice(mat: string, e: FacadeEdge, y: number, depth = 0.7, h = 0.9) {
    this.band(mat, e, y - h, y - h * 0.6, depth * 0.45, depth * 0.45);
    this.band(mat, e, y - h * 0.6, y - h * 0.25, depth * 0.75, depth * 0.75);
    this.band(mat, e, y - h * 0.25, y, depth, depth);
  }

  /** Pilastras cada `step` metros (centradas en la arista). */
  pilasters(mat: string, e: FacadeEdge, y0: number, y1: number, step: number, w: number, depth: number, withEnds = true) {
    const n = Math.max(1, Math.round(e.len / step));
    const s = e.len / n;
    for (let k = withEnds ? 0 : 1; k <= (withEnds ? n : n - 1); k++) {
      const u = Math.min(e.len - w / 2, Math.max(w / 2, k * s));
      this.box(mat, e, u - w / 2, u + w / 2, y0, y1, 0, depth);
    }
  }

  /** Columnas exentas (cilindros) delante de la fachada. */
  columns(mat: string, e: FacadeEdge, y0: number, y1: number, step: number, r: number, offset: number, paired = false) {
    const n = Math.max(1, Math.floor(e.len / step));
    const s = e.len / n;
    const dx = (e.bx - e.ax) / e.len, dz = (e.bz - e.az) / e.len;
    for (let k = 0; k <= n; k++) {
      for (const pp of paired ? [-r * 1.4, r * 1.4] : [0]) {
        const u = Math.min(e.len, Math.max(0, k * s + pp));
        const g = new THREE.CylinderGeometry(r * 0.88, r, y1 - y0, 12);
        g.translate(e.ax + dx * u + e.nx * (offset + r), (y0 + y1) / 2, e.az + dz * u + e.nz * (offset + r));
        this.push(mat, g);
        // basa y capitel
        const cap = new THREE.BoxGeometry(r * 2.6, r * 0.9, r * 2.6);
        cap.translate(e.ax + dx * u + e.nx * (offset + r), y1 - r * 0.45, e.az + dz * u + e.nz * (offset + r));
        this.push(mat, cap);
        const base = new THREE.BoxGeometry(r * 2.4, r * 0.6, r * 2.4);
        base.translate(e.ax + dx * u + e.nx * (offset + r), y0 + r * 0.3, e.az + dz * u + e.nz * (offset + r));
        this.push(mat, base);
      }
    }
  }

  /** Balaustrada de remate: zócalo, balaustres (como banda calada) y albardilla, con pedestales cada `post` m. */
  balustrade(mat: string, e: FacadeEdge, y: number, h = 1.1, post = 4.5) {
    this.box(mat, e, 0, e.len, y, y + 0.2, -0.1, 0.35);
    const n = Math.max(1, Math.floor(e.len / 0.38));
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) * (e.len / n);
      this.box(mat, e, u - 0.09, u + 0.09, y + 0.2, y + h - 0.15, 0.02, 0.2);
    }
    this.box(mat, e, 0, e.len, y + h - 0.15, y + h, -0.1, 0.35);
    this.pilasters(mat, e, y, y + h + 0.1, post, 0.5, 0.4);
  }

  /** Figuras (estatuas / jarrones / pináculos) sobre la cornisa cada `step` m. */
  finials(mat: string, e: FacadeEdge, y: number, step: number, kind: 'statue' | 'vase' | 'pinnacle', scale = 1) {
    const n = Math.max(1, Math.round(e.len / step));
    const dx = (e.bx - e.ax) / e.len, dz = (e.bz - e.az) / e.len;
    for (let k = 0; k <= n; k++) {
      const u = (k * e.len) / n;
      const x = e.ax + dx * u + e.nx * 0.15, z = e.az + dz * u + e.nz * 0.15;
      this.finial(mat, x, y, z, kind, scale);
    }
  }

  finial(mat: string, x: number, y: number, z: number, kind: 'statue' | 'vase' | 'pinnacle', scale = 1) {
    const add = (g: THREE.BufferGeometry, yy: number) => { g.scale(scale, scale, scale); g.translate(x, y + yy * scale, z); this.push(mat, g); };
    if (kind === 'pinnacle') {
      add(new THREE.BoxGeometry(0.7, 0.8, 0.7), 0.4);
      add(new THREE.ConeGeometry(0.32, 2.2, 4).rotateY(Math.PI / 4), 1.9);
      add(new THREE.SphereGeometry(0.14, 6, 4), 3.1);
    } else if (kind === 'vase') {
      add(new THREE.BoxGeometry(0.6, 0.5, 0.6), 0.25);
      add(new THREE.CylinderGeometry(0.32, 0.18, 0.8, 8), 0.9);
      add(new THREE.SphereGeometry(0.16, 6, 4), 1.4);
    } else {
      add(new THREE.BoxGeometry(0.8, 0.6, 0.8), 0.3);
      add(new THREE.CylinderGeometry(0.22, 0.32, 1.4, 8), 1.3);
      add(new THREE.SphereGeometry(0.17, 8, 6), 2.15);
    }
  }

  /** Pináculos en las esquinas de la cubierta de una parte (remates escalonados). */
  cornerFinials(mat: string, p: PlacedBuilding, kind: 'pinnacle' | 'vase' | 'statue', scale = 1, minAngleDeg = 30) {
    const pts = p.data.pts, n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const a = (i + n - 1) % n, b = (i + 1) % n;
      const v1x = pts[i * 2] - pts[a * 2], v1z = pts[i * 2 + 1] - pts[a * 2 + 1];
      const v2x = pts[b * 2] - pts[i * 2], v2z = pts[b * 2 + 1] - pts[i * 2 + 1];
      const l1 = Math.hypot(v1x, v1z), l2 = Math.hypot(v2x, v2z);
      if (l1 < 1.5 || l2 < 1.5) continue;
      const turn = Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1z * v2z) / (l1 * l2)))) * 180 / Math.PI;
      if (turn < minAngleDeg) continue;
      this.finial(mat, pts[i * 2], p.top, pts[i * 2 + 1], kind, scale);
    }
  }

  build(): THREE.Group {
    const g = new THREE.Group();
    for (const [name, geos] of this.geos) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.mats[name]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    return g;
  }
}
