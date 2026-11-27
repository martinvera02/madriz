import * as THREE from 'three';
import type { WorldData } from './realData';
import { Ground } from './roads';
import { CollisionWorld } from './collision';
import { pointInRing } from './buildings';
import { makeRng } from '../config';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FootprintIndex } from './spatial';

export interface Props {
  group: THREE.Group;
  streetLightMat: THREE.MeshStandardMaterial;
  lightPoolMat: THREE.MeshBasicMaterial;
}

/**
 * InstancedMesh troceado por celdas de 300 m: así el recorte por frustum descarta lo que no se ve
 * (una sola InstancedMesh para toda la ciudad se dibujaría siempre entera).
 */
class ChunkedInstances {
  private cells = new Map<string, { m: THREE.Matrix4[]; c: THREE.Color[] }>();
  constructor(private geo: THREE.BufferGeometry, private mat: THREE.Material, private cast = true) {}
  add(m: THREE.Matrix4, c?: THREE.Color) {
    const key = `${Math.floor(m.elements[12] / 450)},${Math.floor(m.elements[14] / 450)}`;
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, (cell = { m: [], c: [] }));
    cell.m.push(m.clone());
    if (c) cell.c.push(c.clone());
  }
  build(group: THREE.Group) {
    for (const cell of this.cells.values()) {
      const im = new THREE.InstancedMesh(this.geo, this.mat, cell.m.length);
      cell.m.forEach((mm, i) => im.setMatrixAt(i, mm));
      cell.c.forEach((cc, i) => im.setColorAt(i, cc));
      im.castShadow = this.cast;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
    }
  }
}

