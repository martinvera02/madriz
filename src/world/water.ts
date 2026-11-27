import * as THREE from 'three';
import type { WorldData, AreaData } from './realData';
import type { Ground } from './roads';
import type { CollisionWorld } from './collision';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Agua: el Manzanares (con sus muros de granito de Madrid Río), los estanques de los parques
 * (Retiro, Palacio de Cristal…) y las fuentes y láminas de agua de las plazas, a partir de los
 * polígonos de agua de OpenStreetMap.
 *
 *  - Río: lámina que baja suavemente hacia el sur siguiendo el relieve del MDT, con corriente.
 *  - Estanques: lámina plana con bordillo de piedra.
 *  - Fuentes (polígonos pequeños): pilón de piedra elevado, lámina, surtidores con agua que cae
 *    y espuma, por pisos si OSM trae vasos anidados. Se iluminan de noche.
 */

type Kind = 'river' | 'lake' | 'fountain';
type V2 = [number, number];

// ------------------------------------------------------------------ geometría 2D

function ringArea(r: V2[]) {
  let s = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}
function toRing(p: number[]): V2[] {
  const r: V2[] = [];
  for (let i = 0; i < p.length; i += 2) r.push([p[i], p[i + 1]]);
  // OSM cierra el anillo repitiendo el primer punto
  if (r.length > 2 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  return r;
}
function inside(r: V2[], x: number, z: number) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
/** Recorte de un anillo contra un rectángulo (Sutherland–Hodgman). */
function clipRect(r: V2[], x0: number, z0: number, x1: number, z1: number): V2[] {
  const planes: [(p: V2) => boolean, (a: V2, b: V2) => V2][] = [
    [(p) => p[0] >= x0, (a, b) => { const t = (x0 - a[0]) / (b[0] - a[0]); return [x0, a[1] + (b[1] - a[1]) * t]; }],
    [(p) => p[0] <= x1, (a, b) => { const t = (x1 - a[0]) / (b[0] - a[0]); return [x1, a[1] + (b[1] - a[1]) * t]; }],
    [(p) => p[1] >= z0, (a, b) => { const t = (z0 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, z0]; }],
    [(p) => p[1] <= z1, (a, b) => { const t = (z1 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, z1]; }],
  ];
  let out = r;
  for (const [inn, cut] of planes) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length];
      const ia = inn(a), ib = inn(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    if (out.length < 3) return [];
  }
  return out;
}

// ------------------------------------------------------------------ materiales

