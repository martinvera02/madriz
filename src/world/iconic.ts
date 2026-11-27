import * as THREE from 'three';
import type { BuildingData, WorldData } from './realData';
import type { FacadeOverride, PlacedBuilding } from './buildings';
import { pointInRing } from './buildings';
import { FacadeKit, outerEdges, FacadeEdge } from './facadeKit';
import { Ground } from './roads';
import { CollisionWorld } from './collision';

/*
 * Edificios y monumentos emblemáticos.
 * La volumetría (planta real y alturas por partes de Catastro) viene de OpenStreetMap;
 * aquí se les asigna su fachada característica y se añaden los elementos que los hacen
 * reconocibles: cúpulas, torres del reloj, estatuas, pináculos, rótulos, fuentes, arcos…
 */

const STONE = 0xe8e2d4, WHITE = 0xf1ece2;

/** Fachada por nombre OSM del edificio. */
const FACADES: Record<string, FacadeOverride> = {
  'Presidencia de la Comunidad de Madrid': { style: 3, color: 0xb4583e, roof: 0x3b3f46, maxH: 17.6 }, // Real Casa de Correos (la torre del reloj se modela aparte)
  'Edificio Metrópolis': { style: 5, color: 0xeee5d3, roof: 0x34373d, maxH: 30 }, // la rotonda y la cúpula se modelan aparte
  'Telefónica': { style: 6, color: 0xd3cab9, roof: 0x8d8a84 }, // granito, machones verticales
  'Edificio España': { style: 3, color: 0xae5f42, roof: 0x8d8a84 }, // torre de ladrillo (el podio se trata aparte)
  'Torre de Madrid': { style: 7, color: 0xe9e4d8, roof: 0x9a968e }, // hormigón claro, retícula
  'Edificio Carrión': { style: 8, color: 0xe0d6c6, roof: 0x6f6c68 }, // bandas de piedra clara pulida y vidrio
  'Palacio Real': { style: 2, color: 0xeae4d5, roof: 0x7f8184 },
  'Palacio de Cibeles': { style: 5, color: 0xf3efe6, roof: 0x6c7078 },
  'Banco de España': { style: 5, color: 0xe9e1cf, roof: 0x5a5e66 },
  'Catedral de la Almudena': { style: 4, color: 0xe9e5db, roof: 0x5d6168 },
  'Real Basílica de San Francisco el Grande': { style: 4, color: 0xe3dccd, roof: 0x7f7f80 },
  'Edificio Villanueva': { style: 3, color: 0xb8694a, roof: 0x7a7c80 }, // Museo del Prado
  'Atocha (Histórica)': { style: 3, color: 0xab5c40, roof: 0x5d656c },
  'Círculo de Bellas Artes': { style: 5, color: 0xeae2d0, roof: 0x6f6c68 },
  'Teatro Real': { style: 2, color: 0xd8cdb6, roof: 0x7f7f80 },
  'Casa de la Panadería': { style: 0, color: 0x9e4a33, roof: 0x34373d },
  'Casa de la Carnicería': { style: 0, color: 0x9e4a33, roof: 0x34373d },
  'Palacio de Cristal': { style: 1, color: 0xd7ecf0, roof: 0xcfe6ec },
  'Palacio de Velázquez': { style: 3, color: 0xb86a4c, roof: 0x9fa3a6 },
  'Edificio Vitalicio': { style: 5, color: 0xe6dccb, roof: 0x3a3d44 },
  'Palacio de la Prensa': { style: 3, color: 0xa65e45 },
  'Palacio de la Música': { style: 5, color: 0xe2d6c0 },
  'Palacio del Congreso de los Diputados': { style: 5, color: 0xe7ddca, roof: 0x7a7c80 },
  'Palacio de Santa Cruz': { style: 3, color: 0xa9563c, roof: 0x34373d },
  'Casa de la Villa': { style: 3, color: 0xa9563c, roof: 0x34373d },
  'Casino de Madrid': { style: 5, color: 0xe6d9c2 },
  'Puerta de Alcalá': { skip: true }, // se sustituye por el modelo del arco
};

const nameOf = (b: BuildingData) => b.name ?? '';

export function makeFacadeOverride(data: WorldData) {
  // Plaza Mayor: todos los edificios que dan a la plaza van en su color almagra uniforme
  const plazaMayor = data.areas.find((a) => a.name === 'Plaza Mayor' && a.kind === 'plaza');
  const nearPlazaMayor = (b: BuildingData) => {
    if (!plazaMayor) return false;
    for (let i = 0; i < b.pts.length; i += 2) {
      const x = b.pts[i], z = b.pts[i + 1];
      if (pointInRing(x, z, plazaMayor.pts)) return true;
      for (const [dx, dz] of [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) if (pointInRing(x + dx, z + dz, plazaMayor.pts)) return true;
    }
    return false;
  };
  return (b: BuildingData): FacadeOverride | null => {
    // Edificio España: podio de piedra caliza blanca y torre de ladrillo
    if (nameOf(b) === 'Edificio España' && b.h <= 32) return { style: 5, color: 0xe6dfcf, roof: 0x8d8a84 };
    const f = FACADES[nameOf(b)];
    if (f) return f;
    if (Math.abs(b.pts[0] + 320) < 160 && Math.abs(b.pts[1] - 140) < 160 && nearPlazaMayor(b)) return { style: 0, color: 0x9a4430, roof: 0x34373d };
    return null;
  };
}

// ------------------------------------------------------------------ Elementos singulares

const mats = new Map<string, THREE.MeshStandardMaterial>();
function m(color: number, o: THREE.MeshStandardMaterialParameters = {}) {
  const key = color + JSON.stringify(o);
  let mt = mats.get(key);
  if (!mt) mats.set(key, (mt = new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...o })));
  return mt;
}
const slate = () => m(0x2f3239, { roughness: 0.55 });
const gold = () => m(0xd6b24a, { metalness: 0.9, roughness: 0.25 });
const bronze = () => m(0x3f4a40, { metalness: 0.55, roughness: 0.45 }); // bronce con pátina
const stone = () => m(STONE);
const marble = () => m(WHITE, { roughness: 0.5 });
const water = () => m(0x4a8aa6, { roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.85 });

interface BInfo { parts: PlacedBuilding[]; all: number[]; }