/** Árboles (los de OSM + relleno de parques), farolas (las de OSM + a lo largo de las calles). */
export function buildProps(data: WorldData, ground: Ground, collision: CollisionWorld): Props {
  const group = new THREE.Group();
  const rng = makeRng(1883); // año de la primera farola eléctrica en Madrid (más o menos)
  const t = ground.terrain;
  const m = new THREE.Matrix4();
  const col = new THREE.Color();

  // ---------- Árboles
  type Tree = { x: number; z: number; s: number; kind: number; street?: number };
  const trees: Tree[] = [];
  for (let i = 0; i < data.trees.length; i += 2) {
    // OSM: la mayoría son árboles de alineación (plátanos, olmos, acacias); kind según leaf_type/genus
    trees.push({ x: data.trees[i], z: data.trees[i + 1], s: 0.85 + rng() * 0.45, kind: data.treeKind?.[i / 2] ?? 0, street: 1 });
  }
  const N = data.roadNodes;
  // Para no plantar árboles encima de caminos: rejilla de ocupación de 4 m con las vías peatonales
  const blocked = new Set<string>();
  for (const r of data.roads) {
    for (let k = 1; k < r.n.length; k++) {
      const ax = N[r.n[k - 1] * 2], az = N[r.n[k - 1] * 2 + 1], bx = N[r.n[k] * 2], bz = N[r.n[k] * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s <= len; s += 2) {
        const x = ax + ((bx - ax) * s) / (len || 1), z = az + ((bz - az) * s) / (len || 1);
        const rad = Math.ceil((r.w / 2 + 1.5) / 4);
        for (let di = -rad; di <= rad; di++) for (let dj = -rad; dj <= rad; dj++) blocked.add(`${Math.floor(x / 4) + di},${Math.floor(z / 4) + dj}`);
      }
    }
  }
  for (const a of data.areas) {
    if (a.kind !== 'grass' && a.kind !== 'wood') continue;
    let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity, area = 0;
    for (let i = 0; i < a.pts.length; i += 2) {
      xmin = Math.min(xmin, a.pts[i]); xmax = Math.max(xmax, a.pts[i]);
      zmin = Math.min(zmin, a.pts[i + 1]); zmax = Math.max(zmax, a.pts[i + 1]);
      const j = (i + 2) % a.pts.length;
      area += a.pts[i] * a.pts[j + 1] - a.pts[j] * a.pts[i + 1];
    }
    area = Math.abs(area / 2);
    if (area < 300) continue;
    const density = a.kind === 'wood' ? 1 / 90 : a.name?.includes('Retiro') ? 1 / 110 : 1 / 260;
    const count = Math.min(9000, Math.floor(area * density));
    for (let k = 0; k < count; k++) {
      const x = xmin + rng() * (xmax - xmin), z = zmin + rng() * (zmax - zmin);
      if (!pointInRing(x, z, a.pts)) continue;
      if ((a.holes ?? []).some((h) => pointInRing(x, z, h))) continue;
      if (blocked.has(`${Math.floor(x / 4)},${Math.floor(z / 4)}`)) continue;
      trees.push({ x, z, s: 0.8 + rng() * 0.7, kind: rng() < 0.3 ? 1 : 0 });
    }
  }

  // Índice de calzadas para no poner árboles ni farolas encima
  const carSegs = new Map<string, number[][]>();
  for (const r of data.roads) {
    if (!r.car) continue;
    for (let k = 1; k < r.n.length; k++) {
      const seg = [N[r.n[k - 1] * 2], N[r.n[k - 1] * 2 + 1], N[r.n[k] * 2], N[r.n[k] * 2 + 1], r.w / 2 + 0.3];
      const x0 = Math.floor(Math.min(seg[0], seg[2]) / 30), x1 = Math.floor(Math.max(seg[0], seg[2]) / 30);
      const z0 = Math.floor(Math.min(seg[1], seg[3]) / 30), z1 = Math.floor(Math.max(seg[1], seg[3]) / 30);
      for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
        const key = i + ',' + j;
        let arr = carSegs.get(key);
        if (!arr) carSegs.set(key, (arr = []));
        arr.push(seg);
      }
    }
  }
  const onCarway = (x: number, z: number) => {
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const [ax, az, bx, bz, hw] of carSegs.get(`${Math.floor(x / 30) + di},${Math.floor(z / 30) + dj}`) ?? []) {
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-6;
        const t2 = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        if ((x - ax - dx * t2) ** 2 + (z - az - dz * t2) ** 2 < hw * hw) return true;
      }
    }
    return false;
  };
  for (let k = trees.length - 1; k >= 0; k--) if (onCarway(trees[k].x, trees[k].z)) trees.splice(k, 1);
  // ni árboles dentro de estanques, fuentes o del Manzanares
  const waters = data.areas.filter((a) => a.kind === 'water').map((a) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < a.pts.length; i += 2) { x0 = Math.min(x0, a.pts[i]); x1 = Math.max(x1, a.pts[i]); z0 = Math.min(z0, a.pts[i + 1]); z1 = Math.max(z1, a.pts[i + 1]); }
    return { a, x0: x0 - 2, x1: x1 + 2, z0: z0 - 2, z1: z1 + 2 };
  });
  const inWater = (x: number, z: number) => waters.some((w) => x > w.x0 && x < w.x1 && z > w.z0 && z < w.z1 &&
    pointInRing(x, z, w.a.pts) && !(w.a.holes ?? []).some((h) => pointInRing(x, z, h)));
  for (let k = trees.length - 1; k >= 0; k--) if (inWater(trees[k].x, trees[k].z)) trees.splice(k, 1);

  // ---------- Geometrías con volumen: copas de varias masas, coníferas por pisos, palmeras
  const jitter = (g: THREE.BufferGeometry, amp: number, seed: number) => {
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
      const n = Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 + seed * 1.3) * Math.sin(y * 2.3 + seed * 0.7);
      pos.setXYZ(k, x * (1 + n * amp), y * (1 + n * amp * 0.6), z * (1 + n * amp));
    }
    g.computeVertexNormals();
    return g;
  };
  const crownVariant = (seed: number) => {
    const r2 = makeRng(seed);
    const blobs: THREE.BufferGeometry[] = [];
    const n = 5 + Math.floor(r2() * 3);
    for (let k = 0; k < n; k++) {
      const a = r2() * Math.PI * 2, d = k === 0 ? 0 : 1.1 + r2() * 0.9;
      const rad = k === 0 ? 2.3 : 1.3 + r2() * 0.7;
      const g = jitter(new THREE.IcosahedronGeometry(rad, k === 0 ? 1 : 0), 0.18, seed + k);
      g.translate(Math.cos(a) * d, 5.0 + (k === 0 ? 0.4 : (r2() - 0.3) * 1.6), Math.sin(a) * d);
      blobs.push(g.index ? g.toNonIndexed() : g);
    }
    return mergeGeometries(blobs, false)!;
  };
  const conifer = () => {
    const parts = [0, 1, 2, 3].map((k) => new THREE.ConeGeometry(2.3 - k * 0.45, 2.6, 8).translate(0, 3.6 + k * 1.5, 0).toNonIndexed());
    return jitter(mergeGeometries(parts, false)!, 0.08, 3);
  };
  const palmFronds = () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 9; k++) {
      const f = new THREE.ConeGeometry(0.35, 3.2, 4).rotateZ(Math.PI / 2 + 0.5).translate(1.5, 7.3, 0).rotateY((k / 9) * Math.PI * 2);
      parts.push(f.toNonIndexed());
    }
    return mergeGeometries(parts, false)!;
  };

  // Viento: balanceo suave de las copas (uniform compartido, lo actualiza main.ts)
  const windUniform = { value: 0 };
  const swayMat = (color: number) => {
    const mt = new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true });
    mt.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = windUniform;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 ip = vec3(0.0);
          #endif
          float sway = sin(uWind * 1.3 + ip.x * 0.11 + ip.z * 0.07) * 0.05 + sin(uWind * 2.9 + ip.z * 0.3) * 0.02;
          transformed.x += sway * max(0.0, transformed.y - 3.0);
          transformed.z += sway * 0.6 * max(0.0, transformed.y - 3.0);`);
    };
    return mt;
  };
  (group.userData as { wind?: { value: number } }).wind = windUniform;

  const trunkGeo = jitter(new THREE.CylinderGeometry(0.17, 0.3, 4.2, 6, 2, true).translate(0, 2.1, 0), 0.06, 9);
  // ramas principales
  const branchGeo = mergeGeometries([0, 1, 2].map((k) =>
    new THREE.CylinderGeometry(0.06, 0.12, 2.2, 4, 1, true).rotateZ(0.7).translate(0.7, 4.3, 0).rotateY((k / 3) * Math.PI * 2 + 0.4).toNonIndexed()), false)!;
  const palmTrunk = new THREE.CylinderGeometry(0.18, 0.28, 7.2, 8, 6).translate(0, 3.6, 0);
  const crownGeos = [crownVariant(11), crownVariant(23), crownVariant(37)];
  const pineGeo = conifer();
  const frondGeo = palmFronds();

  const barkMat = new THREE.MeshStandardMaterial({ color: 0x6a5644, roughness: 1 });
  const leafMat = swayMat(0xffffff);
  const pineMat = swayMat(0xffffff);
  const groups: Tree[][] = [[], [], []];
  const pines = trees.filter((tr) => tr.kind === 1), palms = trees.filter((tr) => tr.kind === 2);
  trees.filter((tr) => tr.kind === 0).forEach((tr, k) => groups[k % 3].push(tr));
  const nonPalm = trees.filter((tr) => tr.kind !== 2);
  const trunks = new ChunkedInstances(trunkGeo, barkMat);
  const branches = new ChunkedInstances(branchGeo, barkMat, false);
  const sc = new THREE.Vector3();
  nonPalm.forEach((tr) => {
    const y = t.heightAt(tr.x, tr.z);
    m.makeRotationY(rng() * 6.28).scale(sc.set(tr.s, tr.s, tr.s)).setPosition(tr.x, y, tr.z);
    trunks.add(m);
    if (tr.kind === 0) branches.add(m);
    collision.addCircle(tr.x, tr.z, 0.3 * tr.s, y + 5);
  });
  // Plátano de sombra, olmo, castaño de indias, acacia: verdes variados
  const greens = [0x5b8a3a, 0x4f7d34, 0x6d9545, 0x648c3c, 0x7a9a4a, 0x557a35, 0x83a04f];
  const all: ChunkedInstances[] = [trunks, branches];
  groups.forEach((list, gi) => {
    const ci = new ChunkedInstances(crownGeos[gi], leafMat);
    list.forEach((tr) => {
      const y = t.heightAt(tr.x, tr.z);
      const sv = tr.street ? 1.15 : 1;
      m.makeRotationY(rng() * 6.28).scale(sc.set(tr.s * sv, tr.s * (0.85 + rng() * 0.35) * sv, tr.s * sv)).setPosition(tr.x, y, tr.z);
      ci.add(m, col.setHex(greens[Math.floor(rng() * greens.length)]).offsetHSL(0, 0, (rng() - 0.5) * 0.05));
    });
    all.push(ci);
  });
  const pineMesh = new ChunkedInstances(pineGeo, pineMat);
  pines.forEach((tr) => {
    const y = t.heightAt(tr.x, tr.z);
    m.makeRotationY(rng() * 6.28).scale(sc.set(tr.s, tr.s * (1.1 + rng() * 0.4), tr.s)).setPosition(tr.x, y, tr.z);
    pineMesh.add(m, col.setHex(rng() < 0.5 ? 0x3e5f30 : 0x34522a));
  });
  all.push(pineMesh);
  const palmT = new ChunkedInstances(palmTrunk, new THREE.MeshStandardMaterial({ color: 0x7d6a52, roughness: 1 }));
  const palmF = new ChunkedInstances(frondGeo, leafMat);
  palms.forEach((tr) => {
    const y = t.heightAt(tr.x, tr.z);
    m.makeRotationY(rng() * 6.28).scale(sc.set(tr.s, tr.s, tr.s)).setPosition(tr.x, y, tr.z);
    palmT.add(m); palmF.add(m, col.setHex(0x5e8a3c));
    collision.addCircle(tr.x, tr.z, 0.3, y + 6);
  });
  all.push(palmT, palmF);
  for (const ci of all) ci.build(group);

  // ---------- Alcorques de los árboles de calle (los que no están en zonas verdes)
  const greenIdx = new FootprintIndex();
  data.areas.forEach((a, i) => { if (a.kind === 'grass' || a.kind === 'wood' || a.kind === 'pitch') greenIdx.add(a.pts, 1, i); });
  const pits = trees.filter((tr) => tr.street && greenIdx.topAt(tr.x, tr.z) === -Infinity);
  if (pits.length) {
    const pitGeo = new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2);
    const pitMesh = new THREE.InstancedMesh(pitGeo, new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3 }), pits.length);
    const frameGeo = new THREE.BoxGeometry(1.45, 0.08, 1.45);
    const frames = new THREE.InstancedMesh(frameGeo, new THREE.MeshStandardMaterial({ color: 0xb9b2a5, roughness: 0.9 }), pits.length);
    pits.forEach((tr, k) => {
      const y = t.heightAt(tr.x, tr.z);
      m.makeTranslation(tr.x, y + 0.06, tr.z);
      pitMesh.setMatrixAt(k, m);
      m.makeTranslation(tr.x, y + 0.0, tr.z);
      frames.setMatrixAt(k, m);
    });
    pitMesh.receiveShadow = frames.receiveShadow = true;
    pitMesh.computeBoundingSphere(); frames.computeBoundingSphere();
    group.add(frames, pitMesh);
  }

  // ---------- Arbustos y macizos en las zonas verdes
  const bushes: { x: number; z: number; s: number }[] = [];
  for (const a of data.areas) {
    if (a.kind !== 'grass') continue;
    let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity, area = 0;
    for (let i = 0; i < a.pts.length; i += 2) {
      xmin = Math.min(xmin, a.pts[i]); xmax = Math.max(xmax, a.pts[i]);
      zmin = Math.min(zmin, a.pts[i + 1]); zmax = Math.max(zmax, a.pts[i + 1]);
      const j = (i + 2) % a.pts.length;
      area += a.pts[i] * a.pts[j + 1] - a.pts[j] * a.pts[i + 1];
    }
    area = Math.abs(area / 2);
    const count = Math.min(4000, Math.floor(area / 140));
    for (let k = 0; k < count; k++) {
      const x = xmin + rng() * (xmax - xmin), z = zmin + rng() * (zmax - zmin);
      if (!pointInRing(x, z, a.pts) || blocked.has(`${Math.floor(x / 4)},${Math.floor(z / 4)}`)) continue;
      // en grupos de 2-4
      const n = 1 + Math.floor(rng() * 3);
      for (let q = 0; q < n; q++) bushes.push({ x: x + (rng() - 0.5) * 2.5, z: z + (rng() - 0.5) * 2.5, s: 0.5 + rng() * 0.6 });
    }
  }
  // tampoco arbustos dentro del agua
  for (let k = bushes.length - 1; k >= 0; k--) if (inWater(bushes[k].x, bushes[k].z)) bushes.splice(k, 1);
  if (bushes.length) {
    const bushGeo = jitter(new THREE.IcosahedronGeometry(1, 0), 0.25, 5).scale(1.1, 0.75, 1.1).translate(0, 0.45, 0);
    const bm = new ChunkedInstances(bushGeo, swayMat(0xffffff));
    const bushGreens = [0x4a7a32, 0x3f6b2e, 0x5a8a3a, 0x6b8f3f];
    bushes.forEach((b) => {
      const y = t.heightAt(b.x, b.z);
      m.makeRotationY(rng() * 6.28).scale(sc.set(b.s, b.s, b.s)).setPosition(b.x, y, b.z);
      bm.add(m, col.setHex(bushGreens[Math.floor(rng() * bushGreens.length)]));
    });
    bm.build(group);
  }

  // ---------- Farolas: las de OSM + una cada ~28 m a ambos lados de las calles con coches
  const lamps: { x: number; z: number; rot: number }[] = [];
  for (let i = 0; i < data.lamps.length; i += 2) lamps.push({ x: data.lamps[i], z: data.lamps[i + 1], rot: rng() * 6.28 });
  for (const r of data.roads) {
    if (!r.car || r.hw === 'service' || r.br) continue;
    let carry = rng() * 28;
    for (let k = 1; k < r.n.length; k++) {
      const ax = N[r.n[k - 1] * 2], az = N[r.n[k - 1] * 2 + 1], bx = N[r.n[k] * 2], bz = N[r.n[k] * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      for (let s = carry; s < len; s += 28) {
        for (const side of [-1, 1]) {
          const off = r.w / 2 + 0.6;
          const x = ax + dx * s - dz * off * side, z = az + dz * s + dx * off * side;
          lamps.push({ x, z, rot: Math.atan2(dz * side, -dx * side) });
        }
      }
      carry = (carry - len) % 28;
      if (carry < 0) carry += 28;
    }
  }
  const osmLamps = data.lamps.length / 2;
  for (let k = lamps.length - 1; k >= osmLamps; k--) if (onCarway(lamps[k].x, lamps[k].z)) lamps.splice(k, 1);

  // Farola fernandina simplificada: fuste oscuro + farol
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.13, 4.6, 6).translate(0, 2.3, 0);
  const armGeo = new THREE.BoxGeometry(0.06, 0.06, 0.9).translate(0, 4.4, 0.45);
  const headGeo = new THREE.CylinderGeometry(0.28, 0.12, 0.6, 6).translate(0, 4.15, 0.9);
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1f2326, roughness: 0.5, metalness: 0.5 });
  const streetLightMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, emissive: 0xffc27a, emissiveIntensity: 0 });
  // fuste + brazo en una sola geometría
  const poleArm = mergeGeometries([poleGeo.toNonIndexed(), armGeo.toNonIndexed()], false)!;
  const poles = new ChunkedInstances(poleArm, darkMetal);
  const heads = new ChunkedInstances(headGeo, streetLightMat, false);

  const poolTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,200,130,1)');
    grad.addColorStop(0.45, 'rgba(255,170,90,0.35)');
    grad.addColorStop(1, 'rgba(255,150,80,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const lightPoolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const pools = new ChunkedInstances(new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2), lightPoolMat, false);
  lamps.forEach((l) => {
    // Con la altura del terreno como referencia: las farolas de la calle de abajo no suben al tablero de un puente
    const y = ground.heightAt(l.x, l.z, t.heightAt(l.x, l.z) + 0.5);
    m.makeRotationY(l.rot).setPosition(l.x, y, l.z);
    poles.add(m);
    heads.add(m);
    const px = l.x + Math.sin(l.rot) * 1.2, pz = l.z + Math.cos(l.rot) * 1.2;
    m.makeTranslation(px, ground.heightAt(px, pz, y + 0.5) + 0.25, pz);
    pools.add(m);
    collision.addCircle(l.x, l.z, 0.15, y + 4.6);
  });
  poles.build(group);
  heads.build(group);
  const before = group.children.length;
  pools.build(group);
  for (let i = before; i < group.children.length; i++) group.children[i].renderOrder = 2;

  return { group, streetLightMat, lightPoolMat };
}
