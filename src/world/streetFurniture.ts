import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WorldData } from './realData';
import type { SpecialStructure } from './buildings';
import { Ground } from './roads';
import { CollisionWorld } from './collision';
import { CarwayIndex, obb } from './spatial';

/*
 * Mobiliario urbano a partir de los nodos reales de OSM (bancos, papeleras, bolardos, paradas de
 * autobús, bocas de metro, fuentes de beber, buzones, BiciMAD…), setos, y las construcciones
 * pequeñas que no son edificios: quioscos, marquesinas y la "ballena" de Cercanías de Sol.
 */

type Part = { geo: THREE.BufferGeometry; mat: string };

const M: Record<string, THREE.Material> = {
  iron: new THREE.MeshStandardMaterial({ color: 0x24282b, roughness: 0.5, metalness: 0.6 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x7a5434, roughness: 0.85 }),
  binGreen: new THREE.MeshStandardMaterial({ color: 0x3d4a3f, roughness: 0.6, metalness: 0.2 }),
  binYellow: new THREE.MeshStandardMaterial({ color: 0xd8b021, roughness: 0.6 }),
  bollard: new THREE.MeshStandardMaterial({ color: 0x2c2d30, roughness: 0.5, metalness: 0.4 }),
  glass: new THREE.MeshStandardMaterial({ color: 0xcfe3ea, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }),
  emtRed: new THREE.MeshStandardMaterial({ color: 0xc4161c, roughness: 0.5 }),
  metroRed: new THREE.MeshStandardMaterial({ color: 0xd52b1e, roughness: 0.4, emissive: 0x5a0a05, emissiveIntensity: 0.4 }),
  metroBlue: new THREE.MeshStandardMaterial({ color: 0x1f3c8f, roughness: 0.4 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({ color: 0xbdb5a6, roughness: 0.85 }),
  kiosk: new THREE.MeshStandardMaterial({ color: 0x2f5a3c, roughness: 0.55, metalness: 0.3 }), // verde quiosco madrileño
  kioskRoof: new THREE.MeshStandardMaterial({ color: 0x23442d, roughness: 0.5, metalness: 0.3 }),
  white: new THREE.MeshStandardMaterial({ color: 0xece9e2, roughness: 0.6 }),
  correos: new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5 }),
  bici: new THREE.MeshStandardMaterial({ color: 0xd3d6d8, roughness: 0.4, metalness: 0.5 }),
  hedge: new THREE.MeshStandardMaterial({ color: 0x3f6b2e, roughness: 1, flatShading: true }),
  steel: new THREE.MeshStandardMaterial({ color: 0x9aa1a6, roughness: 0.35, metalness: 0.7 }),
  awning: new THREE.MeshStandardMaterial({ color: 0x1f3d29, roughness: 0.6 }),
  press: new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.7, emissive: 0x332a10, emissiveIntensity: 0.2 }),
};

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const cyl = (rt: number, rb: number, h: number, x: number, y: number, z: number, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y + h / 2, z);

