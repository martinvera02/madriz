import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WorldData } from './realData';
import type { Ground } from './roads';
import type { CollisionWorld } from './collision';
import type { Water } from './water';

/**
 * Reformas urbanas a mano:
 *  - Puentes de Madrid Río: de fábrica con arcos (Segovia, del Rey), presas con compuertas, pasarelas de acero,
 *    puentes de tráfico de hormigón y el arco de la Reina Victoria, colocados sobre el trazado real de OSM.
 *  - Plaza Mayor: Felipe III a caballo, enlosado, faroles, terrazas, pinturas de la Casa de la Panadería
 *    y el Arco de Cuchilleros con su escalerilla.
 *  - Plaza de España tras la reforma de 2021: el tráfico de Bailén va en túnel bajo la plaza (con ramal a la
 *    Cuesta de San Vicente) y arriba queda el paseo peatonal hacia los Jardines de Sabatini; Monumento a Cervantes.
 */

type V2 = [number, number];

/** Cubos de geometría por material (una malla por material al final). */
class Bag {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(g: THREE.BufferGeometry, m: THREE.Material) {
    const gg = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(gg.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') gg.deleteAttribute(k);
    if (!gg.attributes.uv) gg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2));
    if (!gg.attributes.normal) gg.computeVertexNormals();
    let a = this.parts.get(m);
    if (!a) this.parts.set(m, (a = []));
    a.push(gg);
  }
  /** Caja orientada: centro, tamaño (largo a lo largo de `ang`), rumbo. */
  box(cx: number, cy: number, cz: number, len: number, h: number, w: number, ang: number, m: THREE.Material) {
    this.add(new THREE.BoxGeometry(len, h, w).rotateY(-ang).translate(cx, cy, cz), m);
  }
  cyl(x: number, y0: number, y1: number, z: number, r: number, m: THREE.Material, seg = 10, r1 = r) {
    this.add(new THREE.CylinderGeometry(r1, r, y1 - y0, seg).translate(x, (y0 + y1) / 2, z), m);
  }
  /** Cuadrilátero a-b-c-d (cada punto x,y,z). */
  quad(a: number[], b: number[], c: number[], d: number[], m: THREE.Material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
    g.computeVertexNormals();
    this.add(g, m);
  }
  build(shadow = true) {
    const grp = new THREE.Group();
    for (const [m, gs] of this.parts) {
      const g = mergeGeometries(gs);
      if (!g) continue;
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = shadow && !(m as THREE.MeshStandardMaterial).transparent;
      mesh.receiveShadow = true;
      grp.add(mesh);
    }
    return grp;
  }
}

const mat = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });

// ------------------------------------------------------------------ estatua ecuestre

/** Jinete a caballo (bronce) sobre su pedestal; `donkey` para el rucio de Sancho. */
export function equestrian(bag: Bag, x: number, y: number, z: number, rot: number, s: number, bronze: THREE.Material, stone: THREE.Material | null, opts: { rearing?: boolean; donkey?: boolean; lance?: boolean; thin?: boolean } = {}) {
  const c = Math.cos(rot), sn = Math.sin(rot);
  const P = (lx: number, ly: number, lz: number): [number, number, number] => [x + lx * c + lz * sn, y + ly, z - lx * sn + lz * c];
  const part = (g: THREE.BufferGeometry, lx: number, ly: number, lz: number, rx = 0, rz = 0) => {
    g.rotateX(rx).rotateZ(rz).rotateY(rot).scale(s, s, s);
    const [px, py, pz] = P(lx * s, ly * s, lz * s);
    bag.add(g.translate(px, py, pz), bronze);
  };
  let base = 0;
  if (stone) {
    bag.box(...P(0, 1.6 * s, 0), 3.4 * s, 3.2 * s, 5.2 * s, -rot, stone);
    bag.box(...P(0, 3.3 * s, 0), 3.7 * s, 0.25 * s, 5.5 * s, -rot, stone);
    bag.box(...P(0, 0.15 * s, 0), 4.2 * s, 0.3 * s, 6.0 * s, -rot, stone);
    base = 3.42;
  }
  const k = opts.donkey ? 0.72 : 1, thin = opts.thin ? 0.75 : 1;
  const bodyY = base + 1.55 * k;
  // tronco, pecho y grupa
  part(new THREE.CapsuleGeometry(0.42 * k * thin, 1.5 * k, 4, 10).rotateX(Math.PI / 2), 0, bodyY, 0);
  part(new THREE.SphereGeometry(0.5 * k * thin, 10, 8), 0, bodyY + 0.05, 0.85 * k);
  part(new THREE.SphereGeometry(0.52 * k * thin, 10, 8), 0, bodyY + 0.05, -0.8 * k);
  // cuello y cabeza (encabritado: más alto)
  const up = opts.rearing ? 0.35 : 0;
  part(new THREE.CylinderGeometry(0.2 * k, 0.32 * k, 1.0 * k, 8), 0, bodyY + 0.6 * k + up, 1.2 * k, -0.7);
  part(new THREE.BoxGeometry(0.26 * k, 0.3 * k, 0.75 * k), 0, bodyY + 1.05 * k + up, 1.62 * k, 0.5);
  if (opts.donkey) for (const sx of [-0.09, 0.09]) part(new THREE.ConeGeometry(0.06, 0.45, 5), sx, bodyY + 1.4 * k, 1.55 * k);
  // patas (una delantera levantada si va al paso)
  const legs: [number, number, boolean][] = [[-0.25, 0.75, true], [0.25, 0.75, false], [-0.25, -0.75, false], [0.25, -0.75, false]];
  for (const [lx, lz, raised] of legs) {
    const L = 1.25 * k;
    if (raised && !opts.donkey) part(new THREE.CylinderGeometry(0.07 * k, 0.1 * k, L, 6), lx * k, bodyY - 0.3 * k, (lz + 0.25) * k, -1.0);
    else part(new THREE.CylinderGeometry(0.07 * k, 0.1 * k, L, 6), lx * k, base + L / 2, lz * k);
  }
  part(new THREE.CylinderGeometry(0.05 * k, 0.12 * k, 0.9 * k, 6), 0, bodyY - 0.15, -1.35 * k, 0.5); // cola
  // jinete: piernas a los lados, torso, cabeza con sombrero, brazo
  const ry = bodyY + 0.45 * k;
  for (const sx of [-0.32, 0.32]) part(new THREE.CylinderGeometry(0.1, 0.12, 0.85, 6), sx * k, ry - 0.25, 0.1, 0.3);
  part(new THREE.CylinderGeometry(0.22 * thin, 0.28, 0.85, 8), 0, ry + 0.45, 0.05);
  part(new THREE.SphereGeometry(0.17, 10, 8), 0, ry + 1.05, 0.08);
  part(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 12), 0, ry + 1.2, 0.08);
  part(new THREE.CylinderGeometry(0.13, 0.15, 0.22, 10), 0, ry + 1.32, 0.08);
  part(new THREE.CylinderGeometry(0.06, 0.07, 0.7, 6), 0.32, ry + 0.5, 0.35, -1.1);
  if (opts.lance) part(new THREE.CylinderGeometry(0.03, 0.03, 3.6, 5), 0.42, ry + 0.9, 0.6, -1.3);
}