export function buildIconic(data: WorldData, placed: PlacedBuilding[], ground: Ground, collision: CollisionWorld): THREE.Group {
  const root = new THREE.Group();
  const byName = new Map<string, BInfo>();
  for (const p of placed) {
    const n = p.data.name;
    if (!n) continue;
    let e = byName.get(n);
    if (!e) byName.set(n, (e = { parts: [], all: [] }));
    e.parts.push(p);
    e.all.push(...p.data.pts);
  }
  const poi = (name: string) => data.pois.find((p) => p.name === name);
  const add = (mesh: THREE.Object3D) => {
    mesh.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    root.add(mesh);
    return mesh;
  };
  const tallest = (e: BInfo) => e.parts.reduce((a, b) => (b.top > a.top ? b : a));
  const halfSize = (p: PlacedBuilding) => {
    let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < p.data.pts.length; i += 2) {
      xmin = Math.min(xmin, p.data.pts[i]); xmax = Math.max(xmax, p.data.pts[i]);
      zmin = Math.min(zmin, p.data.pts[i + 1]); zmax = Math.max(zmax, p.data.pts[i + 1]);
    }
    return Math.min(xmax - xmin, zmax - zmin) / 2;
  };
  /** Punto de la planta más cercano a (x,z), desplazado `inset` metros hacia el centro. */
  const nearestEdgePoint = (e: BInfo, x: number, z: number, inset: number) => {
    let best = [0, 0], bd = Infinity;
    for (let i = 0; i < e.all.length; i += 2) {
      const d = (e.all[i] - x) ** 2 + (e.all[i + 1] - z) ** 2;
      if (d < bd) { bd = d; best = [e.all[i], e.all[i + 1]]; }
    }
    let cx = 0, cz = 0;
    for (let i = 0; i < e.all.length; i += 2) { cx += e.all[i]; cz += e.all[i + 1]; }
    cx /= e.all.length / 2; cz /= e.all.length / 2;
    const dx = cx - best[0], dz = cz - best[1], l = Math.hypot(dx, dz) || 1;
    return [best[0] + (dx / l) * inset, best[1] + (dz / l) * inset, Math.atan2(-dx, -dz)];
  };
  const topAt = (e: BInfo, x: number, z: number) => {
    let t = 0;
    for (const p of e.parts) if (pointInRing(x, z, p.data.pts)) t = Math.max(t, p.top);
    return t || tallest(e).top;
  };

  const dome = (x: number, y: number, z: number, r: number, mat: THREE.Material, drum = r * 0.6, lantern = true) => {
    const g = new THREE.Group();
    const d1 = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.05, drum, 28), stone());
    d1.position.y = drum / 2;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    cap.position.y = drum;
    g.add(d1, cap);
    if (lantern) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.12, r * 0.15, r * 0.4, 10), stone());
      l.position.y = drum + r + r * 0.18;
      const s = new THREE.Mesh(new THREE.ConeGeometry(r * 0.12, r * 0.35, 10), mat);
      s.position.y = drum + r + r * 0.55;
      g.add(l, s);
    }
    g.position.set(x, y, z);
    return add(g);
  };
  const statue = (x: number, y: number, z: number, scale: number, mat: THREE.Material, rot = 0) => {
    // Figura humana estilizada (sin rostro): peana, cuerpo, cabeza, brazo alzado
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.42, 1.6, 8), mat);
    body.position.y = 0.8;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), mat);
    head.position.y = 1.8;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.14), mat);
    arm.position.set(0.3, 1.9, 0);
    arm.rotation.z = -0.3;
    g.add(body, head, arm);
    g.scale.setScalar(scale);
    g.position.set(x, y, z);
    g.rotation.y = rot;
    return add(g);
  };
  const horseRider = (x: number, y: number, z: number, scale: number, rot: number) => {
    const g = new THREE.Group();
    const b = bronze();
    const ped = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.2, 5.5), stone());
    ped.position.y = 1.6;
    const horse = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 2.6), b);
    horse.position.y = 4.4;
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.3, 0.6), b);
    neck.position.set(0, 5.2, 1.2); neck.rotation.x = 0.5;
    const headH = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.9), b);
    headH.position.set(0, 5.8, 1.6);
    g.add(ped, horse, neck, headH);
    for (const [lx, lz] of [[-0.35, 1], [0.35, 1], [-0.35, -1], [0.35, -1]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.2, 0.22), b);
      leg.position.set(lx, 3.6, lz);
      g.add(leg);
    }
    const rider = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 1.3, 8), b);
    rider.position.set(0, 5.5, -0.1);
    const rh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), b);
    rh.position.set(0, 6.35, -0.1);
    g.add(rider, rh);
    g.scale.setScalar(scale);
    g.position.set(x, y, z);
    g.rotation.y = rot;
    collision.addBox(x - 2 * scale, z - 2 * scale, x + 2 * scale, z + 2 * scale, y + 3.2 * scale);
    return add(g);
  };
  const fountain = (x: number, z: number, r: number, centre: (g: THREE.Group, y: number) => void) => {
    const y = ground.terrain.heightAt(x, z);
    const g = new THREE.Group();
    // si OSM trae el vaso de la fuente, el pilón y el agua los pone el sistema de agua (water.ts)
    const fromOsm = data.areas.some((a) => {
      if (a.kind !== 'water') return false;
      let cx = 0, cz = 0;
      for (let i = 0; i < a.pts.length; i += 2) { cx += a.pts[i]; cz += a.pts[i + 1]; }
      const n = a.pts.length / 2;
      return Math.hypot(cx / n - x, cz / n - z) < r + 2;
    });
    if (!fromOsm) {
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.3, 0.9, 40), stone());
      basin.position.y = 0.45;
      const w = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.5, r - 0.5, 0.1, 40), water());
      w.position.y = 0.93;
      g.add(basin, w);
      collision.addCircle(x, z, r + 0.3, y + 0.9);
    }
    centre(g, 0.8);
    g.position.set(x, y, z);
    return add(g);
  };

  // --- Real Casa de Correos: torre del reloj sobre la fachada que da a Sol
  {
    const e = byName.get('Presidencia de la Comunidad de Madrid');
    const sol = poi('Kilómetro Cero') ?? { x: -19, z: 7 };
    if (e) {
      const [x, z, rot] = nearestEdgePoint(e, sol.x, sol.z + 25, 5);
      const y = topAt(e, x, z);
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(7, 6, 5), m(0xe6e0d2));
      base.position.y = 3;
      const mid = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 4), m(0xe6e0d2));
      mid.position.y = 8;
      const roofT = new THREE.Mesh(new THREE.ConeGeometry(2.4, 3.5, 4), slate());
      roofT.position.y = 11.7; roofT.rotation.y = Math.PI / 4;
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 6), m(0x222222));
      bell.position.y = 14.6;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), gold());
      ball.position.y = 13.6;
      const face = new THREE.Mesh(new THREE.CircleGeometry(1.5, 32), m(0xffffff, { emissive: 0xfff4da, emissiveIntensity: 0.25 }));
      face.position.set(0, 3.4, 2.52);
      const hands = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.05), m(0x111111));
      hands.position.set(0, 3.7, 2.56);
      g.add(base, mid, roofT, bell, ball, face, hands);
      g.position.set(x, y, z);
      g.rotation.y = rot + Math.PI;
      add(g);
    }
  }

  // --- Edificio Metrópolis: rotonda en la proa con tambor, cúpula de pizarra con decoración dorada
  //     (más de 30.000 panes de oro) y la Victoria alada de Coullaut (1975); 45 m hasta el remate
  {
    const e = byName.get('Edificio Metrópolis');
    const cib = poi('Fuente de Cibeles') ?? { x: 890, z: -293 };
    if (e) {
      // La parte de la rotonda es la más alta en OSM (incluye la cúpula como volumen)
      const raw = data.buildings.filter((b) => b.name === 'Edificio Metrópolis').reduce((a, b) => (b.h > a.h ? b : a));
      const rot = e.parts.find((p) => p.data === raw) ?? e.parts[0];
      let r = halfSize(rot);
      let x = rot.cx, z = rot.cz;
      if (r > 9) { // por si la rotonda viene unida al resto: usar el punto de la proa
        const [px, pz] = nearestEdgePoint(e, cib.x, cib.z, 8);
        x = px; z = pz; r = 8;
      }
      r = Math.max(5.5, Math.min(8.5, r * 0.95));
      const y = rot.top;
      const drum = new THREE.Group();
      const core = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.95, 3.4, 32), m(0xeee5d3));
      core.position.y = 1.7;
      drum.add(core);
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 3.0, 8), m(0xf4eee2));
        c.position.set(Math.cos(a) * (r * 0.97), 1.6, Math.sin(a) * (r * 0.97));
        drum.add(c);
      }
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.0, r * 1.0, 0.5, 32), m(0xf4eee2));
      ring.position.y = 3.4;
      drum.add(ring);
      drum.position.set(x, y, z);
      add(drum);
      const capR = r * 0.9;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(capR, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), slate());
      cap.scale.set(1, 1.15, 1);
      cap.position.set(x, y + 3.6, z);
      add(cap);
      // nervios y guirnaldas doradas
      for (let k = 0; k < 8; k++) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(capR * 1.01, 0.07, 4, 24, Math.PI / 2), gold());
        rib.rotation.set(0, (k / 8) * Math.PI * 2, Math.PI / 2);
        rib.scale.set(1, 1.15, 1);
        rib.position.set(x, y + 3.6, z);
        add(rib);
      }
      const band = new THREE.Mesh(new THREE.TorusGeometry(capR * 0.86, 0.12, 6, 40), gold());
      band.rotation.x = Math.PI / 2;
      band.position.set(x, y + 3.6 + capR * 0.6, z);
      add(band);
      // linterna y Victoria alada
      const lant = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 1.8, 12), m(0xeee5d3));
      lant.position.set(x, y + 3.6 + capR * 1.15 + 0.6, z);
      add(lant);
      const v = statue(x, y + 3.6 + capR * 1.15 + 1.5, z, 1.7, gold(), Math.atan2(cib.x - x, cib.z - z));
      const wings = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.5, 0.12), gold());
      wings.position.set(0, 1.4, -0.25);
      wings.rotation.x = 0.3;
      v.add(wings);
    }
  }

  // --- Telefónica: torre con relojes y antenas
  {
    const e = byName.get('Telefónica');
    if (e) {
      const t = tallest(e);
      const g = new THREE.Group();
      const crown = new THREE.Mesh(new THREE.BoxGeometry(7, 5, 7), m(0xd2c9b8));
      crown.position.y = 2.5;
      const top2 = new THREE.Mesh(new THREE.BoxGeometry(4.5, 3, 4.5), m(0xd2c9b8));
      top2.position.y = 6.5;
      g.add(crown, top2);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const face = new THREE.Mesh(new THREE.CircleGeometry(1.4, 24), m(0xffffff, { emissive: 0xfff4da, emissiveIntensity: 0.3 }));
        face.position.set(dx * 3.52, 2.8, dz * 3.52);
        face.lookAt(dx * 10, 2.8, dz * 10);
        g.add(face);
      }
      for (const [dx, dz, h] of [[0, 0, 14], [1.2, 1.2, 8], [-1.2, -1.2, 9]]) {
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.15, h, 6), m(0xb0b4b8, { metalness: 0.6 }));
        ant.position.set(dx, 8 + h / 2, dz);
        g.add(ant);
      }
      g.position.set(t.cx, t.top, t.cz);
      add(g);
    }
  }

  // --- Edificio España: remate neobarroco en la coronación (torreón central, chapiteles y obeliscos)
  {
    const e = byName.get('Edificio España');
    if (e) {
      const t = tallest(e);
      const s = Math.max(5, halfSize(t) * 0.8);
      const brick = m(0xae5f42), lime = m(0xe8e0cf);
      const g = new THREE.Group();
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(s * 2, 4.5, s * 2), brick); c1.position.y = 2.25;
      const c1c = new THREE.Mesh(new THREE.BoxGeometry(s * 2 + 0.8, 0.7, s * 2 + 0.8), lime); c1c.position.y = 4.8;
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(s * 1.3, 5, s * 1.3), lime); c2.position.y = 7.7;
      const c2c = new THREE.Mesh(new THREE.BoxGeometry(s * 1.3 + 0.6, 0.6, s * 1.3 + 0.6), lime); c2c.position.y = 10.5;
      const c3 = new THREE.Mesh(new THREE.BoxGeometry(s * 0.7, 3.5, s * 0.7), lime); c3.position.y = 12.5;
      const spire = new THREE.Mesh(new THREE.ConeGeometry(s * 0.5, 7, 4), slate()); spire.position.y = 17.7; spire.rotation.y = Math.PI / 4;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), lime); ball.position.y = 21.5;
      g.add(c1, c1c, c2, c2c, c3, spire, ball);
      // obeliscos en las esquinas de cada cuerpo
      for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        for (const [r, y, hgt] of [[s, 5.1, 4.5], [s * 0.65, 10.8, 3]] as const) {
          const ped = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.9), lime); ped.position.set(dx * r, y + 0.4, dz * r);
          const ob = new THREE.Mesh(new THREE.ConeGeometry(0.42, hgt, 4), lime); ob.position.set(dx * r, y + 0.8 + hgt / 2, dz * r); ob.rotation.y = Math.PI / 4;
          g.add(ped, ob);
        }
      }
      // ventanas de la linterna
      for (const a of [0, 1, 2, 3]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.2, 0.1), m(0x1d2228));
        w.position.set(Math.sin(a * Math.PI / 2) * (s * 0.65 + 0.03), 7.8, Math.cos(a * Math.PI / 2) * (s * 0.65 + 0.03));
        w.rotation.y = a * Math.PI / 2;
        g.add(w);
      }
      g.position.set(t.cx, t.top, t.cz);
      add(g);
    }
  }

  // --- Edificio Carrión (Capitol): rótulo luminoso sobre la proa que mira a Callao
  {
    const e = byName.get('Edificio Carrión');
    const callao = data.areas.find((a) => a.name === 'Plaza de Callao');
    if (e && callao) {
      let qx = 0, qz = 0;
      for (let i = 0; i < callao.pts.length; i += 2) { qx += callao.pts[i]; qz += callao.pts[i + 1]; }
      qx /= callao.pts.length / 2; qz /= callao.pts.length / 2;
      const [x, z, rot] = nearestEdgePoint(e, qx, qz, 3);
      const y = topAt(e, x, z);
      const c = document.createElement('canvas');
      c.width = 512; c.height = 128;
      const g2 = c.getContext('2d')!;
      g2.fillStyle = '#120808'; g2.fillRect(0, 0, 512, 128);
      g2.font = 'bold 92px Georgia, serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
      g2.fillStyle = '#ff3b2a'; g2.shadowColor = '#ff6a40'; g2.shadowBlur = 18;
      g2.fillText('CAPITOL', 256, 68);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9, side: THREE.DoubleSide }));
      sign.position.set(x, y + 3, z);
      sign.rotation.y = rot;
      add(sign);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 0.3), m(0x333333));
      frame.position.set(x, y + 1.5, z);
      add(frame);
    }
  }

  // --- Cúpulas: Almudena y San Francisco el Grande
  for (const [name, mat, scale] of [
    ['Catedral de la Almudena', m(0x4d6a78, { metalness: 0.3, roughness: 0.5 }), 0.8],
    ['Real Basílica de San Francisco el Grande', m(0x6c6f75, { roughness: 0.5 }), 0.85],
  ] as const) {
    const e = byName.get(name);
    if (!e) continue;
    const t = tallest(e);
    const r = Math.max(6, Math.min(17, halfSize(t) * scale));
    dome(t.cx, t.top, t.cz, r, mat, r * 0.55);
  }

  // --- Palacio de Cibeles: pináculos en sus torres
  {
    const e = byName.get('Palacio de Cibeles');
    if (e) {
      const sorted = [...e.parts].sort((a, b) => b.top - a.top);
      const cut = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.12))].top;
      for (const p of sorted) {
        if (p.top < cut) break;
        const g = new THREE.Group();
        const sz = Math.max(1.2, Math.min(3, halfSize(p) * 0.5));
        const b = new THREE.Mesh(new THREE.CylinderGeometry(sz * 0.6, sz, 3, 8), m(WHITE));
        b.position.y = 1.5;
        const sp = new THREE.Mesh(new THREE.ConeGeometry(sz * 0.42, sz * 3.2, 8), m(WHITE));
        sp.position.y = 3 + sz * 2;
        g.add(b, sp);
        g.position.set(p.cx, p.top, p.cz);
        add(g);
      }
    }
  }

  // --- Círculo de Bellas Artes: Minerva en lo alto
  {
    const e = byName.get('Círculo de Bellas Artes');
    if (e) {
      const t = tallest(e);
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 2.5, 12), m(0xeae2d0));
      ped.position.set(t.cx, t.top + 1.25, t.cz);
      add(ped);
      statue(t.cx, t.top + 2.5, t.cz, 2.4, bronze());
    }
  }

  // --- Banco de España: chapitel en la esquina de Cibeles
  {
    const e = byName.get('Banco de España');
    const cib = poi('Fuente de Cibeles') ?? { x: 890, z: -293 };
    if (e) {
      const [x, z] = nearestEdgePoint(e, cib.x, cib.z, 6);
      dome(x, topAt(e, x, z), z, 4.5, slate(), 2.5);
    }
  }

  // --- Casa de la Panadería: chapiteles de pizarra en sus dos torres
  {
    const e = byName.get('Casa de la Panadería');
    if (e) {
      const sorted = [...e.parts].sort((a, b) => b.top - a.top).slice(0, 2);
      for (const p of sorted) {
        const sp = new THREE.Mesh(new THREE.ConeGeometry(3.2, 9, 4), slate());
        sp.position.set(p.cx, p.top + 4.5, p.cz);
        sp.rotation.y = Math.PI / 4;
        add(sp);
        const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 6), m(0x222222));
        needle.position.set(p.cx, p.top + 10, p.cz);
        add(needle);
      }
    }
  }

  // --- Puerta de Alcalá (modelo propio sobre la planta real; sus partes OSM no se dibujan)
  {
    const gateParts = data.buildings.filter((b) => b.name === 'Puerta de Alcalá');
    const e: BInfo | undefined = gateParts.length ? { parts: [], all: gateParts.flatMap((b) => b.pts) } : undefined;
    if (e) {
      // Eje principal por análisis de la nube de puntos
      let cx = 0, cz = 0;
      const n = e.all.length / 2;
      for (let i = 0; i < e.all.length; i += 2) { cx += e.all[i]; cz += e.all[i + 1]; }
      cx /= n; cz /= n;
      let sxx = 0, szz = 0, sxz = 0;
      for (let i = 0; i < e.all.length; i += 2) {
        const dx = e.all[i] - cx, dz = e.all[i + 1] - cz;
        sxx += dx * dx; szz += dz * dz; sxz += dx * dz;
      }
      const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
      const ax = Math.cos(ang), az = Math.sin(ang);
      let len = 0;
      for (let i = 0; i < e.all.length; i += 2) len = Math.max(len, Math.abs((e.all[i] - cx) * ax + (e.all[i + 1] - cz) * az));
      // Medidas del monumento: 43,97 m de frente, 19,5 m hasta la cornisa del ático (21,95 con las esculturas)
      const L = 44, D = Math.min(9, Math.max(6.5, len > 0 ? 7.5 : 7.5)), H = 19.5;
      const y = ground.terrain.heightAt(cx, cz);
      const g = new THREE.Group();
      const gran = m(0xe9e0cc);
      // Tres cuerpos (Sabatini): central más alto con 3 arcos de medio punto; laterales más bajos, adintelados
      const bays = 5, pier = 2.6, bodyH = 13.2, sideH = 10.6;
      const open = (L - pier * (bays + 1)) / bays;
      const latW = pier * 1.5 + open; // ancho de cada cuerpo lateral
      const shape = new THREE.Shape();
      shape.moveTo(-L / 2, 0); shape.lineTo(L / 2, 0); shape.lineTo(L / 2, sideH); shape.lineTo(L / 2 - latW, sideH);
      shape.lineTo(L / 2 - latW, bodyH); shape.lineTo(-L / 2 + latW, bodyH); shape.lineTo(-L / 2 + latW, sideH);
      shape.lineTo(-L / 2, sideH); shape.lineTo(-L / 2, 0);
      for (let k = 0; k < bays; k++) {
        const x0 = -L / 2 + pier + k * (pier + open), x1 = x0 + open;
        const hole = new THREE.Path();
        if (k === 0 || k === bays - 1) {
          hole.moveTo(x0, 0); hole.lineTo(x0, 6.8); hole.lineTo(x1, 6.8); hole.lineTo(x1, 0); hole.lineTo(x0, 0);
        } else {
          const spring = Math.min(7.6, bodyH - open / 2 - 1.4);
          hole.moveTo(x0, 0); hole.lineTo(x0, spring);
          hole.absarc((x0 + x1) / 2, spring, open / 2, Math.PI, 0, true);
          hole.lineTo(x1, 0); hole.lineTo(x0, 0);
        }
        shape.holes.push(hole);
        for (const px of [x0 - pier / 2, x1 + pier / 2]) collision.addCircle(cx + ax * px, cz + az * px, pier * 0.7, y + bodyH);
      }
      const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false, curveSegments: 18 });
      bodyGeo.translate(0, 0, -D / 2);
      g.add(new THREE.Mesh(bodyGeo, gran));
      const light = m(0xf0ebdf);
      // Columnas jónicas adosadas en ambos frentes (más altas en el cuerpo central)
      for (let k = 0; k <= bays; k++) {
        const px = -L / 2 + pier / 2 + k * (pier + open);
        const central = k >= 1 && k <= bays - 1;
        const ch = central ? 10.4 : 8.2;
        for (const sz of [1, -1]) {
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.52, ch, 14), light);
          col.position.set(px, 0.9 + ch / 2, sz * (D / 2 + 0.4));
          const capi = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.45, 1.3), light);
          capi.position.set(px, 0.9 + ch + 0.22, sz * (D / 2 + 0.4));
          const basa = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.9, 1.25), gran);
          basa.position.set(px, 0.45, sz * (D / 2 + 0.4));
          g.add(col, capi, basa);
        }
      }
      // Entablamentos: central y laterales
      const entC = new THREE.Mesh(new THREE.BoxGeometry(L - 2 * latW + 1, 1.8, D + 1.3), m(0xdcd4c2));
      entC.position.y = bodyH + 0.5;
      g.add(entC);
      for (const sx of [-1, 1]) {
        const entL = new THREE.Mesh(new THREE.BoxGeometry(latW + 0.6, 1.4, D + 1.2), m(0xdcd4c2));
        entL.position.set(sx * (L / 2 - latW / 2), sideH + 0.4, 0);
        // trofeos sobre los cuerpos laterales
        const tro = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.6, 6), m(0xd4cbb5));
        tro.position.set(sx * (L / 2 - latW / 2), sideH + 2.4, 0);
        g.add(entL, tro);
      }
      // Ático central con cartela (inscripción) y frontón curvo con escudo y figuras
      const attic = new THREE.Mesh(new THREE.BoxGeometry(L - 2 * latW - 2, 3.6, D * 0.9), gran);
      attic.position.y = bodyH + 1.4 + 1.8;
      const plaque = new THREE.Mesh(new THREE.BoxGeometry(8, 1.6, D * 0.9 + 0.2), m(0xcfc6b2));
      plaque.position.y = bodyH + 1.4 + 1.8;
      // remate central: segmento curvo (frontón) visto de frente, extruido en profundidad
      const cs = new THREE.Shape();
      cs.moveTo(-5.4, 0);
      cs.absarc(0, -9.5, Math.hypot(5.4, 9.5), Math.PI - Math.atan2(9.5, 5.4), Math.atan2(9.5, 5.4), true);
      cs.lineTo(-5.4, 0);
      const crownGeo = new THREE.ExtrudeGeometry(cs, { depth: D * 0.8, bevelEnabled: false, curveSegments: 20 });
      crownGeo.translate(0, bodyH + 1.4 + 3.6 + 1.8 / 2 - 0.9, -D * 0.4);
      const crown = new THREE.Mesh(crownGeo, gran);
      g.add(attic, plaque, crown);
      const shield = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, D * 0.9), m(0xd4cbb5));
      shield.position.y = bodyH + 1.4 + 3.6 + 1.4;
      g.add(shield);
      for (const sx of [-2.2, 2.2]) {
        const fig = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.8, 8), m(0xd4cbb5));
        fig.position.set(sx, bodyH + 1.4 + 3.6 + 0.9, 0);
        g.add(fig);
      }
      g.position.set(cx, y, cz);
      g.rotation.y = -ang;
      add(g);
      void H;
    }
  }

  // --- Fuentes y estatuas
  const fcib = poi('Fuente de Cibeles');
  if (fcib) {
    const wa = data.areas.find((a) => a.name === 'Fuente de Cibeles');
    let r = 11;
    if (wa) {
      let mx = 0;
      for (let i = 0; i < wa.pts.length; i += 2) mx = Math.max(mx, Math.hypot(wa.pts[i] - fcib.x, wa.pts[i + 1] - fcib.z));
      r = Math.max(8, Math.min(16, mx));
    }
    fountain(fcib.x, fcib.z, r, (g, y) => {
      const rock = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3, 1.6, 10), m(0xd8d2c4));
      rock.position.y = y + 0.8;
      const cart = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 3), marble());
      cart.position.set(0, y + 2.3, -0.4);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 2.6, 16), marble());
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(0, y + 2.0, -0.9);
      const goddess = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.8, 10), marble());
      goddess.position.set(0, y + 4.4, -0.6);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.32, 0.5, 10), marble());
      crown.position.set(0, y + 6.0, -0.6);
      g.add(rock, cart, wheel, goddess, crown);
      for (const s of [-0.75, 0.75]) {
        const lion = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 2.4), marble());
        lion.position.set(s, y + 2.2, 2.0);
        const mane = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), marble());
        mane.position.set(s, y + 3.1, 3.0);
        g.add(lion, mane);
      }
    });
  }
  const fnep = poi('Fuente de Neptuno');
  if (fnep) fountain(fnep.x, fnep.z, 9, (g, y) => {
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 1.4, 12), marble());
    shell.position.y = y + 0.7;
    g.add(shell);
    const fig = statue(0, 0, 0, 1.4, marble());
    root.remove(fig);
    fig.position.y = y + 1.4;
    const trident = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 6), marble());
    trident.position.set(0.5, y + 3.4, 0);
    g.add(fig, trident);
  });
  const fapo = poi('Fuente de Apolo');
  if (fapo) fountain(fapo.x, fapo.z, 5, (g, y) => {
    const ped = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), marble());
    ped.position.y = y + 2;
    g.add(ped);
    const fig = statue(0, 0, 0, 1.2, marble());
    root.remove(fig);
    fig.position.y = y + 4;
    g.add(fig);
  });
  const oso = poi('El Oso y el Madroño');
  if (oso) {
    const y = ground.terrain.heightAt(oso.x, oso.z);
    const g = new THREE.Group();
    const ped = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 2.2), m(0xc9c2b3));
    ped.position.y = 0.65;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 2.6, 6), bronze());
    trunk.position.set(0.35, 2.6, 0);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 0), m(0x3a4a34, { metalness: 0.5, roughness: 0.5 }));
    crown.position.set(0.35, 4.2, 0);
    const bear = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.7, 0.7), bronze());
    bear.position.set(-0.25, 2.15, 0);
    const bhead = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.6), bronze());
    bhead.position.set(-0.05, 3.15, 0.05);
    g.add(ped, trunk, crown, bear, bhead);
    g.position.set(oso.x, y, oso.z);
    collision.addBox(oso.x - 1.1, oso.z - 1.1, oso.x + 1.1, oso.z + 1.1, y + 1.3);
    add(g);
  }
  const mari = poi('Estatua de la Mariblanca');
  if (mari) {
    const y = ground.terrain.heightAt(mari.x, mari.z);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 3.5, 10), m(0xc9c2b3));
    col.position.set(mari.x, y + 1.75, mari.z);
    add(col);
    statue(mari.x, y + 3.5, mari.z, 1.0, marble());
    collision.addCircle(mari.x, mari.z, 0.8, y + 3.5);
  }
  for (const [name, rot] of [['Carlos III', Math.PI], ['Felipe III', 0], ['Felipe IV', Math.PI / 2]] as const) {
    const p = data.pois.find((q) => q.name === name);
    if (!p) continue;
    horseRider(p.x, ground.terrain.heightAt(p.x, p.z), p.z, 1.15, rot);
  }
  const colon = poi('Monumento a Cristóbal Colón');
  if (colon) {
    const y = ground.terrain.heightAt(colon.x, colon.z);
    const base = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 5), m(0xd8d0bf));
    base.position.set(colon.x, y + 2, colon.z);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 14, 8), m(0xe6dfd0));
    shaft.position.set(colon.x, y + 11, colon.z);
    add(base); add(shaft);
    statue(colon.x, y + 18, colon.z, 1.5, marble());
    collision.addBox(colon.x - 2.5, colon.z - 2.5, colon.x + 2.5, colon.z + 2.5, y + 4);
  }
  const alfonso = poi('Monumento a Alfonso XII');
  if (alfonso) {
    const y = ground.terrain.heightAt(alfonso.x, alfonso.z);
    const g = new THREE.Group();
    const plat = new THREE.Mesh(new THREE.BoxGeometry(60, 2, 12), m(0xd6cdbb));
    plat.position.y = 1;
    g.add(plat);
    // columnata semicircular
    for (let k = 0; k <= 18; k++) {
      const a = Math.PI * (k / 18);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.65, 10, 10), marble());
      c.position.set(Math.cos(a) * 26, 7, -Math.sin(a) * 9 - 2);
      g.add(c);
    }
    const ped = new THREE.Mesh(new THREE.BoxGeometry(6, 18, 6), m(0xd6cdbb));
    ped.position.set(0, 11, 2);
    g.add(ped);
    g.position.set(alfonso.x, y, alfonso.z);
    add(g);
    horseRider(alfonso.x, y + 20, alfonso.z + 2, 1.0, 0);
    collision.addBox(alfonso.x - 30, alfonso.z - 6, alfonso.x + 30, alfonso.z + 6, y + 2);
  }
  const angel = poi('El Ángel Caído');
  if (angel) {
    const y = ground.terrain.heightAt(angel.x, angel.z);
    fountain(angel.x, angel.z, 4, () => undefined);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 7, 8), m(0xd6cdbb));
    col.position.set(angel.x, y + 4.3, angel.z);
    add(col);
    statue(angel.x, y + 7.8, angel.z, 1.2, bronze());
  }
  // Monumento a Cervantes: lo modela urban.ts (plaza de España)
  const km0 = poi('Kilómetro Cero');
  if (km0) {
    const y = ground.terrain.heightAt(km0.x, km0.z);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.8), gold());
    plate.position.set(km0.x, y + 0.03, km0.z);
    add(plate);
  }

  return root;
}