/** Modelos (local: X a lo largo, Z hacia la calzada, Y arriba). */
const MODELS: Record<string, Part[]> = {
  // Banco madrileño: tablas de madera sobre patas de fundición
  b: [
    { geo: box(1.8, 0.06, 0.45, 0, 0.42, 0), mat: 'wood' },
    { geo: box(1.8, 0.4, 0.05, 0, 0.5, -0.24).rotateX(-0.15), mat: 'wood' },
    { geo: box(0.08, 0.45, 0.5, -0.75, 0, 0), mat: 'iron' },
    { geo: box(0.08, 0.45, 0.5, 0.75, 0, 0), mat: 'iron' },
    { geo: box(0.08, 0.5, 0.06, -0.75, 0.45, -0.24), mat: 'iron' },
    { geo: box(0.08, 0.5, 0.06, 0.75, 0.45, -0.24), mat: 'iron' },
  ],
  // Papelera: cubeta sobre poste
  p: [
    { geo: cyl(0.04, 0.04, 1.0, 0, 0, -0.15, 6), mat: 'iron' },
    { geo: cyl(0.24, 0.2, 0.55, 0, 0.35, 0, 12), mat: 'binGreen' },
    { geo: cyl(0.25, 0.25, 0.04, 0, 0.9, 0, 12), mat: 'binYellow' },
  ],
  // Bolardo madrileño (fundición con remate redondeado)
  o: [
    { geo: cyl(0.09, 0.11, 0.85, 0, 0, 0, 10), mat: 'bollard' },
    { geo: new THREE.SphereGeometry(0.1, 10, 6).translate(0, 0.86, 0), mat: 'bollard' },
    { geo: cyl(0.115, 0.115, 0.06, 0, 0.62, 0, 10), mat: 'bollard' },
  ],
  // Marquesina de la EMT
  s: [
    { geo: box(4.2, 0.12, 1.6, 0, 2.45, -0.1), mat: 'iron' },
    { geo: box(4.0, 1.9, 0.03, 0, 0.45, -0.85), mat: 'glass' },
    { geo: box(0.03, 1.9, 1.3, -2.0, 0.45, -0.25), mat: 'glass' },
    { geo: box(0.08, 2.45, 0.08, -2.0, 0, -0.85), mat: 'iron' },
    { geo: box(0.08, 2.45, 0.08, 2.0, 0, -0.85), mat: 'iron' },
    { geo: box(0.08, 2.45, 0.08, -2.0, 0, 0.55), mat: 'iron' },
    { geo: box(0.08, 2.45, 0.08, 2.0, 0, 0.55), mat: 'iron' },
    { geo: box(2.6, 0.06, 0.4, 0, 0.45, -0.6), mat: 'steel' },
    { geo: box(1.2, 1.8, 0.12, 1.4, 0.5, -0.82), mat: 'press' }, // panel publicitario
    { geo: box(0.08, 3.0, 0.08, 2.6, 0, 0.6), mat: 'iron' }, // poste de parada
    { geo: box(0.55, 0.55, 0.05, 2.6, 2.6, 0.6), mat: 'emtRed' },
  ],
  // Boca de metro: barandilla alrededor de la escalera + rombo de Metro de Madrid
  m: [
    { geo: box(1.8, 0.03, 5.0, 0, 0.0, 0), mat: 'dark' }, // hueco de la escalera
    // escalones visibles bajando
    ...[0, 1, 2, 3, 4, 5].map((k) => ({ geo: box(1.7, 0.02, 0.3, 0, 0.035, -1.2 + k * 0.62), mat: 'stone' })),
    // barandilla: pasamanos + balaustres
    { geo: box(0.06, 0.06, 5.0, -0.95, 1.0, 0), mat: 'iron' },
    { geo: box(0.06, 0.06, 5.0, 0.95, 1.0, 0), mat: 'iron' },
    { geo: box(1.95, 0.06, 0.06, 0, 1.0, -2.5), mat: 'iron' },
    ...[-2.4, -1.6, -0.8, 0, 0.8, 1.6, 2.4].flatMap((z) => [
      { geo: box(0.04, 1.0, 0.04, -0.95, 0, z), mat: 'iron' },
      { geo: box(0.04, 1.0, 0.04, 0.95, 0, z), mat: 'iron' },
    ]),
    ...[-0.6, 0, 0.6].map((x) => ({ geo: box(0.04, 1.0, 0.04, x, 0, -2.5), mat: 'iron' })),
    { geo: box(0.08, 2.8, 0.08, -1.1, 0, 2.5), mat: 'iron' },
    { geo: box(0.9, 0.9, 0.08, -1.1, 2.6, 2.5), mat: 'metroRed' },
    { geo: box(0.92, 0.18, 0.1, -1.1, 2.95, 2.5), mat: 'metroBlue' },
  ],
  f: [
    { geo: cyl(0.12, 0.15, 0.9, 0, 0, 0, 8), mat: 'iron' },
    { geo: box(0.35, 0.08, 0.25, 0, 0.9, 0.08), mat: 'iron' },
  ],
  c: [
    { geo: cyl(0.25, 0.25, 0.75, 0, 0.35, 0, 14), mat: 'correos' },
    { geo: new THREE.SphereGeometry(0.25, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.1, 0), mat: 'correos' },
    { geo: cyl(0.08, 0.1, 0.35, 0, 0, 0, 8), mat: 'iron' },
  ],
  k: [
    { geo: box(6.0, 0.08, 0.4, 0, 0, 0), mat: 'steel' },
    { geo: box(0.4, 1.6, 0.3, -3.2, 0, 0), mat: 'bici' },
    ...[-2.2, -1.2, -0.2, 0.8, 1.8].map((x) => ({ geo: box(0.12, 1.0, 0.25, x, 0, 0), mat: 'bici' })),
  ],
  t: [
    { geo: box(0.9, 2.2, 0.6, 0, 0, 0), mat: 'steel' },
    { geo: box(0.9, 0.3, 0.6, 0, 2.2, 0), mat: 'metroBlue' },
  ],
};
const RADIUS: Record<string, number> = { b: 0.5, p: 0.25, o: 0.12, s: 0.9, m: 1.0, f: 0.2, c: 0.3, k: 0.4, t: 0.5 };
const HEIGHT: Record<string, number> = { b: 0.9, p: 1.0, o: 0.9, s: 2.5, m: 1.0, f: 1.0, c: 1.2, k: 1.6, t: 2.4 };