// ------------------------------------------------------------------ puentes

interface BridgeWay { name: string; hw: string; w: number; pts: V2[] }

/** Resumen de los puentes construidos (depuración). */
export const bridgeLog: string[] = [];

export function buildBridges(data: WorldData, ground: Ground, collision: CollisionWorld, waterSys: Water): THREE.Group {
  const N = data.roadNodes;
  const ways: BridgeWay[] = [];
  for (const r of data.roads) {
    if (!r.br) continue;
    const pts = r.n.map((k) => [N[k * 2], N[k * 2 + 1]] as V2);
    if (!pts.some(([x]) => x < -1350)) continue;
    ways.push({ name: r.name ?? '', hw: r.hw, w: r.w, pts });
  }
  // agrupar: las aceras y calzadas sin nombre paralelas a un puente con nombre son parte de él
  const len = (w: BridgeWay) => { let l = 0; for (let i = 1; i < w.pts.length; i++) l += Math.hypot(w.pts[i][0] - w.pts[i - 1][0], w.pts[i][1] - w.pts[i - 1][1]); return l; };
  const groups = new Map<string, BridgeWay[]>();
  for (const w of ways) {
    if (len(w) < 20) continue;
    let key = w.name.replace(/ Norte$/, '');
    if (!key) {
      const mid = (q: BridgeWay): V2 => [(q.pts[0][0] + q.pts[q.pts.length - 1][0]) / 2, (q.pts[0][1] + q.pts[q.pts.length - 1][1]) / 2];
      const [mx, mz] = mid(w);
      let best = '', bd = 45;
      for (const o of ways) {
        if (!o.name || len(o) < 0.5 * len(w)) continue;
        const [ox, oz] = mid(o);
        const d = Math.hypot(ox - mx, oz - mz);
        if (d < bd) { bd = d; best = o.name.replace(/ Norte$/, ''); }
      }
      key = best || `pasarela${groups.size}`;
    }
    let a = groups.get(key);
    if (!a) groups.set(key, (a = []));
    a.push(w);
  }

  const granite = mat(0xb8afa0, { roughness: 0.9, side: THREE.DoubleSide });
  const graniteD = mat(0x9c9486, { roughness: 0.95, side: THREE.DoubleSide });
  const concrete = mat(0xa9a7a1, { roughness: 0.9 });
  const steel = mat(0xd8dcde, { roughness: 0.35, metalness: 0.6 });
  const steelD = mat(0x4b5258, { roughness: 0.4, metalness: 0.6 });
  const iron = mat(0x23282b, { roughness: 0.5, metalness: 0.5 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffc97a, emissiveIntensity: 1.4 });
  const bag = new Bag();

  const lamp = (x: number, y: number, z: number) => {
    bag.cyl(x, y, y + 4.2, z, 0.09, iron, 8, 0.06);
    bag.cyl(x, y, y + 0.5, z, 0.2, iron, 8);
    bag.add(new THREE.SphereGeometry(0.24, 8, 6).translate(x, y + 4.45, z), glow);
  };

  /** Tramo recto de pasarela de acero entre dos puntos (a la cota del tablero). */
  const footSeg = (a: V2, b: V2, w: number) => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1) return;
    const dx = (b[0] - a[0]) / l, dz = (b[1] - a[1]) / l, nx = -dz, nz = dx, an = Math.atan2(dz, dx);
    const n = Math.max(1, Math.ceil(l / 4));
    const dk = (t: number) => ground.heightAt(a[0] + dx * t, a[1] + dz * t, 1e4);
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * l, t1 = ((i + 1) / n) * l, y0 = dk(t0), y1 = dk(t1);
      const sl = t1 - t0;
      bag.add(new THREE.BoxGeometry(sl, 0.6, w).rotateZ(Math.atan2(y1 - y0, sl)).rotateY(-an).translate(a[0] + dx * (t0 + t1) / 2, (y0 + y1) / 2 - 0.38, a[1] + dz * (t0 + t1) / 2), steel);
      for (const o of [-w / 2, w / 2]) {
        const x0 = a[0] + dx * t0 + nx * o, z0 = a[1] + dz * t0 + nz * o, x1 = a[0] + dx * t1 + nx * o, z1 = a[1] + dz * t1 + nz * o;
        bag.add(new THREE.BoxGeometry(sl, 0.06, 0.06).rotateZ(Math.atan2(y1 - y0, sl)).rotateY(-an).translate((x0 + x1) / 2, (y0 + y1) / 2 + 1.1, (z0 + z1) / 2), steelD);
        bag.box(x0, y0 + 0.55, z0, 0.05, 1.1, 0.05, an, steelD);
        collision.addSeg(x0, z0, x1, z1, Math.max(y0, y1) + 1.1, Math.min(y0, y1) - 0.5);
      }
    }
    const tw = waterSys.riverLevel;
    for (let t = 20; t < l - 10; t += 30) {
      const x = a[0] + dx * t, z = a[1] + dz * t, yt = dk(t) - 0.7, yb = Math.min(ground.terrain.heightAt(x, z), tw ? tw(x, z) : 1e9) - 1.5;
      if (yt - yb > 0.6) bag.cyl(x, yb, yt, z, 0.25, steelD, 8);
    }
  };

  for (const [name, ws] of groups) {
    // eje: el tramo más largo; ancho: lo que abarcan todas las vías del grupo
    const main = ws.reduce((a, b) => (len(b) > len(a) ? b : a));
    const A = main.pts[0], B = main.pts[main.pts.length - 1];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const ux = (B[0] - A[0]) / L, uz = (B[1] - A[1]) / L, nx = -uz, nz = ux;
    let o0 = Infinity, o1 = -Infinity;
    for (const w of ws) for (const p of w.pts) {
      const t = (p[0] - A[0]) * ux + (p[1] - A[1]) * uz;
      if (t < -5 || t > L + 5) continue;
      const o = (p[0] - A[0]) * nx + (p[1] - A[1]) * nz;
      o0 = Math.min(o0, o - w.w / 2); o1 = Math.max(o1, o + w.w / 2);
    }
    const W = o1 - o0, oc = (o0 + o1) / 2;
    const ang = Math.atan2(uz, ux);
    const at = (t: number, o = oc): V2 => [A[0] + ux * t + nx * o, A[1] + uz * t + nz * o];
    const deck = (t: number) => { const [x, z] = at(t); return ground.heightAt(x, z, 1e4); };
    const water = (t: number) => { const [x, z] = at(t); return waterSys.riverLevel ? waterSys.riverLevel(x, z) : ground.terrain.heightAt(x, z); };
    const bed = (t: number) => { const [x, z] = at(t); return Math.min(ground.terrain.heightAt(x, z), water(t)) - 1.5; };
    const kind0 = /segovia|del rey/i.test(name) ? 'stone' : /presa/i.test(name) ? 'weir' : /reina victoria/i.test(name) ? 'arch' : ws.some((w) => w.hw !== 'footway' && w.hw !== 'cycleway' && w.hw !== 'pedestrian') ? 'road' : 'foot';
    const kind = kind0;
    bridgeLog.push(`${name}: ${kind}, ${L.toFixed(0)} m × ${W.toFixed(1)} m, tablero ${(deck(L / 2) - water(L / 2)).toFixed(1)} m sobre el agua @ ${at(L / 2).map((v) => v.toFixed(0)).join(',')} ang ${(ang * 57.3).toFixed(0)}`);

    // pretiles a ambos lados (con colisión por encima del tablero)
    const parapet = (o: number, m: THREE.Material, h: number, thick: number, balls = 0) => {
      const n = Math.max(2, Math.ceil(L / 6));
      for (let i = 0; i < n; i++) {
        const t0 = (i / n) * L, t1 = ((i + 1) / n) * L;
        const [x0, z0] = at(t0, o), [x1, z1] = at(t1, o);
        const y0 = deck(t0), y1 = deck(t1);
        const sl = Math.hypot(x1 - x0, z1 - z0);
        bag.add(new THREE.BoxGeometry(sl, h, thick).rotateZ(Math.atan2(y1 - y0, sl)).rotateY(-ang).translate((x0 + x1) / 2, (y0 + y1) / 2 + h / 2, (z0 + z1) / 2), m);
        collision.addSeg(x0, z0, x1, z1, Math.max(y0, y1) + h, Math.min(y0, y1) - 0.5);
      }
      if (balls) for (let i = 1; i < balls; i++) {
        const t = (i / balls) * L, [x, z] = at(t, o), y = deck(t);
        bag.box(x, y + h + 0.25, z, 0.5, 0.5, 0.5, ang, m);
        bag.add(new THREE.SphereGeometry(0.32, 10, 8).translate(x, y + h + 0.82, z), m);
      }
    };

    if (kind === 'stone') {
      // arcos de medio punto de granito, pilas con tajamares, enjutas y pretil con bolas herrerianas
      const nArch = /segovia/i.test(name) ? 9 : 3;
      const pierW = /segovia/i.test(name) ? 4.2 : 3;
      const span = (L - pierW * (nArch + 1)) / nArch;
      const thick = 0.9;
      for (let i = 0; i <= nArch; i++) {
        const tc = pierW / 2 + i * (span + pierW);
        const [px, pz] = at(tc);
        const yb = bed(tc), yt = deck(tc) - 0.6;
        bag.box(px, (yb + yt) / 2, pz, pierW, yt - yb, W, ang, granite);
        // tajamares aguas arriba y abajo (prismas triangulares) con su sombrerete
        for (const sgn of [-1, 1]) {
          const [cx, cz] = at(tc, oc + sgn * (W / 2 + pierW * 0.35));
          const tri = new THREE.CylinderGeometry(pierW * 0.58, pierW * 0.58, yt - 1.6 - yb, 3).rotateY(sgn > 0 ? Math.PI / 6 : -Math.PI / 6 + Math.PI).rotateY(-ang - Math.PI / 2).translate(cx, (yb + yt - 1.6) / 2, cz);
          bag.add(tri, graniteD);
          bag.add(new THREE.ConeGeometry(pierW * 0.58, 1.6, 3).rotateY(sgn > 0 ? Math.PI / 6 : -Math.PI / 6 + Math.PI).rotateY(-ang - Math.PI / 2).translate(cx, yt - 0.8, cz), graniteD);
        }
      }
      for (let i = 0; i < nArch; i++) {
        const t0 = pierW + i * (span + pierW), t1 = t0 + span, half = span / 2, tm = (t0 + t1) / 2;
        // arco: de medio punto si cabe; si el tablero va bajo sobre el agua, rebajado, arrancando del agua
        const base = Math.max(water(tm) + 0.3, bed(tm) + 1.5);
        const rise = Math.max(0.8, Math.min(half, deck(tm) - 1.0 - base));
        const R = (half * half + rise * rise) / (2 * rise), cyA = base + rise - R, th = Math.asin(Math.min(1, half / R));
        const segs = 12;
        const arcPt = (k: number): [number, number] => { const a = -th + (2 * th * k) / segs; return [tm + Math.sin(a) * R, cyA + Math.cos(a) * R]; };
        for (const side of [o0, o1]) {
          // enjuta: entre el trasdós del arco y el tablero
          for (let k = 0; k < segs; k++) {
            const [ta, ya] = arcPt(k), [tb, yb2] = arcPt(k + 1);
            const [xa, za] = at(ta, side), [xb, zb] = at(tb, side);
            bag.quad([xa, ya, za], [xb, yb2, zb], [xb, deck(tb) - 0.2, zb], [xa, deck(ta) - 0.2, za], granite);
            // dovelas resaltadas
            const [xa2, za2] = at(ta, side + (side === o0 ? -0.12 : 0.12)), [xb2, zb2] = at(tb, side + (side === o0 ? -0.12 : 0.12));
            bag.quad([xa2, ya, za2], [xb2, yb2, zb2], [xb2, yb2 + thick * 0.8, zb2], [xa2, ya + thick * 0.8, za2], graniteD);
          }
        }
        // intradós (la bóveda vista desde abajo)
        for (let k = 0; k < segs; k++) {
          const [ta, ya] = arcPt(k), [tb, yb2] = arcPt(k + 1);
          const [x0a, z0a] = at(ta, o0), [x1a, z1a] = at(ta, o1), [x0b, z0b] = at(tb, o0), [x1b, z1b] = at(tb, o1);
          bag.quad([x0a, ya, z0a], [x1a, ya, z1a], [x1b, yb2, z1b], [x0b, yb2, z0b], graniteD);
        }
        // tímpano bajo el arranque hasta el lecho (estribos de la pila ya lo cubren)
      }
      parapet(o0 + 0.3, granite, 1.05, 0.6, nArch + 1);
      parapet(o1 - 0.3, granite, 1.05, 0.6, nArch + 1);
      for (let i = 1; i < nArch; i += 2) { const t = pierW / 2 + i * (span + pierW); for (const o of [o0 + 0.3, o1 - 0.3]) { const [x, z] = at(t, o); lamp(x, deck(t) + 1.05, z); } }
    } else if (kind === 'arch') {
      // Reina Victoria: un gran arco rebajado de hormigón con montantes y farolas
      const rise = Math.min(8, deck(L / 2) - bed(L / 2) - 1.5), half = L / 2;
      const R = (half * half + rise * rise) / (2 * rise);
      const base = deck(L / 2) - 1 - rise;
      for (let k = 0; k < 16; k++) {
        const ta = (k / 16) * L, tb = ((k + 1) / 16) * L;
        const ya = base + Math.sqrt(Math.max(0, R * R - (ta - half) ** 2)) - (R - rise), yb = base + Math.sqrt(Math.max(0, R * R - (tb - half) ** 2)) - (R - rise);
        for (const o of [o0 + 0.6, o1 - 0.6]) {
          const [xa, za] = at(ta, o), [xb, zb] = at(tb, o);
          const sl = Math.hypot(xb - xa, zb - za);
          bag.add(new THREE.BoxGeometry(sl, 1.0, 1.0).rotateZ(Math.atan2(yb - ya, sl)).rotateY(-ang).translate((xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2), concrete);
          if (k % 2 === 0) bag.box(xa, (ya + deck(ta)) / 2, za, 0.5, Math.max(0.2, deck(ta) - ya), 0.5, ang, concrete);
        }
      }
      const [mx, mz] = at(L / 2);
      bag.box(mx, deck(L / 2) - 0.5, mz, L, 1.0, W, ang, concrete);
      parapet(o0 + 0.2, concrete, 1.0, 0.4);
      parapet(o1 - 0.2, concrete, 1.0, 0.4);
      for (const t of [L * 0.15, L * 0.5, L * 0.85]) for (const o of [o0 + 0.2, o1 - 0.2]) { const [x, z] = at(t, o); lamp(x, deck(t) + 1, z); }
    } else if (kind === 'weir') {
      // presa: azud de hormigón con pilas y compuertas, pasarela por encima
      const n = 5;
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * L, [x, z] = at(t), yb = bed(t), yt = deck(t);
        bag.box(x, (yb + yt) / 2 - 0.3, z, 1.4, yt - yb - 0.6, W + 4, ang, concrete);
        bag.box(x, yt + 1.6, z, 1.6, 3.2, 3.2, ang, concrete);
      }
      for (let i = 0; i < n; i++) {
        const t = ((i + 0.5) / n) * L, [x, z] = at(t), wl = water(t);
        bag.box(x, wl - 0.1, z, L / n - 1.4, 1.6, 0.5, ang, steelD); // compuerta
        bag.box(x, deck(t) - 0.35, z, L / n - 1.4, 0.5, W, ang, concrete);
      }
      parapet(o0 + 0.1, steel, 1.1, 0.08);
      parapet(o1 - 0.1, steel, 1.1, 0.08);
    } else if (kind === 'road') {
      // puente de tráfico: tablero de hormigón sobre pilas cada ~30 m
      const n = Math.max(2, Math.round(L / 30));
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * L, [x, z] = at(t), yb = bed(t), yt = deck(t) - 1.6;
        if (yt - yb < 0.5) continue;
        for (const o of [o0 + W * 0.25, o1 - W * 0.25]) { const [px, pz] = at(t, o); bag.cyl(px, yb, yt, pz, 0.9, concrete, 12); }
        bag.box(x, yt + 0.3, z, 1.6, 0.6, W, ang, concrete);
      }
      for (let i = 0; i < n * 3; i++) {
        const t0 = (i / (n * 3)) * L, t1 = ((i + 1) / (n * 3)) * L;
        const [x0, z0] = at(t0), [x1, z1] = at(t1);
        const y0 = deck(t0), y1 = deck(t1), sl = Math.hypot(x1 - x0, z1 - z0);
        bag.add(new THREE.BoxGeometry(sl, 1.4, W).rotateZ(Math.atan2(y1 - y0, sl)).rotateY(-ang).translate((x0 + x1) / 2, (y0 + y1) / 2 - 0.85, (z0 + z1) / 2), concrete);
      }
      parapet(o0 + 0.15, steel, 1.1, 0.12);
      parapet(o1 - 0.15, steel, 1.1, 0.12);
      for (let t = 10; t < L; t += 28) for (const o of [o0 + 0.15, o1 - 0.15]) { const [x, z] = at(t, o); lamp(x, deck(t), z); }
    } else if (kind === 'foot' && (W > 8 || ws.length > 1 || main.pts.length > 2)) {
      // pasarelas con varios brazos o curvas: cada tramo por separado
      for (const w of ws) for (let i = 1; i < w.pts.length; i++) footSeg(w.pts[i - 1], w.pts[i], w.w + 0.6);
    } else {
      // pasarela de acero: tablero fino, vigas cajón, apoyos esbeltos y barandilla de acero
      for (let i = 0; i < Math.ceil(L / 4); i++) {
        const t0 = (i / Math.ceil(L / 4)) * L, t1 = ((i + 1) / Math.ceil(L / 4)) * L;
        const [x0, z0] = at(t0), [x1, z1] = at(t1);
        const y0 = deck(t0), y1 = deck(t1), sl = Math.hypot(x1 - x0, z1 - z0);
        bag.add(new THREE.BoxGeometry(sl, 0.7, W + 0.4).rotateZ(Math.atan2(y1 - y0, sl)).rotateY(-ang).translate((x0 + x1) / 2, (y0 + y1) / 2 - 0.42, (z0 + z1) / 2), steel);
      }
      const nP = Math.max(1, Math.round(L / 40));
      for (let i = 1; i < nP; i++) {
        const t = (i / nP) * L, yb = bed(t), yt = deck(t) - 0.8;
        if (yt - yb < 0.5) continue;
        for (const o of [oc - 0.6, oc + 0.6]) { const [x, z] = at(t, o); bag.cyl(x, yb, yt, z, 0.22, steelD, 8); }
      }
      parapet(o0 - 0.1, steelD, 1.1, 0.06);
      parapet(o1 + 0.1, steelD, 1.1, 0.06);
      for (let t = 0; t <= L; t += 2.2) for (const o of [o0 - 0.1, o1 + 0.1]) { const [x, z] = at(t, o); bag.box(x, deck(t) + 0.55, z, 0.05, 1.1, 0.05, ang, steelD); }
    }
  }
  return bag.build();
}