// ------------------------------------------------------------------ Fachadas en relieve de los emblemáticos

/**
 * Molduras, cornisas, pilastras, columnas, balaustradas y remates sobre las aristas reales.
 * Las proporciones salen de la documentación de cada edificio (ver comentarios).
 */
export function buildFacadeDetails(data: WorldData, placed: PlacedBuilding[]): THREE.Group {
  const kit = new FacadeKit({
    stone: new THREE.MeshStandardMaterial({ color: 0xebe5d6, roughness: 0.7 }), // piedra caliza (Colmenar)
    granite: new THREE.MeshStandardMaterial({ color: 0xb3ab9d, roughness: 0.85 }), // granito berroqueño
    white: new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.6 }),
    darkstone: new THREE.MeshStandardMaterial({ color: 0x3a3330, roughness: 0.35, metalness: 0.1 }), // granito pulido oscuro
    iron: new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.5, metalness: 0.5 }),
    shadow: new THREE.MeshStandardMaterial({ color: 0x23201d, roughness: 1 }),
    slate: new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.55 }),
  });
  const byName = new Map<string, PlacedBuilding[]>();
  for (const p of placed) {
    if (!p.data.name) continue;
    let arr = byName.get(p.data.name);
    if (!arr) byName.set(p.data.name, (arr = []));
    arr.push(p);
  }
  const near = (parts: PlacedBuilding[], r = 40) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of parts) for (let i = 0; i < p.data.pts.length; i += 2) {
      x0 = Math.min(x0, p.data.pts[i]); x1 = Math.max(x1, p.data.pts[i]);
      z0 = Math.min(z0, p.data.pts[i + 1]); z1 = Math.max(z1, p.data.pts[i + 1]);
    }
    return placed.filter((q) => q.cx > x0 - r && q.cx < x1 + r && q.cz > z0 - r && q.cz < z1 + r);
  };
  const edgesOf = (name: string) => {
    const parts = byName.get(name);
    if (!parts) return null;
    return { parts, edges: outerEdges(parts, near(parts)) };
  };
  const tallest = (parts: PlacedBuilding[]) => parts.reduce((a, b) => (b.top > a.top ? b : a));
  const mid = (e: FacadeEdge) => [(e.ax + e.bx) / 2, (e.az + e.bz) / 2];
  const poi = (n: string) => data.pois.find((p) => p.name === n);

  // --- Real Casa de Correos (Marquet, 1768): ladrillo con piedra blanca de Colmenar; zócalo, piso bajo,
  //     entreplanta y piso principal; portada central con balcón y escudo de Carlos III
  {
    const b = edgesOf('Presidencia de la Comunidad de Madrid');
    if (b) {
      const sol = poi('Kilómetro Cero') ?? { x: -19, z: 7 };
      let front: FacadeEdge | null = null, best = -Infinity;
      for (const e of b.edges) {
        const [mx, mz] = mid(e);
        const dx = sol.x - mx, dz = sol.z - mz, l = Math.hypot(dx, dz) || 1;
        const score = ((e.nx * dx + e.nz * dz) / l) * Math.min(e.len, 40);
        if (score > best) { best = score; front = e; }
      }
      for (const e of b.edges) {
        const h = e.top - e.ground;
        kit.band('granite', e, e.ground - 0.5, e.ground + 1.3, 0.2);
        kit.band('stone', e, e.ground + h * 0.4, e.ground + h * 0.4 + 0.45, 0.28);
        kit.band('stone', e, e.ground + h * 0.68, e.ground + h * 0.68 + 0.35, 0.22);
        kit.cornice('stone', e, e.top, 0.85, 1.1);
        if (e.len > 6) {
          kit.box('stone', e, 0, 1.3, e.ground, e.top - 1, 0, 0.14); // esquinas almohadilladas
          kit.box('stone', e, e.len - 1.3, e.len, e.ground, e.top - 1, 0, 0.14);
        }
      }
      if (front) {
        const e = front, c = e.len / 2, h = e.top - e.ground;
        // Fachada de Marquet: paños de ladrillo entre fajas verticales de piedra de Colmenar
        kit.pilasters('stone', e, e.ground + 1.3, e.top - 1.1, 4.3, 0.75, 0.14);
        // Cuerpo central resaltado con pilastras pareadas
        for (const u of [c - 7.2, c - 6.2, c + 6.2, c + 7.2]) kit.box('stone', e, u - 0.4, u + 0.4, e.ground + 1.3, e.top - 1.1, 0, 0.3);
        // Tres portadas de medio punto con recercado de piedra y dovelas
        for (const u of [c - 3.6, c, c + 3.6]) {
          kit.box('stone', e, u - 1.7, u + 1.7, e.ground, e.ground + 5.0, 0, 0.22);
          kit.box('shadow', e, u - 1.15, u + 1.15, e.ground, e.ground + 3.9, 0.22, 0.26);
          kit.box('shadow', e, u - 0.8, u + 0.8, e.ground + 3.9, e.ground + 4.4, 0.22, 0.26);
          kit.box('stone', e, u - 0.3, u + 0.3, e.ground + 4.4, e.ground + 5.0, 0.26, 0.36); // clave
        }
        // Balcón principal corrido sobre las portadas, con barandilla de forja
        const by = e.ground + h * 0.42;
        kit.box('stone', e, c - 6, c + 6, by, by + 0.3, 0, 1.4);
        kit.box('iron', e, c - 6, c + 6, by + 0.3, by + 1.3, 1.32, 1.38);
        kit.box('iron', e, c - 6, c - 5.94, by + 0.3, by + 1.3, 0, 1.38);
        kit.box('iron', e, c + 5.94, c + 6, by + 0.3, by + 1.3, 0, 1.38);
        // Escudo de Carlos III sobre el balcón y frontón del cuerpo central
        kit.box('stone', e, c - 1.6, c + 1.6, by + 1.6, by + 4.2, 0.25, 0.55);
        kit.box('stone', e, c - 7.6, c + 7.6, e.top - 0.2, e.top + 0.9, -0.1, 0.5);
      }
    }
  }

  // --- Metrópolis (Février, 1911): piedra blanca, columnas corintias pareadas en la rotonda,
  //     grupos escultóricos sobre la cornisa, balaustrada y cúpula de pizarra
  {
    const b = edgesOf('Edificio Metrópolis');
    const cib = poi('Fuente de Cibeles') ?? { x: 890, z: -293 };
    if (b) {
      // punto de la proa (el más cercano a Cibeles)
      let px = 0, pz = 0, bd = Infinity;
      for (const e of b.edges) for (const [x, z] of [[e.ax, e.az], [e.bx, e.bz]]) {
        const d = (x - cib.x) ** 2 + (z - cib.z) ** 2;
        if (d < bd) { bd = d; px = x; pz = z; }
      }
      for (const e of b.edges) {
        const [mx, mz] = mid(e);
        const prow = Math.hypot(mx - px, mz - pz) < 16;
        kit.band('granite', e, e.ground - 0.5, e.ground + 0.9, 0.15);
        kit.cornice('white', e, e.ground + 5.6, 0.45, 0.6);
        kit.pilasters('white', e, e.ground + 5.6, e.top - 2.4, prow ? 2.6 : 3.9, 0.7, 0.28);
        kit.cornice('white', e, e.top - 1.2, 1.0, 1.2);
        kit.balustrade('white', e, e.top - 1.2, 1.1, 3.9);
        if (prow) {
          kit.columns('white', e, e.ground + 9.2, e.ground + 20.5, 2.6, 0.42, 0.15, true);
          kit.box('white', e, -0.2, e.len + 0.2, e.ground + 20.5, e.ground + 21.6, -0.05, 1.3);
          kit.finials('stone', e, e.top - 0.1, 5.2, 'statue', 1.7);
        }
      }
    }
  }

  // --- Telefónica (Cárdenas, 1929; 89,30 m): granito, retranqueos escalonados con remates barrocos
  {
    const b = edgesOf('Telefónica');
    if (b) {
      const top = tallest(b.parts).top;
      for (const e of b.edges) {
        kit.band('granite', e, e.ground - 0.5, e.ground + 6.5, 0.25);
        kit.cornice('granite', e, e.ground + 7.2, 0.5, 0.7);
        kit.cornice('stone', e, e.top, 0.6, 0.9);
      }
      for (const p of b.parts) if (p.top < top - 2 && p.top - p.ground > 20) kit.cornerFinials('stone', p, 'pinnacle', 1.1);
    }
  }

  // --- Edificio España (Otamendi, 1953; 117 m): podio de piedra y torre de ladrillo escalonada,
  //     "chapiteles, impostas y mansardas" y dobles pináculos piramidales y jarrones en cada cornisa
  {
    const b = edgesOf('Edificio España');
    if (b) {
      for (const e of b.edges) {
        const h = e.top - e.ground;
        kit.cornice('stone', e, e.top, 0.55, 0.8);
        if (h > 32) {
          kit.box('stone', e, 0, 1.1, e.ground + 30, e.top, 0, 0.12); // esquinas de piedra en la torre
          kit.box('stone', e, e.len - 1.1, e.len, e.ground + 30, e.top, 0, 0.12);
          kit.finials('stone', e, e.top, 6, 'vase', 1.2);
        } else {
          kit.band('granite', e, e.ground - 0.5, e.ground + 1.2, 0.2);
          kit.band('stone', e, e.ground + 6, e.ground + 6.6, 0.35);
        }
      }
      for (const p of b.parts) if (p.top - p.ground > 34) kit.cornerFinials('stone', p, 'pinnacle', 2.4);
    }
  }

  // --- Torre de Madrid (Otamendi, 1957; 142 m, 162 m con la antena)
  {
    const b = edgesOf('Torre de Madrid');
    if (b) {
      for (const e of b.edges) kit.band('stone', e, e.top - 0.6, e.top, 0.25);
      const t = tallest(b.parts);
      const g = new THREE.CylinderGeometry(0.25, 0.6, 20, 8);
      g.translate(t.cx, t.top + 10, t.cz);
      kit.push('iron', g);
      const g2 = new THREE.BoxGeometry(5, 3, 5);
      g2.translate(t.cx, t.top + 1.5, t.cz);
      kit.push('stone', g2);
    }
  }

  // --- Capitol / Carrión (Feduchi y Eced, 1933; 54 m): proa curva con "cuerpos volados de composición
  //     horizontal donde se alternan petos de granito pulido con bandas acristaladas"
  {
    const b = edgesOf('Edificio Carrión');
    if (b) {
      for (const e of b.edges) {
        for (let y = e.ground + 4.6; y < e.top - 1; y += 3.4) kit.band('stone', e, y, y + 1.4, 0.45, 0.1);
        kit.band('stone', e, e.top - 0.5, e.top, 0.3);
      }
    }
  }

  // --- Palacio de Cibeles (Palacios y Otamendi, 1907–1919): piedra blanca, crestería de pináculos,
  //     torre central octogonal de 70 m con reloj de unos 3 m
  {
    const b = edgesOf('Palacio de Cibeles');
    if (b) {
      for (const e of b.edges) {
        kit.band('granite', e, e.ground - 0.5, e.ground + 1.0, 0.15);
        kit.cornice('white', e, e.top, 0.6, 0.8);
        kit.finials('white', e, e.top, 2.8, 'pinnacle', 0.55);
      }
      const t = tallest(b.parts);
      const r = 0.2;
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        const face = new THREE.CylinderGeometry(1.5, 1.5, r, 24).rotateX(Math.PI / 2).rotateY(a);
        let dist = 3;
        for (let i = 0; i < t.data.pts.length; i += 2) dist = Math.max(dist, Math.abs((t.data.pts[i] - t.cx) * Math.sin(a) + (t.data.pts[i + 1] - t.cz) * Math.cos(a)));
        face.translate(t.cx + Math.sin(a) * (dist * 0.92 + 0.1), t.top - 6, t.cz + Math.cos(a) * (dist * 0.92 + 0.1));
        kit.push('white', face);
      }
    }
  }

  // --- Palacio Real (Sacchetti, 1738–1764): basamento almohadillado de granito, orden gigante de
  //     pilastras de piedra de Colmenar, gran cornisa y balaustrada con estatuas
  {
    const b = edgesOf('Palacio Real');
    if (b) {
      for (const e of b.edges) {
        if (e.top - e.ground < 12) continue;
        kit.band('granite', e, e.ground - 0.6, e.ground + 7.2, 0.3);
        kit.cornice('stone', e, e.ground + 7.8, 0.5, 0.6);
        kit.pilasters('stone', e, e.ground + 7.8, e.top - 2.6, 5.6, 1.0, 0.35);
        kit.cornice('stone', e, e.top - 1.3, 1.1, 1.3);
        kit.balustrade('stone', e, e.top - 1.3, 1.25, 5.6);
        kit.finials('stone', e, e.top - 0.05, 11.2, 'statue', 1.35);
      }
    }
  }

  // --- Clásicos con cornisa y balaustrada: Banco de España, Círculo de Bellas Artes, Teatro Real, Casino…
  for (const name of ['Banco de España', 'Círculo de Bellas Artes', 'Teatro Real', 'Casino de Madrid', 'Palacio del Congreso de los Diputados', 'Edificio Vitalicio']) {
    const b = edgesOf(name);
    if (!b) continue;
    for (const e of b.edges) {
      kit.band('granite', e, e.ground - 0.5, e.ground + 1.2, 0.2);
      kit.cornice('stone', e, e.top, 0.75, 0.9);
      if (name !== 'Teatro Real') kit.balustrade('stone', e, e.top, 1.0, 4.5);
    }
  }
  // Prado (Villanueva): ladrillo y granito, cornisa
  {
    const b = edgesOf('Edificio Villanueva');
    if (b) for (const e of b.edges) {
      kit.band('granite', e, e.ground - 0.5, e.ground + 1.5, 0.25);
      kit.cornice('stone', e, e.top, 0.8, 1.0);
      kit.pilasters('stone', e, e.ground + 1.5, e.top - 1, 6.5, 0.9, 0.25);
    }
  }

  // --- Plaza Mayor: soportales de granito en planta baja, balcones de forja y cubiertas de pizarra
  {
    const plaza = data.areas.find((a) => a.name === 'Plaza Mayor' && a.kind === 'plaza');
    if (plaza) {
      let pcx = 0, pcz = 0;
      for (let i = 0; i < plaza.pts.length; i += 2) { pcx += plaza.pts[i]; pcz += plaza.pts[i + 1]; }
      pcx /= plaza.pts.length / 2; pcz /= plaza.pts.length / 2;
      const ring = placed.filter((p) => Math.hypot(p.cx - pcx, p.cz - pcz) < 130);
      const front = ring.filter((p) => {
        for (let i = 0; i < p.data.pts.length; i += 2) {
          const x = p.data.pts[i], z = p.data.pts[i + 1];
          for (const [dx, dz] of [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) if (pointInRing(x + dx, z + dz, plaza.pts)) return true;
        }
        return false;
      });
      const edges = outerEdges(front, ring).filter((e) => {
        const [mx, mz] = mid(e);
        return pointInRing(mx + e.nx * 3, mz + e.nz * 3, plaza.pts);
      });
      for (const e of edges) {
        kit.box('shadow', e, 0, e.len, e.ground, e.ground + 4.3, 0, 0.04); // fondo de los soportales
        kit.pilasters('granite', e, e.ground - 0.3, e.ground + 4.3, 3.6, 0.75, 0.75);
        kit.band('granite', e, e.ground + 4.3, e.ground + 4.9, 0.78, 0);
        for (const fy of [4.9 + 0.5, 8.2 + 0.5, 11.5 + 0.5]) {
          if (e.ground + fy > e.top - 2) continue;
          const n = Math.max(1, Math.floor(e.len / 3.0));
          for (let k = 0; k < n; k++) {
            const u = (k + 0.5) * (e.len / n);
            kit.box('granite', e, u - 0.9, u + 0.9, e.ground + fy, e.ground + fy + 0.15, 0, 0.6);
            kit.box('iron', e, u - 0.9, u + 0.9, e.ground + fy + 0.15, e.ground + fy + 1.1, 0.55, 0.6);
          }
        }
        kit.cornice('granite', e, e.top, 0.45, 0.5);
      }
    }
  }

  return kit.build();
}
