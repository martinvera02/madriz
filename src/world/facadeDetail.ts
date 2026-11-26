import * as THREE from 'three';
import type { FacadeRun } from './buildings';
import { makeRng } from '../config';
import { inRing } from './spatial';
import { buildShopfronts } from './shopfronts';

/*
 * Detalle en relieve de las fachadas genéricas, solo cerca del jugador (LOD):
 * balcones volados con barandilla de forja, alféizares y dinteles de las ventanas.
 * Reproduce la misma rejilla que dibuja el shader de fachada, para que el relieve
 * caiga exactamente sobre las ventanas pintadas.
 */

const CELL_W = 3.0, CELL_H = 3.3, GROUND_H = 4.2;
const BUCKET = 100;
const NEAR = 190, FAR = 270;

/** Mismo hash que el shader (buildingMaterial.ts). */
function hash21(x: number, y: number) {
  x = (Math.floor(x + 0.5) % 289 + 289) % 289;
  y = (Math.floor(y + 0.5) % 289 + 289) % 289;
  let px = (x * 0.1031) % 1, py = (y * 0.103) % 1;
  const d = px * (py + 33.33) + py * (px + 33.33);
  px += d; py += d;
  return ((px + py) * px) % 1;
}

function railTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 32);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 64, 3); // pasamanos
  g.fillRect(0, 28, 64, 4);
  for (let x = 2; x < 64; x += 6) g.fillRect(x, 0, 2, 32); // barrotes
  g.fillRect(0, 14, 64, 1.5);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export class FacadeDetail {
  readonly group = new THREE.Group();
  private buckets = new Map<string, FacadeRun[]>();
  private built = new Map<string, THREE.Object3D[]>();
  private slabGeo = new THREE.BoxGeometry(1.55, 0.13, 0.6);
  private railGeo: THREE.BufferGeometry;
  private sillGeo = new THREE.BoxGeometry(1.35, 0.1, 0.22);
  private lintelGeo = new THREE.BoxGeometry(1.4, 0.28, 0.12);
  private slabMat = new THREE.MeshStandardMaterial({ color: 0xd9d2c4, roughness: 0.8 });
  private railMat: THREE.MeshStandardMaterial;
  private sillMat = new THREE.MeshStandardMaterial({ color: 0xe6e0d4, roughness: 0.8 });

  constructor(facades: FacadeRun[]) {
    for (const f of facades) {
      const key = `${Math.floor((f.ax + f.bx) / 2 / BUCKET)},${Math.floor((f.az + f.bz) / 2 / BUCKET)}`;
      let arr = this.buckets.get(key);
      if (!arr) this.buckets.set(key, (arr = []));
      arr.push(f);
    }
    // Barandilla: frente + dos costados, como planos con textura recortada (alphaTest)
    const front = new THREE.PlaneGeometry(1.5, 1.0).translate(0, 0.5, 0.58);
    const left = new THREE.PlaneGeometry(0.58, 1.0).rotateY(Math.PI / 2).translate(-0.75, 0.5, 0.29);
    const right = new THREE.PlaneGeometry(0.58, 1.0).rotateY(Math.PI / 2).translate(0.75, 0.5, 0.29);
    const uvs = [front, left, right];
    uvs.forEach((g, i) => {
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * (i === 0 ? 3 : 1.2));
    });
    this.railGeo = mergeSimple(uvs);
    this.railMat = new THREE.MeshStandardMaterial({
      color: 0x1b1c1f, roughness: 0.5, metalness: 0.5, alphaMap: railTexture(), alphaTest: 0.5, transparent: false, side: THREE.DoubleSide,
    });
  }

  update(x: number, z: number) {
    const ci = Math.floor(x / BUCKET), cj = Math.floor(z / BUCKET);
    const R = Math.ceil(NEAR / BUCKET);
    for (let i = ci - R; i <= ci + R; i++) for (let j = cj - R; j <= cj + R; j++) {
      const key = `${i},${j}`;
      if (this.built.has(key) || !this.buckets.has(key)) continue;
      const cxm = (i + 0.5) * BUCKET, czm = (j + 0.5) * BUCKET;
      if (Math.hypot(cxm - x, czm - z) > NEAR + BUCKET * 0.7) continue;
      this.built.set(key, this.buildBucket(this.buckets.get(key)!));
      return; // como mucho un trozo por llamada: sin tirones
    }
    for (const [key, objs] of this.built) {
      const [i, j] = key.split(',').map(Number);
      if (Math.hypot((i + 0.5) * BUCKET - x, (j + 0.5) * BUCKET - z) < FAR + BUCKET * 0.7) continue;
      for (const o of objs) { this.group.remove(o); if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); else (o as THREE.Mesh).geometry.dispose(); }
      this.built.delete(key);
    }
  }

  private buildBucket(list: FacadeRun[]): THREE.Object3D[] {
    const slabs: THREE.Matrix4[] = [], sills: THREE.Matrix4[] = [], lintels: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    for (const f of list) {
      if (f.noBalconies) continue;
      const dx = (f.bx - f.ax) / f.len, dz = (f.bz - f.az) / f.len;
      // eje Z local del balcón = normal de la fachada
      q.setFromAxisAngle(up, Math.atan2(f.nx, f.nz));
      const h = f.top - f.ground;
      const floors = Math.floor((h - GROUND_H - 1.4) / CELL_H);
      // ventanas: centros de celda en coordenadas de textura (u acumulado del anillo)
      const k0 = Math.ceil((f.u0 + 0.9 - CELL_W / 2) / CELL_W), k1 = Math.floor((f.u0 + f.len - 0.9 - CELL_W / 2) / CELL_W);
      for (let fl = 0; fl < floors; fl++) {
        const yFloor = f.ground + GROUND_H + fl * CELL_H;
        const hasBalcony = hash21(f.seed, fl + 7) >= 0.25;
        for (let k = k0; k <= k1; k++) {
          const along = k * CELL_W + CELL_W / 2 - f.u0;
          const x = f.ax + dx * along, z = f.az + dz * along;
          if (hasBalcony) {
            m.compose(new THREE.Vector3(x + f.nx * 0.28, yFloor + 0.13, z + f.nz * 0.28), q, one);
            slabs.push(m.clone());
          } else {
            m.compose(new THREE.Vector3(x + f.nx * 0.1, yFloor + 0.2, z + f.nz * 0.1), q, one);
            sills.push(m.clone());
          }
          m.compose(new THREE.Vector3(x + f.nx * 0.05, yFloor + CELL_H * 0.82, z + f.nz * 0.05), q, one);
          lintels.push(m.clone());
        }
      }
    }
    const out: THREE.Object3D[] = [];
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], shadow: boolean, off?: THREE.Vector3) => {
      if (!mats.length) return;
      const im = new THREE.InstancedMesh(geo, mat, mats.length);
      const t = off ? new THREE.Matrix4().makeTranslation(off.x, off.y, off.z) : null;
      mats.forEach((mm, i) => im.setMatrixAt(i, t ? mm.clone().multiply(t) : mm));
      im.castShadow = shadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
      out.push(im);
    };
    inst(this.slabGeo, this.slabMat, slabs, true);
    inst(this.railGeo, this.railMat, slabs, false, new THREE.Vector3(0, 0.06, -0.28));
    inst(this.sillGeo, this.sillMat, sills, false);
    inst(this.lintelGeo, this.sillMat, lintels, false);
    for (const o of buildShopfronts(list)) { this.group.add(o); out.push(o); }
    return out;
  }
}