// ------------------------------------------------------------------ Plaza Mayor

/** Pintura mural original (figuras alegóricas sobre ocre) con huecos para los balcones. */
function muralTexture(len: number, h: number, windows: { u: number; y0: number; y1: number }[]) {
  const ppm = 24, cw = Math.ceil(len * ppm), ch = Math.ceil(h * ppm);
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const c = cv.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, 0, ch);
  g.addColorStop(0, '#d9a25c'); g.addColorStop(1, '#c4813f');
  c.fillStyle = g; c.fillRect(0, 0, cw, ch);
  let seed = 11;
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // figuras alegóricas: cuerpos estilizados con túnicas de color, en grupos entre los balcones
  const cols = ['#8b3f63', '#3f6f8b', '#a8473a', '#e8c98a', '#5d7d4a', '#7a4a8c'];
  for (let i = 0; i < len * 1.6; i++) {
    const x = r() * cw, y = ch * (0.15 + r() * 0.7), s = ppm * (1.2 + r() * 0.9);
    c.save(); c.translate(x, y); c.rotate((r() - 0.5) * 0.8);
    c.fillStyle = cols[Math.floor(r() * cols.length)];
    c.beginPath(); c.moveTo(-0.35 * s, 1.4 * s); c.quadraticCurveTo(-0.5 * s, 0.2 * s, 0, -0.2 * s); c.quadraticCurveTo(0.5 * s, 0.2 * s, 0.35 * s, 1.4 * s); c.closePath(); c.fill();
    c.fillStyle = '#e9c7a1';
    c.beginPath(); c.arc(0, -0.42 * s, 0.22 * s, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#e9c7a1'; c.lineWidth = 0.09 * s; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, 0); c.lineTo((r() - 0.5) * 1.2 * s, (r() - 0.8) * 0.8 * s); c.stroke();
    c.restore();
  }
  // orlas y cenefas doradas
  c.strokeStyle = '#f0d58a'; c.lineWidth = 3;
  for (let y = ppm * 0.4; y < ch; y += ppm * 3.3) { c.beginPath(); c.moveTo(0, y); c.lineTo(cw, y); c.stroke(); }
  // huecos de los balcones
  for (const w of windows) c.clearRect((w.u - 0.85) * ppm, ch - w.y1 * ppm, 1.7 * ppm, (w.y1 - w.y0) * ppm);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildPlazaMayor(data: WorldData, ground: Ground, collision: CollisionWorld): THREE.Group {
  const out = new THREE.Group();
  const plaza = data.areas.find((a) => a.name === 'Plaza Mayor' && a.kind === 'plaza');
  if (!plaza) return out;
  const bag = new Bag();
  const bronze = mat(0x3b4a3a, { roughness: 0.45, metalness: 0.7 });
  const granite = mat(0xb9b0a1, { roughness: 0.9 });
  const joint = mat(0x8c8377, { roughness: 1 });
  const iron = mat(0x1f2326, { roughness: 0.5, metalness: 0.5 });
  const cloth = mat(0xe9e2cf, { roughness: 0.95, side: THREE.DoubleSide });
  const clothR = mat(0x9a3a2c, { roughness: 0.95, side: THREE.DoubleSide });
  const marble = mat(0xece8df, { roughness: 0.3 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffc97a, emissiveIntensity: 1.4 });
  const pts = plaza.pts;
  const inside = (x: number, z: number) => {
    let c = false;
    for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
      const xi = pts[i], zi = pts[i + 1], xj = pts[j], zj = pts[j + 1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  let cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; cz += pts[i + 1]; }
  cx /= pts.length / 2; cz /= pts.length / 2;
  const fel = data.pois.find((p) => p.name === 'Felipe III' && Math.hypot(p.x - cx, p.z - cz) < 40) ?? { x: cx, z: cz };
  const y = (x: number, z: number) => ground.heightAt(x, z);
  // eje de la plaza: el lado más largo del polígono
  let ang = 0, bl = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const j = (i + 2) % pts.length, l = Math.hypot(pts[j] - pts[i], pts[j + 1] - pts[i + 1]);
    if (l > bl) { bl = l; ang = Math.atan2(pts[j + 1] - pts[i + 1], pts[j] - pts[i]); }
  }
  // Felipe III a caballo (Giambologna y Pietro Tacca), mirando a lo largo de la plaza
  equestrian(bag, fel.x, y(fel.x, fel.z), fel.z, ang + Math.PI / 2, 1.25, bronze, granite);
  collision.addCircle(fel.x, fel.z, 3.6, y(fel.x, fel.z) + 4.4);
  // enlosado de granito: retícula de juntas alineada con la plaza
  const ux = Math.cos(ang), uz = Math.sin(ang);
  for (const [ax, az] of [[ux, uz], [-uz, ux]] as V2[]) {
    for (let o = -110; o <= 110; o += 6) {
      for (let t = -110; t < 110; t += 2) {
        const x0 = fel.x + ax * t - az * o, z0 = fel.z + az * t + ax * o;
        const x1 = x0 + ax * 2, z1 = z0 + az * 2;
        if (!inside(x0, z0) || !inside(x1, z1)) continue;
        bag.box((x0 + x1) / 2, y((x0 + x1) / 2, (z0 + z1) / 2) + 0.045, (z0 + z1) / 2, 2, 0.02, 0.18, Math.atan2(az, ax), joint);
      }
    }
  }
  // faroles de forja: cuatro alrededor de la estatua y una fila a cada lado
  const farol = (x: number, z: number) => {
    const y0 = y(x, z);
    bag.cyl(x, y0, y0 + 0.6, z, 0.22, iron, 8);
    bag.cyl(x, y0, y0 + 3.8, z, 0.08, iron, 8, 0.06);
    for (const [dx, dz] of [[0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]]) {
      bag.box(x + dx / 2, y0 + 3.85, z + dz / 2, Math.abs(dx) + 0.05, 0.05, Math.abs(dz) + 0.05, 0, iron);
      bag.box(x + dx, y0 + 4.05, z + dz, 0.28, 0.42, 0.28, 0, glow);
      bag.add(new THREE.ConeGeometry(0.24, 0.2, 4).rotateY(Math.PI / 4).translate(x + dx, y0 + 4.36, z + dz), iron);
    }
    collision.addCircle(x, z, 0.25, y0 + 3.8);
  };
  for (const [dx, dz] of [[7, 7], [-7, 7], [7, -7], [-7, -7]]) farol(fel.x + ux * dx - uz * dz, fel.z + uz * dx + ux * dz);
  // terrazas con sombrillas a lo largo de los soportales
  let seed = 5;
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < pts.length; i += 2) {
    const j = (i + 2) % pts.length;
    const ax = pts[i], az = pts[i + 1], bx = pts[j], bz = pts[j + 1];
    const l = Math.hypot(bx - ax, bz - az);
    if (l < 20) continue;
    const dx = (bx - ax) / l, dz = (bz - az) / l;
    let nx = -dz, nz = dx;
    if (!inside((ax + bx) / 2 + nx * 4, (az + bz) / 2 + nz * 4)) { nx = -nx; nz = -nz; }
    for (let t = 8; t < l - 8; t += 7.5) {
      if (r() < 0.35) continue;
      const x = ax + dx * t + nx * 6, z = az + dz * t + nz * 6, y0 = y(x, z);
      if (!inside(x, z)) continue;
      bag.cyl(x, y0, y0 + 0.74, z, 0.04, iron, 6);
      bag.cyl(x, y0 + 0.74, y0 + 0.78, z, 0.38, marble, 12);
      for (const s of [-0.6, 0.6]) {
        bag.box(x + dx * s, y0 + 0.45, z + dz * s, 0.42, 0.05, 0.42, 0, iron);
        bag.box(x + dx * s * 1.3, y0 + 0.72, z + dz * s * 1.3, 0.05, 0.5, 0.42, Math.atan2(dz, dx), iron);
      }
      bag.cyl(x, y0 + 0.78, y0 + 2.5, z, 0.03, iron, 6);
      bag.add(new THREE.ConeGeometry(1.5, 0.45, 8, 1, true).translate(x, y0 + 2.55, z), r() < 0.5 ? cloth : clothR);
    }
    // farolas a lo largo
    for (let t = 12; t < l - 6; t += 24) { const x = ax + dx * t + nx * 10, z = az + dz * t + nz * 10; if (inside(x, z)) farol(x, z); }
  }
  // Casa de la Panadería: pinturas murales (originales, de inspiración alegórica) entre sus balcones
  const pan = data.buildings.find((b) => (b as { name?: string }).name === 'Casa de la Panadería');
  if (pan) {
    let best: { ax: number; az: number; bx: number; bz: number; l: number } | null = null, bd = Infinity;
    for (let i = 0; i < pan.pts.length; i += 2) {
      const j = (i + 2) % pan.pts.length;
      const ax = pan.pts[i], az = pan.pts[i + 1], bx = pan.pts[j], bz = pan.pts[j + 1];
      const l = Math.hypot(bx - ax, bz - az);
      if (l < 12) continue;
      const d = Math.hypot((ax + bx) / 2 - fel.x, (az + bz) / 2 - fel.z);
      if (d < bd) { bd = d; best = { ax, az, bx, bz, l }; }
    }
    if (best) {
      const { ax, az, bx, bz, l } = best;
      const dx = (bx - ax) / l, dz = (bz - az) / l;
      let nx = -dz, nz = dx;
      if (Math.hypot((ax + bx) / 2 + nx * 5 - fel.x, (az + bz) / 2 + nz * 5 - fel.z) > bd) { nx = -nx; nz = -nz; }
      const g0 = Math.min(y(ax, az), y(bx, bz));
      const top = pan.h - 2.2;
      const n = Math.max(1, Math.floor(l / 3.0));
      const wins: { u: number; y0: number; y1: number }[] = [];
      for (const fy of [4.9 + 0.5, 8.2 + 0.5, 11.5 + 0.5]) for (let k = 0; k < n; k++) wins.push({ u: (k + 0.5) * (l / n), y0: fy - 4.9 + 0.1, y1: fy - 4.9 + 2.5 });
      const tex = muralTexture(l, top - 4.9, wins);
      const m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.5, roughness: 0.9 });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(l, top - 4.9), m);
      plane.position.set((ax + bx) / 2 + nx * 0.82, g0 + (4.9 + top) / 2, (az + bz) / 2 + nz * 0.82);
      plane.rotation.y = Math.atan2(nx, nz);
      plane.receiveShadow = true;
      out.add(plane);
    }
  }
  // Arco de Cuchilleros: el arco de granito y la escalerilla que baja a la Cava de San Miguel
  const N = data.roadNodes;
  const cuch = data.roads.find((rd) => rd.name === 'Calle de los Cuchilleros' && rd.hw === 'pedestrian');
  if (cuch) {
    const p = cuch.n.map((k) => [N[k * 2], N[k * 2 + 1]] as V2);
    const a = p[p.length - 1], b = p[0];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, nx = -dz, nz = dx;
    const ya = y(a[0], a[1]);
    for (const s of [-1, 1]) {
      const px = a[0] + nx * s * 2.6, pz = a[1] + nz * s * 2.6;
      bag.box(px, ya + 3, pz, 1.4, 6, 1.4, Math.atan2(dz, dx), granite);
    }
    for (let k = 0; k < 9; k++) {
      const a0 = (k / 9) * Math.PI, a1 = ((k + 1) / 9) * Math.PI;
      const o = Math.cos((a0 + a1) / 2) * 1.9, yy = ya + 6 + Math.sin((a0 + a1) / 2) * 1.9;
      bag.box(a[0] + nx * o, yy, a[1] + nz * o, 1.4, 0.5, 0.75, Math.atan2(dz, dx), granite);
    }
    bag.box(a[0], ya + 8.6, a[1], 1.4, 1.2, 7, Math.atan2(dz, dx), granite);
    // peldaños siguiendo la cuesta
    for (let t = 1; t < L; t += 0.45) {
      const x = a[0] + dx * t, z = a[1] + dz * t;
      bag.box(x, y(x, z) + 0.06, z, 0.12, 0.12, 4.6, Math.atan2(dz, dx), joint);
    }
  }
  out.add(bag.build());
  return out;
}