class Batch {
  private parts = new Map<string, THREE.BufferGeometry[]>();
  add(geo: THREE.BufferGeometry, mat: string, m: THREE.Matrix4) {
    let arr = this.parts.get(mat);
    if (!arr) this.parts.set(mat, (arr = []));
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    arr.push(g);
  }
  build(group: THREE.Group) {
    for (const [mat, geos] of this.parts) {
      // fusionar en bloques para no crear buffers gigantes
      for (let i = 0; i < geos.length; i += 4000) {
        const merged = mergeGeometries(geos.slice(i, i + 4000), false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, M[mat]);
        mesh.castShadow = mat !== 'glass' && mat !== 'dark';
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }
  }
}

export function buildStreetFurniture(data: WorldData, specials: SpecialStructure[], ground: Ground, collision: CollisionWorld, carway: CarwayIndex): THREE.Group {
  const group = new THREE.Group();
  const batch = new Batch();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const place = (type: string, x: number, z: number, rot: number) => {
    const y = ground.heightAt(x, z, ground.terrain.heightAt(x, z) + 0.5);
    q.setFromAxisAngle(up, rot);
    m.compose(new THREE.Vector3(x, y, z), q, one);
    for (const p of MODELS[type]) batch.add(p.geo, p.mat, m);
    collision.addCircle(x, z, RADIUS[type], y + HEIGHT[type]);
  };

  // ---------- Mobiliario de OSM
  const F = data.furniture;
  for (let i = 0; i < F.length; i += 4) {
    const type = F[i] as string, x = F[i + 1] as number, z = F[i + 2] as number, dir = F[i + 3] as number;
    if (!MODELS[type]) continue;
    let px = x, pz = z;
    // Orientación: de cara a la calzada más cercana (Z local hacia la calle)
    const near = carway.nearest(x, z);
    let rot = 0;
    if (near) {
      const tx = near.px - x, tz = near.pz - z;
      rot = Math.atan2(tx, tz);
      // si el nodo de OSM cae sobre la calzada, llevarlo a la acera
      if (near.d < near.hw + 0.8 && (type === 's' || type === 'b' || type === 'p' || type === 'k' || type === 'm')) {
        const l = Math.hypot(tx, tz) || 1;
        const push = near.hw + 1.3 - near.d;
        px -= (tx / l) * push; pz -= (tz / l) * push;
      }
    }
    if (dir >= 0 && type === 'b') rot = (-(dir) * Math.PI) / 180 + Math.PI; // dirección OSM en grados (0 = norte)
    place(type, px, pz, rot);
  }

  // ---------- Setos de OSM
  for (const h of data.hedges) {
    for (let i = 2; i < h.length; i += 2) {
      const ax = h[i - 2], az = h[i - 1], bx = h[i], bz = h[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.3) continue;
      const steps = Math.ceil(len / 3);
      for (let s = 0; s < steps; s++) {
        const x0 = ax + ((bx - ax) * s) / steps, z0 = az + ((bz - az) * s) / steps;
        const x1 = ax + ((bx - ax) * (s + 1)) / steps, z1 = az + ((bz - az) * (s + 1)) / steps;
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        const y = ground.terrain.heightAt(mx, mz);
        const g = new THREE.BoxGeometry(len / steps + 0.25, 1.0, 0.85, 2, 1, 1);
        // irregularidad en la parte de arriba
        const pos = g.attributes.position;
        for (let k = 0; k < pos.count; k++) if (pos.getY(k) > 0) pos.setY(k, pos.getY(k) + Math.sin(mx * 3.1 + pos.getX(k) * 5 + mz) * 0.08);
        g.translate(0, 0.5, 0);
        q.setFromAxisAngle(up, Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2);
        m.compose(new THREE.Vector3(mx, y, mz), q, one);
        batch.add(g, 'hedge', m);
        collision.addSeg(x0, z0, x1, z1, y + 1.0);
      }
    }
  }

  // ---------- Construcciones singulares
  for (const s of specials) {
    const r = obb(s.data.pts);
    const rot = Math.atan2(r.ux, r.uz) - Math.PI / 2; // X local a lo largo del lado mayor
    q.setFromAxisAngle(up, rot);
    m.compose(new THREE.Vector3(r.cx, s.ground, r.cz), q, one);
    const L = Math.max(1.6, r.l), W = Math.max(1.4, r.w);
    if (s.kind === 'kiosk') {
      // Quiosco de prensa / ONCE: cuerpo metálico verde, mostrador, toldo y cubierta volada
      const H = 2.6;
      const parts: Part[] = [
        { geo: box(L, 0.25, W, 0, 0, 0), mat: 'stone' },
        { geo: box(L - 0.1, H - 0.25, W - 0.1, 0, 0.25, 0), mat: 'kiosk' },
        { geo: box(L * 0.8, 1.1, 0.04, 0, 1.0, W / 2 - 0.03), mat: 'glass' }, // escaparate
        { geo: box(L * 0.82, 0.7, 0.3, 0, 0.25, W / 2 + 0.1), mat: 'press' }, // revistas
        { geo: box(L * 0.85, 0.06, 0.9, 0, 2.15, W / 2 + 0.4).rotateX(0), mat: 'awning' }, // toldo
        { geo: box(L + 0.7, 0.18, W + 0.7, 0, H, 0), mat: 'kioskRoof' },
        { geo: box(L * 0.7, 0.28, 0.05, 0, H - 0.35, W / 2 + 0.01), mat: 'white' }, // rótulo
      ];
      for (const p of parts) batch.add(p.geo, p.mat, m);
      collision.addCircle(r.cx, r.cz, Math.min(L, W) / 2 + 0.2, s.ground + H);
      if (L > W * 1.6) {
        const ox = r.ux * (L / 2 - W / 2), oz = r.uz * (L / 2 - W / 2);
        collision.addCircle(r.cx + ox, r.cz + oz, W / 2 + 0.2, s.ground + H);
        collision.addCircle(r.cx - ox, r.cz - oz, W / 2 + 0.2, s.ground + H);
      }
    } else if (s.kind === 'canopy') {
      const H = 3.2;
      batch.add(box(L, 0.2, W, 0, H, 0), 'steel', m);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        batch.add(box(0.15, H, 0.15, sx * (L / 2 - 0.3), 0, sz * (W / 2 - 0.3)), 'iron', m);
        const c = new THREE.Vector3(sx * (L / 2 - 0.3), 0, sz * (W / 2 - 0.3)).applyQuaternion(q);
        collision.addCircle(r.cx + c.x, r.cz + c.z, 0.15, s.ground + H);
      }
    } else {
      // Acceso de Cercanías de Sol: bóveda de vidrio sobre estructura de acero
      const R = W / 2, Hb = Math.min(6.5, R * 1.1);
      const vault = new THREE.CylinderGeometry(R, R, L, 28, 1, true, -Math.PI / 2, Math.PI);
      vault.rotateZ(Math.PI / 2).scale(1, Hb / R, 1).translate(0, 0.3, 0);
      batch.add(vault, 'glass', m);
      const ribs = Math.max(3, Math.round(L / 2.2));
      for (let k = 0; k <= ribs; k++) {
        const x = -L / 2 + (k * L) / ribs;
        const rib = new THREE.TorusGeometry(R, 0.06, 4, 20, Math.PI).rotateY(Math.PI / 2).scale(1, Hb / R, 1).translate(x, 0.3, 0);
        batch.add(rib, 'steel', m);
      }
      batch.add(box(L, 0.3, W, 0, 0, 0), 'stone', m);
      for (const side of [-1, 1]) {
        const ex = new THREE.Vector3(side * (L / 2), 0, 0).applyQuaternion(q);
        collision.addCircle(r.cx + ex.x * 0.6, r.cz + ex.z * 0.6, R, s.ground + Hb);
      }
      collision.addCircle(r.cx, r.cz, R, s.ground + Hb);
    }
  }

  batch.build(group);
  return group;
}