/** Mapa de normales de ondas suaves (procedural, sin texturas externas). */
function rippleNormals(size = 256) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(size, size);
  const waves: [number, number, number, number][] = [];
  for (let k = 0; k < 9; k++) {
    // frecuencias enteras: la textura se repite sin costuras
    const a = Math.random() * Math.PI * 2, f = 2 + Math.floor(Math.random() * 6);
    waves.push([Math.round(Math.cos(a) * f), Math.round(Math.sin(a) * f), Math.random() * 6.28, 1 / f]);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0, dy = 0;
      for (const [fx, fy, ph, amp] of waves) {
        const v = Math.cos(((fx * x + fy * y) / size) * Math.PI * 2 + ph) * amp;
        dx += v * fx; dy += v * fy;
      }
      const i = (y * size + x) * 4;
      img.data[i] = 128 + Math.max(-127, Math.min(127, dx * 9));
      img.data[i + 1] = 128 + Math.max(-127, Math.min(127, dy * 9));
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Rayas verticales semitransparentes para los chorros (se desplazan hacia abajo). */
function streamTexture() {
  const cv = document.createElement('canvas');
  cv.width = 32; cv.height = 128;
  const c = cv.getContext('2d')!;
  c.fillStyle = 'rgba(220,235,245,0.55)';
  c.fillRect(0, 0, 32, 128);
  for (let k = 0; k < 40; k++) {
    c.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.5})`;
    c.fillRect(Math.random() * 32, Math.random() * 128, 1 + Math.random() * 3, 6 + Math.random() * 30);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ sistema

interface Body { kind: Kind; outer: V2[]; holes: V2[][]; area: number; cx: number; cz: number; circ: number; tier: number; name?: string }

export class Water {
  readonly group = new THREE.Group();
  /** Fuentes (centro y radio) para el sonido y para que `iconic` no duplique el pilón. */
  readonly fountains: { x: number; z: number; r: number; big: boolean }[] = [];
  readonly riverMat: THREE.MeshStandardMaterial;
  readonly stillMat: THREE.MeshStandardMaterial;
  private readonly jetMat: THREE.MeshBasicMaterial;
  private readonly foamMat: THREE.MeshBasicMaterial;
  private readonly riverN: THREE.Texture;
  private readonly stillN: THREE.Texture;
  private readonly stream: THREE.Texture;
  private readonly jetParts: THREE.BufferGeometry[] = [];
  private readonly foamParts: THREE.BufferGeometry[] = [];
  private foam: THREE.Mesh | null = null;
  private t = 0;

  constructor(data: WorldData, private ground: Ground, collision: CollisionWorld) {
    this.riverN = rippleNormals();
    this.stillN = rippleNormals();
    this.stream = streamTexture();
    const mk = (n: THREE.Texture, color: number, op: number) => new THREE.MeshStandardMaterial({
      color, roughness: 0.08, metalness: 0.15, normalMap: n, normalScale: new THREE.Vector2(0.55, 0.55),
      transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide,
    });
    this.riverMat = mk(this.riverN, 0x3d5f5a, 0.92);
    this.stillMat = mk(this.stillN, 0x2f5c6e, 0.86);
    this.jetMat = new THREE.MeshBasicMaterial({ map: this.stream, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, color: 0xdfeef5 });
    this.foamMat = new THREE.MeshBasicMaterial({ color: 0xf2f7fa, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });

    const stone = new THREE.MeshStandardMaterial({ color: 0xbdb5a5, roughness: 0.85, side: THREE.DoubleSide });
    const granite = new THREE.MeshStandardMaterial({ color: 0x9d968a, roughness: 0.9, side: THREE.DoubleSide });
    const b = data.bounds;
    const bodies = this.classify(data.areas.filter((a) => a.kind === 'water'), b);
    const stoneParts: THREE.BufferGeometry[] = [];
    const graniteParts: THREE.BufferGeometry[] = [];
    for (const w of bodies) {
      if (w.kind === 'river') this.buildRiver(w, graniteParts);
      else if (w.kind === 'lake') this.buildLake(w, stoneParts, collision);
      else this.buildFountain(w, stoneParts, collision, bodies);
    }
    for (const [mat, gs] of this.surfaces) {
      const m = new THREE.Mesh(mergeGeometries(gs), mat);
      m.receiveShadow = true;
      m.renderOrder = 1;
      this.group.add(m);
    }
    // todos los chorros en una malla y toda la espuma en otra (una llamada de dibujo cada una)
    if (this.jetParts.length) {
      const jm = new THREE.Mesh(mergeGeometries(this.jetParts), this.jetMat);
      jm.renderOrder = 3;
      this.group.add(jm);
    }
    if (this.foamParts.length) {
      this.foam = new THREE.Mesh(mergeGeometries(this.foamParts), this.foamMat);
      this.foam.renderOrder = 3;
      this.group.add(this.foam);
    }
    for (const [parts, mat] of [[stoneParts, stone], [graniteParts, granite]] as const) {
      if (!parts.length) continue;
      const g = mergeAll(parts);
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    }
  }

  /** Río, estanque o fuente según tamaño y forma; los vasos anidados de una fuente son pisos superiores. */
  private classify(areas: AreaData[], b: WorldData['bounds']): Body[] {
    const out: Body[] = [];
    const seen: Body[] = [];
    for (const a of areas) {
      let outer = toRing(a.pts);
      const area0 = Math.abs(ringArea(outer));
      let per = 0;
      for (let i = 0; i < outer.length; i++) { const p = outer[i], q = outer[(i + 1) % outer.length]; per += Math.hypot(q[0] - p[0], q[1] - p[1]); }
      const circ = per ? (4 * Math.PI * area0) / (per * per) : 0;
      const kind: Kind = area0 > 30000 && (circ < 0.2 || /manzanares|río/i.test(a.name ?? '')) ? 'river' : area0 > 1500 ? 'lake' : 'fountain';
      let holes = (a.holes ?? []).map(toRing);
      if (kind === 'river') {
        outer = clipRect(outer, b.x0, b.z0, b.x1, b.z1);
        holes = holes.map((h) => clipRect(h, b.x0, b.z0, b.x1, b.z1)).filter((h) => h.length >= 3);
        if (outer.length < 3) continue;
      }
      let cx = 0, cz = 0;
      for (const [x, z] of outer) { cx += x; cz += z; }
      cx /= outer.length; cz /= outer.length;
      // OSM a veces repite el mismo vaso: se queda uno
      if (seen.some((s) => Math.hypot(s.cx - cx, s.cz - cz) < 1 && Math.abs(s.area - area0) < area0 * 0.05)) continue;
      const body: Body = { kind, outer, holes, area: Math.abs(ringArea(outer)), cx, cz, circ, tier: 0, name: a.name };
      seen.push(body);
      out.push(body);
    }
    // piso de fuente: contenido en otra fuente más grande
    for (const f of out) {
      if (f.kind !== 'fountain') continue;
      for (const g of out) if (g !== f && g.kind === 'fountain' && g.area > f.area * 1.3 && inside(g.outer, f.cx, f.cz)) f.tier++;
    }
    return out;
  }

  private h(x: number, z: number) { return this.ground.terrain.heightAt(x, z); }

  /** Triangula el polígono (con huecos) y da a cada vértice la altura `y(x, z)`. */
  private surface(outer: V2[], holes: V2[][], y: (x: number, z: number) => number, mat: THREE.Material, uvScale = 0.08) {
    const contour = outer.map(([x, z]) => new THREE.Vector2(x, z));
    if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
    const hs = holes.map((h) => { const v = h.map(([x, z]) => new THREE.Vector2(x, z)); if (!THREE.ShapeUtils.isClockWise(v)) v.reverse(); return v; });
    const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
    const all = [...contour, ...hs.flat()];
    // triángulos grandes: subdividir para que la lámina siga la pendiente del río
    const pos: number[] = [], uv: number[] = [];
    const push = (p: THREE.Vector2) => { pos.push(p.x, y(p.x, p.y), p.y); uv.push(p.x * uvScale, p.y * uvScale); };
    const split = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2, depth: number) => {
      const la = a.distanceTo(b), lb = b.distanceTo(c), lc = c.distanceTo(a);
      if (depth > 0 && Math.max(la, lb, lc) > 40) {
        // partir el lado más largo
        if (la >= lb && la >= lc) { const m = a.clone().add(b).multiplyScalar(0.5); split(a, m, c, depth - 1); split(m, b, c, depth - 1); }
        else if (lb >= lc) { const m = b.clone().add(c).multiplyScalar(0.5); split(a, b, m, depth - 1); split(a, m, c, depth - 1); }
        else { const m = c.clone().add(a).multiplyScalar(0.5); split(a, b, m, depth - 1); split(m, b, c, depth - 1); }
        return;
      }
      // orden para que la cara mire hacia arriba
      push(a); push(c); push(b);
    };
    for (const [i, j, k] of tris) split(all[i], all[j], all[k], 10);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    // se juntan por material al final (una malla para todas las láminas quietas)
    let arr = this.surfaces.get(mat);
    if (!arr) this.surfaces.set(mat, (arr = []));
    arr.push(g);
  }
  private readonly surfaces = new Map<THREE.Material, THREE.BufferGeometry[]>();

  /** Muro (o bordillo) a lo largo de un anillo: de `y0` a `y1` en cada punto, `w` de grosor hacia fuera. */
  private wall(r: V2[], y0: (x: number, z: number) => number, y1: (x: number, z: number) => number, w: number, out: THREE.BufferGeometry[], skipBorder?: WorldData['bounds']) {
    const ccw = ringArea(r) > 0;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      if (skipBorder) {
        const onB = (p: V2) => Math.abs(p[0] - skipBorder.x0) < 0.01 || Math.abs(p[0] - skipBorder.x1) < 0.01 || Math.abs(p[1] - skipBorder.z0) < 0.01 || Math.abs(p[1] - skipBorder.z1) < 0.01;
        if (onB(a) && onB(b)) continue;
      }
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 0.05) continue;
      // normal hacia fuera del agua
      let nx = dz / L, nz = -dx / L;
      if (!ccw) { nx = -nx; nz = -nz; }
      const ya0 = y0(a[0], a[1]), yb0 = y0(b[0], b[1]);
      const ya1 = Math.max(ya0 + 0.1, y1(a[0], a[1])), yb1 = Math.max(yb0 + 0.1, y1(b[0], b[1]));
      const ax2 = a[0] + nx * w, az2 = a[1] + nz * w, bx2 = b[0] + nx * w, bz2 = b[1] + nz * w;
      // cara interior + albardilla
      const p = [
        a[0], ya0, a[1], b[0], yb0, b[1], b[0], yb1, b[1],
        a[0], ya0, a[1], b[0], yb1, b[1], a[0], ya1, a[1],
        a[0], ya1, a[1], b[0], yb1, b[1], bx2, yb1, bz2,
        a[0], ya1, a[1], bx2, yb1, bz2, ax2, ya1, az2,
      ];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      out.push(g.toNonIndexed());
    }
  }

  private buildRiver(w: Body, walls: THREE.BufferGeometry[]) {
    // nivel del agua por franjas norte-sur: percentil bajo del relieve dentro del cauce, suavizado y
    // sin subir nunca río abajo (el Manzanares baja hacia el sur)
    const z0 = Math.min(...w.outer.map((p) => p[1])), z1 = Math.max(...w.outer.map((p) => p[1]));
    const step = 40, n = Math.max(2, Math.ceil((z1 - z0) / step) + 1);
    const lv: number[] = [];
    const bx0 = Math.min(...w.outer.map((p) => p[0])), bx1 = Math.max(...w.outer.map((p) => p[0]));
    for (let i = 0; i < w.outer.length; i += 3) this.riverPts.push(w.outer[i]);
    for (let k = 0; k < n; k++) {
      const zc = z0 + k * step;
      const hs: number[] = [];
      for (let z = zc - step / 2; z <= zc + step / 2; z += 6) {
        for (let x = bx0; x <= bx1; x += 6) {
          if (!inside(w.outer, x, z) || w.holes.some((h) => inside(h, x, z))) continue;
          hs.push(this.h(x, z));
        }
      }
      hs.sort((a, b) => a - b);
      lv.push(hs.length ? hs[Math.floor(hs.length * 0.3)] : NaN);
    }
    for (let k = 0; k < n; k++) if (Number.isNaN(lv[k])) lv[k] = lv[k - 1] ?? lv.find((v) => !Number.isNaN(v)) ?? 0;
    const sm = lv.map((_, k) => { let s = 0, c = 0; for (let j = k - 2; j <= k + 2; j++) if (lv[j] !== undefined) { s += lv[j]; c++; } return s / c; });
    for (let k = 1; k < n; k++) sm[k] = Math.min(sm[k], sm[k - 1]);
    const level = (_x: number, z: number) => {
      const f = Math.max(0, Math.min(n - 1, (z - z0) / step));
      const i = Math.floor(f), t = f - i;
      return (sm[i] * (1 - t) + sm[Math.min(n - 1, i + 1)] * t) + 0.25;
    };
    this.riverLevel = level;
    this.surface(w.outer, w.holes, level, this.riverMat, 0.05);
    // muros de granito de Madrid Río: del agua al paseo
    const top = (x: number, z: number) => Math.min(level(x, z) + 9, Math.max(level(x, z) + 0.8, this.h(x, z) + 0.15));
    const b = { x0: -1e9, x1: 1e9, z0: z0, z1: z1 };
    this.wall(w.outer, (x, z) => level(x, z) - 0.6, top, 0.6, walls, b);
    for (const h of w.holes) this.wall(h, (x, z) => level(x, z) - 0.6, top, 0.6, walls);
  }
  /** Altura del río en un punto (para quien la necesite). */
  riverLevel: ((x: number, z: number) => number) | null = null;
  private riverPts: V2[] = [];

  private buildLake(w: Body, stoneParts: THREE.BufferGeometry[], collision: CollisionWorld) {
    // lámina plana: percentil bajo del relieve dentro del estanque
    const xs = w.outer.map((p) => p[0]), zs = w.outer.map((p) => p[1]);
    const hs: number[] = [];
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 4) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 4) if (inside(w.outer, x, z)) hs.push(this.h(x, z));
    const edge = w.outer.map(([x, z]) => this.h(x, z)).sort((a, b) => a - b);
    hs.sort((a, b) => a - b);
    const lvl = Math.min(hs.length ? hs[Math.floor(hs.length * 0.3)] : edge[0], edge[0]) + 0.15;
    this.surface(w.outer, w.holes, () => lvl, this.stillMat);
    // bordillo de piedra (en el Estanque Grande, con su barandilla de piedra)
    const big = /estanque grande/i.test(w.name ?? '');
    this.wall(w.outer, () => lvl - 0.5, (x, z) => Math.max(lvl + 0.35, this.h(x, z) + (big ? 0.75 : 0.3)), big ? 0.7 : 0.45, stoneParts);
    for (const h of w.holes) this.wall(h, () => lvl - 0.5, (x, z) => this.h(x, z) + 0.3, 0.45, stoneParts);
    for (let i = 0; i < w.outer.length; i++) {
      const a = w.outer[i], b = w.outer[(i + 1) % w.outer.length];
      collision.addSeg(a[0], a[1], b[0], b[1], this.h(a[0], a[1]) + 0.7);
    }
  }

  private buildFountain(w: Body, stoneParts: THREE.BufferGeometry[], collision: CollisionWorld, all: Body[]) {
    if (w.area < 2) return;
    const edge = w.outer.map(([x, z]) => this.h(x, z));
    const base = Math.max(...edge);
    const rimH = 0.55 + w.tier * 0.45;
    const lvl = base + rimH - 0.12;
    this.surface(w.outer, w.holes, () => lvl, this.stillMat, 0.15);
    this.wall(w.outer, (x, z) => this.h(x, z) - 0.05, () => base + rimH, w.tier ? 0.3 : 0.45, stoneParts);
    // un pilón que no tapa a su piso de abajo: solo el más exterior bloquea el paso
    if (w.tier === 0) {
      for (let i = 0; i < w.outer.length; i++) {
        const a = w.outer[i], b = w.outer[(i + 1) % w.outer.length];
        collision.addSeg(a[0], a[1], b[0], b[1], base + rimH);
      }
    }
    const r = Math.sqrt(w.area / Math.PI);
    // ¿tiene un piso encima? entonces el surtidor va en el piso de arriba
    const hasUpper = all.some((o) => o !== w && o.kind === 'fountain' && o.tier > w.tier && inside(w.outer, o.cx, o.cz));
    if (w.tier === 0) this.fountains.push({ x: w.cx, z: w.cz, r, big: w.area > 250 });
    if (hasUpper) return;
    // las piscinas y láminas rectangulares (pocos vértices) no llevan surtidor
    const round = w.outer.length >= 10 && w.circ > 0.6;
    if ((round && w.area > 6) || /fuente/i.test(w.name ?? '')) this.jets(w.cx, lvl, w.cz, r, w.area > 250);
    else if (w.circ <= 0.5 && w.area > 60 && w.outer.length >= 10) {
      // lámina alargada: fila de chorritos a lo largo del eje mayor
      let best = 0, ax = 1, az = 0;
      for (const [x, z] of w.outer) { const d = Math.hypot(x - w.cx, z - w.cz); if (d > best) { best = d; ax = (x - w.cx) / d; az = (z - w.cz) / d; } }
      const nJ = Math.min(9, Math.max(3, Math.round(best / 4)));
      for (let k = 0; k < nJ; k++) {
        const t = (k / (nJ - 1) - 0.5) * best * 1.2;
        const x = w.cx + ax * t, z = w.cz + az * t;
        if (inside(w.outer, x, z)) this.jets(x, lvl, z, 1.2, false);
      }
    }
  }

  /** Surtidores: chorro central con paraguas de agua que cae, arcos alrededor si es grande, y espuma. */
  private jets(x: number, y: number, z: number, r: number, big: boolean) {
    const at = (g: THREE.BufferGeometry) => { g.translate(x, y, z); return g; };
    const hgt = big ? Math.min(6, 2.5 + r * 0.25) : Math.min(2.2, 0.8 + r * 0.4);
    this.jetParts.push(at(new THREE.CylinderGeometry(0.06, big ? 0.16 : 0.1, hgt, 8, 1, true).translate(0, hgt / 2, 0)));
    this.jetParts.push(at(new THREE.ConeGeometry(big ? Math.min(1.6, r * 0.25) : Math.min(0.6, r * 0.4), hgt * 0.45, 12, 1, true).translate(0, hgt - hgt * 0.22, 0)));
    if (big) {
      // arcos desde el borde hacia el centro
      const n = 8, R = Math.min(r * 0.7, 9);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const p0 = new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R);
        const p2 = new THREE.Vector3(Math.cos(a) * R * 0.25, 0, Math.sin(a) * R * 0.25);
        const p1 = p0.clone().lerp(p2, 0.5).setY(Math.min(3.2, R * 0.45));
        this.jetParts.push(at(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0, p1, p2), 14, 0.05, 5, false)));
      }
    }
    this.foamParts.push(at(new THREE.RingGeometry(0.1, big ? 1.8 : 0.7, 20).rotateX(-Math.PI / 2).translate(0, 0.03, 0)));
  }

  /** Corriente, ondas, chorros y luz de noche. */
  update(dt: number, night: number) {
    this.t += dt;
    this.riverN.offset.set(this.t * 0.004, this.t * 0.03);
    this.stillN.offset.set(Math.sin(this.t * 0.07) * 0.05, this.t * 0.006);
    this.stream.offset.y = this.t * 1.6;
    this.foamMat.opacity = 0.42 + Math.sin(this.t * 3) * 0.1;
    // de noche las fuentes se iluminan desde el vaso
    const glow = night;
    this.jetMat.color.setRGB(0.87 + glow * 0.13, 0.93 + glow * 0.05, 0.96);
    this.jetMat.opacity = 0.62 + glow * 0.25;
    this.stillMat.emissive.setRGB(0.02 * glow, 0.05 * glow, 0.07 * glow);
  }

  /** 0..1: cuánto suena el agua cerca de un punto (fuentes y río). */
  loudness(x: number, z: number, y: number) {
    let v = 0;
    for (const f of this.fountains) {
      const d = Math.hypot(f.x - x, f.z - z);
      const reach = f.big ? 45 : 18;
      if (d < reach) v = Math.max(v, (1 - d / reach) * (f.big ? 1 : 0.5));
    }
    if (this.riverLevel && Math.abs(this.riverLevel(x, z) - y) < 25) {
      let d = Infinity;
      for (const [px, pz] of this.riverPts) d = Math.min(d, Math.hypot(px - x, pz - z));
      if (d < 120) v = Math.max(v, (1 - d / 120) * 0.35);
    }
    return Math.min(1, v);
  }
}

function mergeAll(parts: THREE.BufferGeometry[]) {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) { pos.set(p.attributes.position.array as Float32Array, o); o += p.attributes.position.count * 3; p.dispose(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