// ------------------------------------------------------------------ Plaza de España y túnel de Bailén

export interface Tunnel { group: THREE.Group; cuts: { pts: number[]; floor: number; floorAt: (x: number, z: number) => number }[] }

export function buildPlazaEspana(data: WorldData, ground: Ground, collision: CollisionWorld): Tunnel {
  const bag = new Bag();
  const concrete = mat(0xb3b0a8, { roughness: 0.9, side: THREE.DoubleSide });
  const tile = mat(0xd9d6cc, { roughness: 0.4, side: THREE.DoubleSide });
  const asphalt = mat(0x2b2c2f, { roughness: 0.95, side: THREE.DoubleSide });
  const paint = mat(0xe8e6df, { roughness: 0.6, side: THREE.DoubleSide });
  const glowCool = new THREE.MeshStandardMaterial({ color: 0xf2f6ff, emissive: 0xdfe9ff, emissiveIntensity: 1.6 });
  const signG = new THREE.MeshStandardMaterial({ color: 0x1d7a3a, emissive: 0x1d7a3a, emissiveIntensity: 0.8 });
  const paving = mat(0xc9bfae, { roughness: 0.85 });
  const iron = mat(0x23282b, { roughness: 0.5, metalness: 0.5 });
  const wood = mat(0x7a5232, { roughness: 0.7 });
  const leaf = mat(0x4f7d3a, { roughness: 0.9 });
  const bark = mat(0x5a4632, { roughness: 1 });
  const stone = mat(0xd6ccb8, { roughness: 0.9 });
  const bronze = mat(0x3b4a3a, { roughness: 0.45, metalness: 0.7 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffc97a, emissiveIntensity: 1.4 });
  const terr = (x: number, z: number) => ground.terrain.heightAt(x, z);
  const cuts: Tunnel['cuts'] = [];

  // trazado (el túnel no viene en los datos: se traza siguiendo la calle de Bailén bajo la plaza de Oriente,
  // los Jardines de Sabatini y la plaza de España, con salida a la calle de la Princesa y ramal a San Vicente)
  const lines: { pts: V2[]; portalA: boolean; portalB: boolean; joinA?: boolean }[] = [
    { pts: [[-822, -46], [-830, -90], [-834, -140], [-833, -210], [-826, -290], [-806, -380], [-800, -460], [-806, -540], [-790, -620], [-755, -700], [-722, -785], [-694, -850]], portalA: true, portalB: true },
    { pts: [[-806, -540], [-826, -548], [-846, -552]], portalA: false, portalB: true, joinA: true },
  ];
  const W = 9.5, DEPTH = 7.6, H = 5.4, RAMP = 85;
  const mainFloor: { t: number; x: number; z: number; f: number }[] = [];
  for (const [li, ln] of lines.entries()) {
    // muestreo cada 4 m a lo largo del eje
    const S: { x: number; z: number; t: number; dx: number; dz: number }[] = [];
    let T = 0;
    for (let i = 1; i < ln.pts.length; i++) {
      const [ax, az] = ln.pts[i - 1], [bx, bz] = ln.pts[i];
      const l = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / l, dz = (bz - az) / l;
      for (let s = 0; s < l; s += 4) S.push({ x: ax + dx * s, z: az + dz * s, t: T + s, dx, dz });
      T += l;
      if (i === ln.pts.length - 1) S.push({ x: bx, z: bz, t: T, dx, dz });
    }
    const Ltot = T;
    // rasante: bajo el terreno a la profundidad del túnel, con rampas en las bocas
    const raw = S.map((p) => {
      const tg = terr(p.x, p.z);
      let d = DEPTH;
      if (ln.portalA) d = Math.min(d, (p.t / RAMP) * DEPTH);
      if (ln.portalB) d = Math.min(d, ((Ltot - p.t) / RAMP) * DEPTH);
      return tg - Math.max(0.05, d);
    });
    let f = raw.map((_, i) => { let s = 0, c = 0; for (let j = i - 3; j <= i + 3; j++) if (raw[j] !== undefined) { s += raw[j]; c++; } return s / c; });
    if (ln.joinA && mainFloor.length) {
      // el ramal arranca a la cota del túnel principal en el cruce
      const j = mainFloor.reduce((a, b) => (Math.hypot(b.x - S[0].x, b.z - S[0].z) < Math.hypot(a.x - S[0].x, a.z - S[0].z) ? b : a));
      const n = Math.min(6, f.length);
      for (let i = 0; i < n; i++) f[i] = j.f + (f[n] - j.f) * (i / n);
    }
    if (ln.portalA) f[0] = terr(S[0].x, S[0].z) + 0.05;
    if (ln.portalB) f[f.length - 1] = terr(S[S.length - 1].x, S[S.length - 1].z) + 0.05;
    f = f.map((v, i) => Math.min(v, terr(S[i].x, S[i].z) + 0.05));
    if (li === 0) S.forEach((p, i) => mainFloor.push({ t: p.t, x: p.x, z: p.z, f: f[i] }));
    const junction = li === 0 ? lines[1].pts[0] : ln.pts[0];
    const openTrench: number[] = []; // vértices x,z del tramo descubierto (para rebajar el terreno)
    const openL: V2[] = [], openR: V2[] = [];
    for (let i = 0; i < S.length - 1; i++) {
      const a = S[i], b = S[i + 1];
      const fa = f[i], fb = f[i + 1];
      const nxa = -a.dz, nza = a.dx, nxb = -b.dz, nzb = b.dx;
      const La: V2 = [a.x + nxa * W / 2, a.z + nza * W / 2], Ra: V2 = [a.x - nxa * W / 2, a.z - nza * W / 2];
      const Lb: V2 = [b.x + nxb * W / 2, b.z + nzb * W / 2], Rb: V2 = [b.x - nxb * W / 2, b.z - nzb * W / 2];
      // calzada y suelo para andar/conducir
      bag.quad([La[0], fa, La[1]], [Lb[0], fb, Lb[1]], [Rb[0], fb, Rb[1]], [Ra[0], fa, Ra[1]], asphalt);
      ground.addDeckSegment(a.x, a.z, b.x, b.z, fa, fb, W / 2, true);
      if (i % 3 === 0) bag.quad([a.x + nxa * 0.08, fa + 0.02, a.z + nza * 0.08], [a.x + nxa * 0.08 + a.dx * 2, fa + 0.02, a.z + nza * 0.08 + a.dz * 2], [a.x - nxa * 0.08 + a.dx * 2, fa + 0.02, a.z - nza * 0.08 + a.dz * 2], [a.x - nxa * 0.08, fa + 0.02, a.z - nza * 0.08], paint);
      const ta = terr(a.x, a.z), tb = terr(b.x, b.z);
      const covered = ta - fa > H + 0.6 && tb - fb > H + 0.6;
      const nearJ = Math.hypot(a.x - junction[0], a.z - junction[1]) < 10 && !(li === 0 && false);
      // muros laterales (de azulejo dentro, más altos que el terreno en las rampas a modo de pretil)
      for (const [P, Q, sgn] of [[La, Lb, 1], [Ra, Rb, -1]] as [V2, V2, number][]) {
        if (nearJ && (li === 1 || sgn < 0)) continue; // el hueco del cruce con el ramal
        const topA = covered ? fa + H : Math.max(fa + H * 0.6, ta + 1.0), topB = covered ? fb + H : Math.max(fb + H * 0.6, tb + 1.0);
        bag.quad([P[0], fa - 0.3, P[1]], [Q[0], fb - 0.3, Q[1]], [Q[0], topB, Q[1]], [P[0], topA, P[1]], covered ? tile : concrete);
        if (!covered) bag.quad([P[0] + (-a.dz) * sgn * 0.5, topA, P[1] + a.dx * sgn * 0.5], [Q[0] + (-b.dz) * sgn * 0.5, topB, Q[1] + b.dx * sgn * 0.5], [Q[0], topB, Q[1]], [P[0], topA, P[1]], concrete);
        collision.addSeg(P[0], P[1], Q[0], Q[1], Math.max(topA, topB), Math.min(fa, fb) - 0.5);
      }
      if (covered) {
        // techo con la línea de luces y, cada 60 m, señal de salida de emergencia
        bag.quad([La[0], fa + H, La[1]], [Ra[0], fa + H, Ra[1]], [Rb[0], fb + H, Rb[1]], [Lb[0], fb + H, Lb[1]], concrete);
        bag.box((a.x + b.x) / 2, (fa + fb) / 2 + H - 0.08, (a.z + b.z) / 2, 3.2, 0.1, 0.35, Math.atan2(a.dz, a.dx), glowCool);
        if (i % 15 === 0) bag.box(La[0] - nxa * 0.1, fa + 2.4, La[1] - nza * 0.1, 0.8, 0.35, 0.05, Math.atan2(a.dz, a.dx), signG);
        collision.add({ kind: 'quad', p: [La[0], La[1], Lb[0], Lb[1], Rb[0], Rb[1], Ra[0], Ra[1]], h: Math.max(fa, fb) + H + 0.4, y0: Math.min(fa, fb) + H - 0.25 });
      } else {
        openL.push(La); openR.push(Ra);
        if (i === S.length - 2) { openL.push(Lb); openR.push(Rb); }
        void openTrench;
      }
    }
    // bocas: dintel de hormigón donde empieza el techo; y el terreno rebajado en la trinchera descubierta
    if (openL.length > 1) {
      // puede haber dos tramos descubiertos (una boca a cada extremo): se separan por distancia
      const runs: V2[][][] = [];
      let cur: V2[][] = [];
      for (let i = 0; i < openL.length; i++) {
        if (i && Math.hypot(openL[i][0] - openL[i - 1][0], openL[i][1] - openL[i - 1][1]) > 6) { runs.push(cur); cur = []; }
        cur.push([openL[i], openR[i]]);
      }
      runs.push(cur);
      for (const run of runs) {
        if (run.length < 2) continue;
        const poly: number[] = [];
        for (const [l] of run) poly.push(l[0], l[1]);
        for (let i = run.length - 1; i >= 0; i--) poly.push(run[i][1][0], run[i][1][1]);
        const fl = (x: number, z: number) => {
          let best = Infinity, fv = 0;
          S.forEach((p, i) => { const d = Math.hypot(p.x - x, p.z - z); if (d < best) { best = d; fv = f[i]; } });
          return fv;
        };
        cuts.push({ pts: poly, floor: 0, floorAt: fl });
      }
    }
  }

  // ---- arriba: el paseo peatonal de Bailén hacia los Jardines de Sabatini (sobre el túnel)
  const paseo: V2[] = [[-806, -575], [-800, -540], [-801, -470], [-805, -420]];
  for (let i = 1; i < paseo.length; i++) {
    const [ax, az] = paseo[i - 1], [bx, bz] = paseo[i];
    const l = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / l, dz = (bz - az) / l, nx = -dz, nz = dx;
    for (let s = 0; s < l; s += 3) {
      const x = ax + dx * s, z = az + dz * s;
      bag.box(x, terr(x, z) + 0.05, z, 3, 0.06, 12, Math.atan2(dz, dx), paving);
    }
    for (let s = 4; s < l; s += 9) for (const o of [-7.5, 7.5]) {
      const x = ax + dx * s + nx * o, z = az + dz * s + nz * o, y0 = terr(x, z);
      // hileras de árboles con su alcorque
      bag.cyl(x, y0, y0 + 3.2, z, 0.18, bark, 6, 0.13);
      bag.add(new THREE.IcosahedronGeometry(2.1, 0).scale(1, 0.85, 1).translate(x, y0 + 4.6, z), leaf);
      bag.box(x, y0 + 0.03, z, 1.4, 0.06, 1.4, Math.atan2(dz, dx), iron);
      collision.addCircle(x, z, 0.25, y0 + 3);
    }
    for (let s = 8; s < l; s += 18) for (const o of [-5, 5]) {
      const x = ax + dx * s + nx * o, z = az + dz * s + nz * o, y0 = terr(x, z);
      const rot = Math.atan2(dz, dx);
      bag.box(x, y0 + 0.45, z, 2, 0.08, 0.5, rot, wood);
      bag.box(x - nx * Math.sign(o) * 0.25, y0 + 0.8, z - nz * Math.sign(o) * 0.25, 2, 0.5, 0.06, rot, wood);
      const lx = x + dx * 4.5, lz = z + dz * 4.5, ly = terr(lx, lz);
      bag.cyl(lx, ly, ly + 4.4, lz, 0.08, iron, 8, 0.06);
      bag.add(new THREE.SphereGeometry(0.26, 8, 6).translate(lx, ly + 4.6, lz), glow);
    }
  }

  // ---- Monumento a Cervantes (Zapatero y Anasagasti, con esculturas de Coullaut Valera)
  const mon = data.pois.find((p) => p.name === 'Monumento a Cervantes');
  if (mon) {
    const y0 = terr(mon.x, mon.z);
    const toQ = data.pois.find((p) => p.name === 'Fuente Miguel de Cervantes') ?? { x: mon.x + 6, z: mon.z - 4 };
    const rot = Math.atan2(toQ.x - mon.x, toQ.z - mon.z);
    const c = Math.cos(rot), s = Math.sin(rot);
    const P = (lx: number, lz: number): V2 => [mon.x + lx * c + lz * s, mon.z - lx * s + lz * c];
    // torre de piedra escalonada
    const [tx, tz] = P(0, -3);
    bag.box(tx, y0 + 1, tz, 9, 2, 7, -rot, stone);
    bag.box(tx, y0 + 7, tz, 6, 10, 4.5, -rot, stone);
    bag.box(tx, y0 + 14, tz, 4.5, 4, 3.5, -rot, stone);
    bag.box(tx, y0 + 17.5, tz, 3.2, 3, 2.6, -rot, stone);
    // remate: el globo terráqueo con los lectores
    bag.add(new THREE.SphereGeometry(1.5, 16, 12).translate(tx, y0 + 20.4, tz), stone);
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; bag.add(new THREE.CapsuleGeometry(0.28, 0.9, 3, 8).translate(tx + Math.cos(a) * 1.7, y0 + 19.6, tz + Math.sin(a) * 1.7), stone); }
    // Cervantes sentado delante de la torre
    const [sx, sz] = P(0, 0.2);
    bag.box(sx, y0 + 2.9, sz, 1.8, 1.8, 1.6, -rot, stone);
    bag.add(new THREE.CapsuleGeometry(0.45, 1.1, 4, 10).translate(sx, y0 + 4.5, sz), stone);
    bag.add(new THREE.SphereGeometry(0.33, 10, 8).translate(sx, y0 + 5.65, sz), stone);
    collision.addCircle(tx, tz, 4.5, y0 + 18);
    // don Quijote a caballo y Sancho en su rucio, en bronce, delante
    const [qx, qz] = P(-1.6, 6), [sx2, sz2] = P(1.8, 6.4);
    equestrian(bag, qx, y0 + 0.6, qz, rot, 1.05, bronze, null, { lance: true, thin: true });
    equestrian(bag, sx2, y0 + 0.6, sz2, rot, 1.0, bronze, null, { donkey: true });
    const [px, pz] = P(0, 6.2);
    bag.box(px, y0 + 0.3, pz, 6, 0.6, 3.5, -rot, stone);
    collision.addCircle(px, pz, 3.2, y0 + 2.5);
  }
  const group = bag.build();
  return { group, cuts };
}
