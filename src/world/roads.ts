import { FootprintIndex } from './spatial';
import { pavingTextures, TEX_SIZE } from './paving';
import * as THREE from 'three';
import type { WorldData, RoadData } from './realData';
import { Terrain } from './terrain';
import { CollisionWorld } from './collision';
import { CarwayIndex } from './spatial';

/**
 * Superficie transitable: el terreno real más los tableros de los puentes
 * (p. ej. el Viaducto de Segovia sobre la calle Segovia).
 */
export class Ground {
  private decks: { ax: number; az: number; bx: number; bz: number; ha: number; hb: number; hw: number; inner?: boolean }[] = [];
  private grid = new Map<string, number[]>();

  /** Sobreelevación de las aceras en cm, celdas de 1 m agrupadas en bloques de 64 m creados bajo demanda. */
  private walk = new Map<number, Uint8Array>();
  private walkGet(x: number, z: number) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const blk = this.walk.get(((ix >> 6) + 512) * 1024 + ((iz >> 6) + 512));
    return blk ? blk[(iz & 63) * 64 + (ix & 63)] / 100 : 0;
  }
  private walkSet(x: number, z: number, v: number) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const key = ((ix >> 6) + 512) * 1024 + ((iz >> 6) + 512);
    let blk = this.walk.get(key);
    if (!blk) this.walk.set(key, (blk = new Uint8Array(4096)));
    blk[(iz & 63) * 64 + (ix & 63)] = Math.min(255, Math.round(v * 100));
  }

  constructor(readonly terrain: Terrain) {}

  /** `inner`: suelo de un edificio con interior: vale también bajo la cota de la calle (sótanos) y solo si ya estás encima. */
  addDeckSegment(ax: number, az: number, bx: number, bz: number, ha: number, hb: number, halfWidth: number, inner = false) {
    const k = this.decks.length;
    this.decks.push({ ax, az, bx, bz, ha, hb, hw: halfWidth, inner });
    const x0 = Math.floor((Math.min(ax, bx) - halfWidth) / 20), x1 = Math.floor((Math.max(ax, bx) + halfWidth) / 20);
    const z0 = Math.floor((Math.min(az, bz) - halfWidth) / 20), z1 = Math.floor((Math.max(az, bz) + halfWidth) / 20);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const key = i + ',' + j;
      let arr = this.grid.get(key);
      if (!arr) this.grid.set(key, (arr = []));
      arr.push(k);
    }
  }

  /** Marca el cuadrilátero de acera a-b-ob-oa (x,z) con una sobreelevación. */
  addWalk(ax: number, az: number, bx: number, bz: number, obx: number, obz: number, oax: number, oaz: number, lift: number) {
    // celdas de 1 m cuyo centro cae dentro del cuadrilátero (así no se "suben" trozos de calzada)
    const P = [ax, az, bx, bz, obx, obz, oax, oaz];
    const x0 = Math.floor(Math.min(ax, bx, obx, oax)), x1 = Math.floor(Math.max(ax, bx, obx, oax));
    const z0 = Math.floor(Math.min(az, bz, obz, oaz)), z1 = Math.floor(Math.max(az, bz, obz, oaz));
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const cx = i + 0.5, cz = j + 0.5;
      let pos = 0, neg = 0;
      for (let k = 0; k < 4; k++) {
        const qx = P[k * 2], qz = P[k * 2 + 1], rx = P[((k + 1) % 4) * 2], rz = P[((k + 1) % 4) * 2 + 1];
        const cr = (rx - qx) * (cz - qz) - (rz - qz) * (cx - qx);
        if (cr > 0) pos++; else if (cr < 0) neg++;
      }
      if (pos === 0 || neg === 0) this.walkSet(cx, cz, lift);
    }
  }

  /** Altura de la superficie en (x,z). Con `y` (altura actual) se elige entre el puente y lo que hay debajo. */
  heightAt(x: number, z: number, y?: number): number {
    const t = this.terrain.heightAt(x, z) + this.walkGet(x, z);
    const arr = this.grid.get(Math.floor(x / 20) + ',' + Math.floor(z / 20));
    if (!arr) return t;
    let best = t;
    let inner = -Infinity;
    for (const k of arr) {
      const d = this.decks[k];
      const dx = d.bx - d.ax, dz = d.bz - d.az;
      const l2 = dx * dx + dz * dz || 1e-6;
      let u = ((x - d.ax) * dx + (z - d.az) * dz) / l2;
      // tolerancia en las juntas entre tramos (si no, un punto justo en la junta "se cae" al terreno)
      if (u < -0.02 || u > 1.02) continue;
      u = Math.max(0, Math.min(1, u));
      const px = d.ax + dx * u, pz = d.az + dz * u;
      if ((x - px) ** 2 + (z - pz) ** 2 > d.hw * d.hw) continue;
      const h = d.ha + (d.hb - d.ha) * u;
      if (d.inner) {
        // dentro de un edificio: el suelo sobre el que estás (o el de debajo si vienes de arriba), aunque quede bajo la calle
        if (y === undefined ? h > inner : y > h - 0.6 && h > inner) inner = h;
        continue;
      }
      if (h <= t + 0.2) continue;
      // Sobre el tablero solo si venimos de arriba (o no sabemos la altura)
      if (y === undefined || y > h - 2.5) best = Math.max(best, h);
    }
    return inner > -Infinity ? inner : best;
  }
}