/** Remates de azotea: chimeneas, máquinas de aire acondicionado, depósitos y antenas. */
export function buildRoofProps(spots: { x: number; z: number; y: number; tile: boolean; area: number; seed: number; pts: number[] }[]): THREE.Group {
  const rng = makeRng(4242);
  const g = new THREE.Group();
  type T = { geo: THREE.BufferGeometry; mat: THREE.Material; list: THREE.Matrix4[] };
  const types: Record<string, T> = {
    chimney: { geo: new THREE.BoxGeometry(0.6, 1.5, 0.6).translate(0, 0.75, 0), mat: new THREE.MeshStandardMaterial({ color: 0x9a5a45, roughness: 0.9 }), list: [] },
    cap: { geo: new THREE.BoxGeometry(0.8, 0.12, 0.8).translate(0, 1.55, 0), mat: new THREE.MeshStandardMaterial({ color: 0x6f6a64 }), list: [] },
    ac: { geo: new THREE.BoxGeometry(1.0, 0.8, 0.6).translate(0, 0.4, 0), mat: new THREE.MeshStandardMaterial({ color: 0xc9c9c4, roughness: 0.6, metalness: 0.3 }), list: [] },
    tank: { geo: new THREE.CylinderGeometry(0.7, 0.7, 1.6, 10).translate(0, 0.8, 0), mat: new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.7 }), list: [] },
    antenna: { geo: new THREE.CylinderGeometry(0.03, 0.04, 3.2, 4).translate(0, 1.6, 0), mat: new THREE.MeshStandardMaterial({ color: 0x555a60, metalness: 0.7 }), list: [] },
    rail: { geo: new THREE.BoxGeometry(2.2, 0.05, 0.05).translate(0, 1.05, 0), mat: new THREE.MeshStandardMaterial({ color: 0x555a60, metalness: 0.7 }), list: [] },
  };
  const m = new THREE.Matrix4();
  for (const s of spots) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < s.pts.length; i += 2) {
      x0 = Math.min(x0, s.pts[i]); x1 = Math.max(x1, s.pts[i]); z0 = Math.min(z0, s.pts[i + 1]); z1 = Math.max(z1, s.pts[i + 1]);
    }
    const count = Math.min(8, 1 + Math.floor(s.area / 120));
    for (let k = 0; k < count; k++) {
      let x = 0, z = 0, ok = false;
      for (let t = 0; t < 6 && !ok; t++) {
        x = x0 + 1.2 + rng() * (x1 - x0 - 2.4); z = z0 + 1.2 + rng() * (z1 - z0 - 2.4);
        ok = inRing(x, z, s.pts) && inRing(x + 0.8, z, s.pts) && inRing(x - 0.8, z, s.pts) && inRing(x, z + 0.8, s.pts) && inRing(x, z - 0.8, s.pts);
      }
      if (!ok) continue;
      m.makeRotationY(rng() * Math.PI).setPosition(x, s.y, z);
      const r = rng();
      if (s.tile || r < 0.35) { types.chimney.list.push(m.clone()); types.cap.list.push(m.clone()); }
      else if (r < 0.75) types.ac.list.push(m.clone());
      else if (r < 0.9) types.tank.list.push(m.clone());
      else types.antenna.list.push(m.clone());
    }
  }
  for (const t of Object.values(types)) {
    if (!t.list.length) continue;
    const im = new THREE.InstancedMesh(t.geo, t.mat, t.list.length);
    t.list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.castShadow = true;
    im.computeBoundingSphere();
    g.add(im);
  }
  return g;
}

function mergeSimple(geos: THREE.BufferGeometry[]) {
  const nonIdx = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const size = nonIdx[0].attributes[name].itemSize;
    let total = 0;
    for (const g of nonIdx) total += g.attributes[name].count;
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const g of nonIdx) { arr.set(g.attributes[name].array as Float32Array, off); off += g.attributes[name].count * size; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}