const ROAD_LIFT = 0.07;

/** Viaducto de Segovia: eje, alturas y vías OSM que lo forman (se modela aparte, ver viaduct.ts). */
export interface ViaductInfo {
  ax: number; az: number; bx: number; bz: number; // extremos del eje (estribos)
  ha: number; hb: number; // cota del tablero en cada extremo
  len: number;
  ux: number; uz: number; // dirección del eje
  width: number;
  /** Distancia desde A hasta el cruce con la calle de Segovia (centro del vano central). */
  sCross: number;
  ways: Set<RoadData>;
}

/** Busca el viaducto de la calle de Bailén sobre la calle de Segovia en los datos OSM. */
export function findViaduct(data: WorldData, terrain: Terrain): ViaductInfo | null {
  const N = data.roadNodes;
  const main = data.roads.filter((r) => r.br && r.car && r.name === 'Calle de Bailén');
  if (!main.length) return null;
  const pts: number[][] = [];
  for (const r of main) for (const n of r.n) pts.push([N[n * 2], N[n * 2 + 1]]);
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p[0]; cz += p[1]; }
  cx /= pts.length; cz /= pts.length;
  let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of pts) { sxx += (x - cx) ** 2; szz += (z - cz) ** 2; sxz += (x - cx) * (z - cz); }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  let ux = Math.cos(ang), uz = Math.sin(ang);
  let smin = Infinity, smax = -Infinity;
  for (const [x, z] of pts) {
    const s = (x - cx) * ux + (z - cz) * uz;
    smin = Math.min(smin, s); smax = Math.max(smax, s);
  }
  let ax = cx + ux * smin, az = cz + uz * smin, bx = cx + ux * smax, bz = cz + uz * smax;
  if (az > bz) { [ax, az, bx, bz] = [bx, bz, ax, az]; ux = -ux; uz = -uz; } // A = extremo norte
  const len = Math.hypot(bx - ax, bz - az);
  const ways = new Set<RoadData>();
  for (const r of data.roads) {
    if (!r.br) continue;
    let ok = true;
    for (const n of r.n) {
      const x = N[n * 2] - ax, z = N[n * 2 + 1] - az;
      const s = x * ux + z * uz, t = Math.abs(-x * uz + z * ux);
      if (t > 14 || s < -6 || s > len + 6) { ok = false; break; }
    }
    if (ok) ways.add(r);
  }
  // Cruce con la calle de Segovia (si no, el punto más bajo del terreno bajo el eje)
  let sCross = -1;
  for (const r of data.roads) {
    if (r.name !== 'Calle de Segovia') continue;
    for (let i = 1; i < r.n.length; i++) {
      const px = N[r.n[i - 1] * 2], pz = N[r.n[i - 1] * 2 + 1], qx = N[r.n[i] * 2], qz = N[r.n[i] * 2 + 1];
      const d1x = bx - ax, d1z = bz - az, d2x = qx - px, d2z = qz - pz;
      const den = d1x * d2z - d1z * d2x;
      if (Math.abs(den) < 1e-6) continue;
      const t1 = ((px - ax) * d2z - (pz - az) * d2x) / den, t2 = ((px - ax) * d1z - (pz - az) * d1x) / den;
      if (t1 >= 0 && t1 <= 1 && t2 >= 0 && t2 <= 1) sCross = t1 * len;
    }
  }
  if (sCross < 0) {
    let best = Infinity;
    for (let s = 0; s <= len; s += 2) {
      const h = terrain.heightAt(ax + ux * s, az + uz * s);
      if (h < best) { best = h; sCross = s; }
    }
  }
  return {
    ax, az, bx, bz, len, ux, uz, width: 20, sCross, ways,
    ha: terrain.heightAt(ax, az) + 0.25, hb: terrain.heightAt(bx, bz) + 0.25,
  };
}

function asphaltTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4a4b4e';
  g.fillRect(0, 0, 512, 512);
  // árido del aglomerado
  for (let k = 0; k < 60000; k++) {
    const v = 40 + Math.random() * 70;
    g.fillStyle = `rgba(${v},${v},${v + 3},${0.35 + Math.random() * 0.4})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
  }
  // rodadas más oscuras y pulidas (eje de cada carril)
  for (const y of [0.25, 0.75]) {
    const grd = g.createLinearGradient(0, (y - 0.12) * 512, 0, (y + 0.12) * 512);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.5, 'rgba(15,15,18,0.22)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, (y - 0.12) * 512, 512, 0.24 * 512);
  }
  // parches, manchas de aceite, grietas y tapas de registro
  for (let k = 0; k < 10; k++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '25,25,28' : '85,85,88'},${0.18 + Math.random() * 0.2})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 30 + Math.random() * 90, 20 + Math.random() * 50);
  }
  for (let k = 0; k < 8; k++) {
    g.fillStyle = `rgba(10,10,12,${0.12 + Math.random() * 0.15})`;
    g.beginPath(); g.ellipse(Math.random() * 512, (Math.random() < 0.5 ? 0.25 : 0.75) * 512, 8 + Math.random() * 16, 5 + Math.random() * 8, Math.random() * 3, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(20,20,22,0.5)'; g.lineWidth = 1.2;
  for (let k = 0; k < 14; k++) {
    let x = Math.random() * 512, y = Math.random() * 512;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 8; s++) { x += (Math.random() - 0.5) * 30; y += (Math.random() - 0.5) * 30; g.lineTo(x, y); }
    g.stroke();
  }
  g.fillStyle = '#2f3032'; g.beginPath(); g.arc(380, 120, 14, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#555'; g.lineWidth = 2; g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildRoads(data: WorldData, ground: Ground, collision: CollisionWorld): { group: THREE.Group; viaduct: ViaductInfo | null } {
  const group = new THREE.Group();
  const N = data.roadNodes;
  const terrain = ground.terrain;

  // El Viaducto tiene un único tablero de 20 m para todas sus vías (calzada y aceras)
  const viaduct = findViaduct(data, terrain);
  if (viaduct) {
    const steps = Math.ceil(viaduct.len / 6);
    for (let k = 0; k < steps; k++) {
      const s0 = (viaduct.len * k) / steps, s1 = (viaduct.len * (k + 1)) / steps;
      const y0 = viaduct.ha + ((viaduct.hb - viaduct.ha) * s0) / viaduct.len;
      const y1 = viaduct.ha + ((viaduct.hb - viaduct.ha) * s1) / viaduct.len;
      ground.addDeckSegment(viaduct.ax + viaduct.ux * s0, viaduct.az + viaduct.uz * s0,
        viaduct.ax + viaduct.ux * s1, viaduct.az + viaduct.uz * s1, y0, y1, viaduct.width / 2 + 0.3);
    }
  }
  const inViaduct = (r: RoadData) => !!viaduct?.ways.has(r);

  // Nodos de cruce: usados por más de una vía (o dos veces por la misma)
  const usage = new Map<number, number>();
  for (const r of data.roads) for (const n of r.n) usage.set(n, (usage.get(n) ?? 0) + 1);
  const isJunction = (n: number) => (usage.get(n) ?? 0) > 1;

  // 1) Puentes primero: registran sus tableros para que el resto de geometría los conozca
  for (const r of data.roads) {
    if (!r.br || inViaduct(r)) continue;
    const first = r.n[0], last = r.n[r.n.length - 1];
    const ha = terrain.heightAt(N[first * 2], N[first * 2 + 1]);
    const hb = terrain.heightAt(N[last * 2], N[last * 2 + 1]);
    let total = 0;
    const lens: number[] = [0];
    for (let i = 1; i < r.n.length; i++) {
      total += Math.hypot(N[r.n[i] * 2] - N[r.n[i - 1] * 2], N[r.n[i] * 2 + 1] - N[r.n[i - 1] * 2 + 1]);
      lens.push(total);
    }
    for (let i = 1; i < r.n.length; i++) {
      const a = r.n[i - 1], b = r.n[i];
      const ya = ha + (hb - ha) * (lens[i - 1] / (total || 1)) + 0.25;
      const yb = ha + (hb - ha) * (lens[i] / (total || 1)) + 0.25;
      ground.addDeckSegment(N[a * 2], N[a * 2 + 1], N[b * 2], N[b * 2 + 1], ya, yb, r.w / 2 + 1.5);
    }
  }

  const roadPos: number[] = [], roadUv: number[] = [];
  const pavePos: number[] = []; // aceras/pasarelas sobre puentes
  const curbPos: number[] = []; // bordillos de granito
  const walkPos: number[] = []; // aceras elevadas de baldosa
  // Huellas de edificios y de zonas blandas (parques, plazas, agua) para medir el ancho de las aceras
  const foot = new FootprintIndex();
  data.buildings.forEach((b, i) => { if (!b.mh || b.mh < 2) foot.add(b.pts, 1, i); });
  const softIdx = new FootprintIndex();
  data.areas.forEach((a, i) => { if (a.kind !== 'parking' && a.kind !== 'rail' && (a.layer ?? 0) >= 0) softIdx.add(a.pts, 1, i); });
  const carway = new CarwayIndex(data, (_h, car) => car);
  const roadIndex = new Map<RoadData, number>();
  data.roads.forEach((r, i) => roadIndex.set(r, i));
  const pillars: number[][] = []; // para no duplicar pilares entre vías paralelas del mismo puente
  const markPos: number[] = [];
  const bridgePos: number[] = [];

  const surface = (x: number, z: number, onBridge: boolean) => (onBridge ? ground.heightAt(x, z) : terrain.heightAt(x, z));

  const quad = (arr: number[], a: number[], b: number[], c: number[], d: number[]) => {
    // a-b-c-d en sentido antihorario visto desde arriba
    arr.push(...a, ...b, ...c, ...a, ...c, ...d);
  };

  for (const r of data.roads) {
    if (!r.car && !r.br) continue;
    const pts = densify(r, N, 3);
    const hw = r.w / 2;
    const bridge = !!r.br;
    // Lados con inglete
    const L: number[][] = [], R: number[][] = [];
    let acc = 0;
    const along: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
      let dx = next[0] - prev[0], dz = next[1] - prev[1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      // miter con límite
      let mx = -dz, mz = dx;
      if (i > 0 && i < pts.length - 1) {
        const d1x = p[0] - prev[0], d1z = p[1] - prev[1], l1 = Math.hypot(d1x, d1z) || 1;
        const cos = (d1x / l1) * dx + (d1z / l1) * dz;
        const k = Math.min(1.8, 1 / Math.max(0.5, Math.sqrt((1 + cos) / 2)));
        mx *= k; mz *= k;
      }
      if (i > 0) acc += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      along.push(acc);
      const lx = p[0] + mx * hw, lz = p[1] + mz * hw, rx = p[0] - mx * hw, rz = p[1] - mz * hw;
      const yc = surface(p[0], p[1], bridge) + ROAD_LIFT;
      L.push([lx, bridge ? yc : terrain.heightAt(lx, lz) + ROAD_LIFT, lz]);
      R.push([rx, bridge ? yc : terrain.heightAt(rx, rz) + ROAD_LIFT, rz]);
    }
    if (r.car) {
      for (let i = 1; i < pts.length; i++) {
        // izquierda/derecha según la dirección: garantizamos cara hacia arriba comprobando el producto
        const a = R[i - 1], b = R[i], c = L[i], d = L[i - 1];
        const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
        if (cy > 0) quad(roadPos, a, b, c, d); else quad(roadPos, a, d, c, b);
        const u0 = along[i - 1] / 8, u1 = along[i] / 8, v = Math.max(1, Math.round(r.w / 7));
        if (cy > 0) roadUv.push(u0, 0, u1, 0, u1, v, u0, 0, u1, v, u0, v);
        else roadUv.push(u0, 0, u0, v, u1, v, u0, 0, u1, v, u1, 0);
      }
      // Bordillos a ambos lados (no en los cruces ni donde otra calzada se une) y acera elevada hasta la fachada
      if (!bridge && r.hw !== 'living_street' && r.hw !== 'service') {
        const ri = roadIndex.get(r)!;
        for (const [side, sign] of [[L, 1], [R, -1]] as const) {
          const n = side.length;
          const skip: boolean[] = [];
          const nrm: number[][] = [];
          for (let i = 0; i < n; i++) {
            const a = side[Math.max(0, i - 1)], b = side[Math.min(n - 1, i + 1)];
            const dxs = b[0] - a[0], dzs = b[2] - a[2], l = Math.hypot(dxs, dzs) || 1;
            nrm.push([(-dzs / l) * sign, (dxs / l) * sign]);
          }
          for (let i = 1; i < n; i++) {
            const a = side[i - 1], b = side[i];
            const mx = (a[0] + b[0]) / 2, mz = (a[2] + b[2]) / 2;
            const dxs = b[0] - a[0], dzs = b[2] - a[2], l = Math.hypot(dxs, dzs) || 1;
            const nx = (-dzs / l) * sign, nz = (dxs / l) * sign;
            skip.push(carway.on(mx + nx * 0.6, mz + nz * 0.6, 0.3, ri));
          }
          // ancho de acera en cada punto: hasta la fachada, otra calzada, un parque o una plaza (máx. 6 m)
          const width: number[] = [];
          for (let i = 0; i < n; i++) {
            const [nx, nz] = nrm[i];
            let w = 0;
            for (let d = 0.6; d <= 6; d += 0.4) {
              const x = side[i][0] + nx * d, z = side[i][2] + nz * d;
              if (foot.topAt(x, z) > -Infinity || softIdx.topAt(x, z) > -Infinity || carway.on(x, z, 0.2, ri)) break;
              w = d;
            }
            width.push(w);
          }
          // suavizado: mínimo de vecinos para que el borde no haga dientes de sierra
          const ws = width.map((_, i) => Math.min(width[Math.max(0, i - 1)], width[i], width[Math.min(n - 1, i + 1)]));
          const H = 0.15, Wc = 0.28;
          for (let i = 1; i < n; i++) {
            if (skip[i - 1]) continue;
            const a = side[i - 1], b = side[i];
            const [nax, naz] = nrm[i - 1], [nbx, nbz] = nrm[i];
            const ya = ground.terrain.heightAt(a[0] + nax * Wc, a[2] + naz * Wc), yb = ground.terrain.heightAt(b[0] + nbx * Wc, b[2] + nbz * Wc);
            const a0 = [a[0], a[1] - 0.02, a[2]], b0 = [b[0], b[1] - 0.02, b[2]];
            const a1 = [a[0], a[1] + H, a[2]], b1 = [b[0], b[1] + H, b[2]];
            const a2 = [a[0] + nax * Wc, Math.max(ya + 0.02, a[1] + H - 0.01), a[2] + naz * Wc], b2 = [b[0] + nbx * Wc, Math.max(yb + 0.02, b[1] + H - 0.01), b[2] + nbz * Wc];
            const a3 = [a2[0], ya - 0.05, a2[2]], b3 = [b2[0], yb - 0.05, b2[2]];
            curbPos.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1); // cara vista
            curbPos.push(...a1, ...b1, ...b2, ...a1, ...b2, ...a2); // canto superior
            const wa = ws[i - 1], wb = ws[i];
            if (wa < 0.9 || wb < 0.9) {
              curbPos.push(...a2, ...b2, ...b3, ...a2, ...b3, ...a3); // bordillo de jardín: trasdós visto
              continue;
            }
            // Acera de baldosa: del bordillo a la línea de fachada, a la cota del bordillo
            const oa = [a[0] + nax * wa, 0, a[2] + naz * wa], ob = [b[0] + nbx * wb, 0, b[2] + nbz * wb];
            const ta = ground.terrain.heightAt(oa[0], oa[2]), tb = ground.terrain.heightAt(ob[0], ob[2]);
            oa[1] = Math.max(ta + 0.04, a2[1] + (ta - ya) * 0.9);
            ob[1] = Math.max(tb + 0.04, b2[1] + (tb - yb) * 0.9);
            walkPos.push(...a2, ...b2, ...ob, ...a2, ...ob, ...oa);
            ground.addWalk(a2[0], a2[2], b2[0], b2[2], ob[0], ob[2], oa[0], oa[2], Math.max(0.04, (a2[1] - ya + b2[1] - yb) / 2));
            curbPos.push(...oa, ...ob, ob[0], tb - 0.1, ob[2], ...oa, ob[0], tb - 0.1, ob[2], oa[0], ta - 0.1, oa[2]); // canto exterior
          }
        }
      }
    } else {
      // Acera o pasarela de un puente: pavimento, un bordillo por encima de la calzada
      for (let i = 1; i < pts.length; i++) {
        const up = (p: number[]) => [p[0], p[1] + 0.16, p[2]];
        const a = up(R[i - 1]), b = up(R[i]), c = up(L[i]), d = up(L[i - 1]);
        const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
        if (cy > 0) quad(pavePos, a, b, c, d); else quad(pavePos, a, d, c, b);
      }
    }

    if (bridge && !inViaduct(r)) {
      // Intradós del tablero (para que se vea desde abajo)
      for (let i = 1; i < pts.length; i++) {
        const dn = (p: number[]) => [p[0], p[1] - 1.4, p[2]];
        quad(bridgePos, dn(R[i - 1]), dn(L[i - 1]), dn(L[i]), dn(R[i]));
      }
      // Pretiles y canto del tablero, solo en el borde exterior del puente: un viaducto suele
      // estar mapeado como varias vías paralelas (calzadas y aceras) y no queremos muros entre ellas
      for (const [side, sign] of [[L, 1], [R, -1]] as const) {
        for (let i = 1; i < side.length; i++) {
          const a = side[i - 1], b = side[i];
          const c = pts[i - 1], d = pts[i];
          const dx = d[0] - c[0], dz = d[1] - c[1], l = Math.hypot(dx, dz) || 1;
          // normal hacia fuera de este borde (L está a la izquierda: (-dz, dx) con signo)
          const nx = (-dz / l) * sign, nz = (dx / l) * sign;
          const mx = (a[0] + b[0]) / 2 + nx * 2.2, mz = (a[2] + b[2]) / 2 + nz * 2.2;
          const deckY = (a[1] + b[1]) / 2;
          const outside = ground.heightAt(mx, mz, deckY + 1);
          if (Math.abs(outside - deckY) < 1.2 && outside > terrain.heightAt(mx, mz) + 0.5) continue; // hay más tablero al lado
          wallStrip(bridgePos, a, b, 1.1, -1.4);
          collision.addSeg(a[0], a[2], b[0], b[2], Math.max(a[1], b[1]) + 1.1, Math.min(a[1], b[1]) - 1.5);
        }
      }
      for (let i = 0; i < pts.length; i += 7) {
        const p = pts[i];
        const deck = ground.heightAt(p[0], p[1]);
        const t = terrain.heightAt(p[0], p[1]);
        if (deck - t > 4 && !pillars.some(([px, pz]) => (px - p[0]) ** 2 + (pz - p[1]) ** 2 < 64)) {
          pillars.push([p[0], p[1]]);
          pillar(bridgePos, p[0], p[1], t - 1, deck - 1.4, Math.min(2.2, hw * 0.4));
          collision.addCircle(p[0], p[1], Math.min(2.2, hw * 0.4), deck - 1.4, t - 2);
        }
      }
    }

    // Marcas viales
    if (!r.car) continue;
    const twoWay = !r.ow;
    const lanes = r.lanes ?? (r.w >= 12 ? 4 : r.w >= 6.5 ? 2 : 1);
    const lines: number[] = [];
    if (twoWay && r.w >= 6) lines.push(0);
    if (!twoWay && lanes >= 2) for (let k = 1; k < lanes; k++) lines.push(-hw + (r.w * k) / lanes);
    if (twoWay && lanes >= 4) lines.push(-hw / 2, hw / 2);
    const endA = isJunction(r.n[0]) ? 9 : 0, endB = isJunction(r.n[r.n.length - 1]) ? 9 : 0;
    for (const off of lines) {
      for (let i = 1; i < pts.length; i++) {
        const s0 = along[i - 1], s1 = along[i];
        const mid = (s0 + s1) / 2;
        if (mid < endA || mid > acc - endB) continue;
        if (Math.floor(mid / 4.5) % 2 === 1 && !(off === 0 && r.w >= 12)) continue; // discontinua (continua en avenidas)
        const a = pts[i - 1], b = pts[i];
        const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
        const nx = -dz / l, nz = dx / l;
        const w = off === 0 && r.w >= 12 ? 0.3 : 0.14;
        stripe(markPos, a[0] + nx * off, a[1] + nz * off, b[0] + nx * off, b[1] + nz * off, w, (x, z) => surface(x, z, bridge) + ROAD_LIFT + 0.02);
      }
    }
  }

  // Pasos de cebra en los nodos marcados como cruce
  const crossingSet = new Set(data.crossings);
  for (const r of data.roads) {
    if (!r.car) continue;
    for (let i = 0; i < r.n.length; i++) {
      if (!crossingSet.has(r.n[i])) continue;
      crossingSet.delete(r.n[i]);
      const a = r.n[Math.max(0, i - 1)], b = r.n[Math.min(r.n.length - 1, i + 1)];
      let dx = N[b * 2] - N[a * 2], dz = N[b * 2 + 1] - N[a * 2 + 1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      const cx = N[r.n[i] * 2], cz = N[r.n[i] * 2 + 1];
      const nx = -dz, nz = dx;
      const hw = r.w / 2 - 0.3;
      for (let s = -hw + 0.3; s <= hw - 0.3; s += 1.0) {
        const px = cx + nx * s, pz = cz + nz * s;
        stripe(markPos, px - dx * 1.6, pz - dz * 1.6, px + dx * 1.6, pz + dz * 1.6, 0.5, (x, z) => ground.heightAt(x, z) + ROAD_LIFT + 0.025);
      }
    }
  }

  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPos, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUv, 2));
  roadGeo.computeVertexNormals();
  const roadMesh = new THREE.Mesh(roadGeo, new THREE.MeshStandardMaterial({
    map: asphaltTexture(), color: 0x9da2a8, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  roadMesh.receiveShadow = true;
  roadMesh.name = 'calzada';
  group.add(roadMesh);

  if (curbPos.length) {
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(curbPos, 3));
    cg.computeVertexNormals();
    const cm = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ color: 0xa49e94, roughness: 0.85, side: THREE.DoubleSide }));
    cm.receiveShadow = true;
    cm.castShadow = true;
    group.add(cm);
  }
  if (walkPos.length) {
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(walkPos, 3));
    const uv: number[] = [];
    for (let i = 0; i < walkPos.length; i += 3) uv.push(walkPos[i] / TEX_SIZE.baldosa, walkPos[i + 2] / TEX_SIZE.baldosa);
    wg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    wg.computeVertexNormals();
    const tex = pavingTextures().baldosa;
    const wm = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }));
    wm.receiveShadow = true;
    wm.name = 'aceras';
    group.add(wm);
  }
  if (pavePos.length) {
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(pavePos, 3));
    pg.computeVertexNormals();
    const pm = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ color: 0xa8a196, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    pm.receiveShadow = true;
    group.add(pm);
  }

  const markGeo = new THREE.BufferGeometry();
  markGeo.setAttribute('position', new THREE.Float32BufferAttribute(markPos, 3));
  markGeo.computeVertexNormals();
  const marks = new THREE.Mesh(markGeo, new THREE.MeshStandardMaterial({
    color: 0xe8e6de, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  }));
  marks.receiveShadow = true;
  group.add(marks);

  if (bridgePos.length) {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bridgePos, 3));
    bg.computeVertexNormals();
    const bm = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: 0xbdb5a5, roughness: 0.85, side: THREE.DoubleSide }));
    bm.castShadow = true;
    bm.receiveShadow = true;
    group.add(bm);
  }
  return { group, viaduct };
}

/** Polilínea de la calle con puntos cada `step` metros como máximo. */
export function densify(r: RoadData, N: number[], step: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < r.n.length; i++) {
    const x = N[r.n[i] * 2], z = N[r.n[i] * 2 + 1];
    if (i > 0) {
      const [px, pz] = out[out.length - 1];
      const len = Math.hypot(x - px, z - pz);
      const k = Math.ceil(len / step);
      for (let s = 1; s < k; s++) out.push([px + ((x - px) * s) / k, pz + ((z - pz) * s) / k]);
    }
    out.push([x, z]);
  }
  return out;
}

function stripe(arr: number[], ax: number, az: number, bx: number, bz: number, w: number, h: (x: number, z: number) => number) {
  const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
  const nx = (-dz / l) * (w / 2), nz = (dx / l) * (w / 2);
  const p = [
    [ax - nx, az - nz], [bx - nx, bz - nz], [bx + nx, bz + nz], [ax + nx, az + nz],
  ].map(([x, z]) => [x, h(x, z), z]);
  const cy = (p[1][2] - p[0][2]) * (p[2][0] - p[0][0]) - (p[1][0] - p[0][0]) * (p[2][2] - p[0][2]);
  if (cy > 0) arr.push(...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]);
  else arr.push(...p[0], ...p[2], ...p[1], ...p[0], ...p[3], ...p[2]);
}

function wallStrip(arr: number[], a: number[], b: number[], up: number, down: number) {
  const a0 = [a[0], a[1] + down, a[2]], b0 = [b[0], b[1] + down, b[2]];
  const a1 = [a[0], a[1] + up, a[2]], b1 = [b[0], b[1] + up, b[2]];
  arr.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
}

function pillar(arr: number[], x: number, z: number, y0: number, y1: number, r: number) {
  const c = [[x - r, z - r], [x + r, z - r], [x + r, z + r], [x - r, z + r]];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = c[i], [bx, bz] = c[(i + 1) % 4];
    arr.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
  }
}
