import * as THREE from 'three';
import type { BuildingData } from '../realData';
import type { Ground } from '../roads';
import type { CollisionWorld } from '../collision';
import { Kit, type Opening } from '../arch';
import { type V2, type Landmark, ring, inPoly, frameOf, edgeNearest, Signs, type Extra, People, baseMats } from './common';

export function circulo(parts: BuildingData[], ground: Ground, collision: CollisionWorld, terrainH: (x: number, z: number) => number): Landmark {
  const main = parts.reduce((a, c) => (c.pts.length > a.pts.length ? c : a));
  const tower = parts.reduce((a, c) => (c.h > a.h ? c : a));
  const f = frameOf(main.pts, edgeNearest(main.pts, 592, -206));
  const W2 = (lx: number, lz: number): V2 => [f.ox + Math.cos(f.ang) * lx - Math.sin(f.ang) * lz, f.oz + Math.sin(f.ang) * lx + Math.cos(f.ang) * lz];
  const k = new Kit(f.ox, f.oz, f.ang, terrainH(...W2(f.L / 2, -1.5)) + 0.12, ground, collision);
  baseMats(k);
  k.std('stone', 0xe6dcc8, { roughness: 0.85 });
  k.std('stoneD', 0xcfc2a8, { roughness: 0.9 });
  k.std('marbleR', 0x8a3b32, { roughness: 0.3 });
  k.std('deck', 0x8a6a4a, { roughness: 0.8 });
  k.std('bronze', 0x5d4a2c, { roughness: 0.4, metalness: 0.8 });
  k.std('cushion', 0xe8e2d4, { roughness: 1 });
  k.std('plant', 0x3d6b35, { roughness: 0.9 });
  k.std('winDark', 0x20262c, { roughness: 0.3 });
  k.std('awning', 0xefe9dc, { roughness: 0.9, side: THREE.DoubleSide });
  const signs = new Signs(6);
  k.mat('signs', new THREE.MeshStandardMaterial({ map: signs.texture, emissive: 0xffffff, emissiveMap: signs.texture, emissiveIntensity: 0.5, side: THREE.DoubleSide }));
  const FL = 4.4;
  const near = (a: V2, c: V2, other: BuildingData) => {
    const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
    const r = ring(other.pts);
    for (let i = 0; i < r.length; i++) {
      const p = r[i], q = r[(i + 1) % r.length];
      const dx = q[0] - p[0], dz = q[1] - p[1], l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((mx - p[0]) * dx + (mz - p[1]) * dz) / l2));
      if (Math.hypot(p[0] + dx * t - mx, p[1] + dz * t - mz) < 0.6) return true;
    }
    return false;
  };
  const people: Extra[] = [];
  // ---- envolvente: cada parte con sus muros exteriores (las aristas compartidas no), ventanas y cornisa
  for (const part of parts) {
    const loc = ring(part.pts).map(([x, z]) => k.l(x, z));
    const a2 = loc.reduce((s, p, i) => { const q = loc[(i + 1) % loc.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
    const Hp = part.h;
    for (let i = 0; i < loc.length; i++) {
      const a = loc[a2 > 0 ? i : (i + 1) % loc.length], c = loc[a2 > 0 ? (i + 1) % loc.length : i];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 0.4) continue;
      const shared = parts.some((o) => o !== part && near(k.w(...a), k.w(...c), o) && o.h >= Hp - 0.5);
      if (shared) continue;
      const front = Math.abs(a[1]) < 1 && Math.abs(c[1]) < 1;
      const ops: Opening[] = [];
      const nW = Math.floor(len / 3.2);
      for (let fl = 1; fl < Math.floor(Hp / FL); fl++) for (let w = 0; w < nW; w++) {
        const sm = (len / nW) * (w + 0.5);
        ops.push({ s0: sm - 0.65, s1: sm + 0.65, y0: fl * FL + 0.6, y1: fl * FL + 3.2, frame: 'stoneD' });
      }
      if (!front) for (let w = 0; w < nW; w += 2) { const sm = (len / nW) * (w + 0.5); ops.push({ s0: sm - 0.8, s1: sm + 0.8, y0: 0.8, y1: 3.4, frame: 'stoneD' }); }
      k.wall(a[0], a[1], c[0], c[1], front ? FL : -3, Hp, 0.6, 'stone', ops);
      const dx = (c[0] - a[0]) / len, dz = (c[1] - a[1]) / len;
      for (const o of ops) {
        const sm = (o.s0 + o.s1) / 2;
        k.rbox(a[0] + dx * sm - dz * 0.65, (o.y0 + o.y1) / 2, a[1] + dz * sm + dx * 0.65, o.s1 - o.s0, o.y1 - o.y0, 0.05, Math.atan2(-dz, dx), 'winDark');
      }
      // orden gigante: pilastras entre ventanas de los pisos 1–4 y cornisa con balaustrada
      if (Hp > 15 && nW >= 1) for (let w = 0; w <= nW; w++) {
        const sm = (len / nW) * w;
        k.rbox(a[0] + dx * sm + dz * 0.1, FL + 8.5, a[1] + dz * sm - dx * 0.1, 0.7, 8.6, 0.35, Math.atan2(-dz, dx), 'stoneD');
      }
      k.wall(a[0], a[1], c[0], c[1], Hp - 0.6, Hp, 1.2, 'stoneD', [], false);
      k.wall(a[0], a[1], c[0], c[1], FL - 0.4, FL, 0.9, 'stoneD', [], false);
    }
    // cubierta de cada parte (la principal es la azotea, se hace aparte)
    if (part !== main) {
      const shape = new THREE.Shape(loc.map(([x, z]) => new THREE.Vector2(x, -z)));
      k.geo(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, Hp, 0), 'stoneD');
    }
  }
  // ---- torre: cuerpo escalonado y la Minerva
  {
    const tl = ring(tower.pts).map(([x, z]) => k.l(x, z));
    const cx = tl.reduce((s, p) => s + p[0], 0) / tl.length, cz = tl.reduce((s, p) => s + p[1], 0) / tl.length;
    const Ht = tower.h;
    k.box(cx - 3.2, Ht, cz - 3.2, cx + 3.2, Ht + 3, cz + 3.2, 'stone');
    k.box(cx - 2.4, Ht + 3, cz - 2.4, cx + 2.4, Ht + 5.5, cz + 2.4, 'stoneD');
    k.cyl(cx, cz, Ht + 5.5, Ht + 6.5, 1.5, 'stone', 16);
    // Minerva (bronce): túnica, torso, casco con penacho, lanza y escudo
    k.cyl(cx, cz, Ht + 6.5, Ht + 9.3, 0.75, 'bronze', 10, false, 0.45);
    k.cyl(cx, cz, Ht + 9.3, Ht + 10.6, 0.42, 'bronze', 10, false, 0.34);
    k.sphere(cx, Ht + 11.0, cz, 0.32, 'bronze', 10);
    k.box(cx - 0.05, Ht + 11.2, cz - 0.35, cx + 0.05, Ht + 11.7, cz + 0.35, 'bronze');
    k.cyl(cx + 0.8, cz, Ht + 6.5, Ht + 12.5, 0.05, 'bronze', 6);
    k.add(new THREE.CylinderGeometry(0.7, 0.7, 0.12, 16).rotateZ(Math.PI / 2).translate(cx - 0.7, Ht + 8.5, cz), 'bronze');
  }

  // ---- planta baja: vestíbulo, café y ascensores (dentro de la parte principal)
  const L = Math.min(f.L - 2, 30), D = Math.min(f.W - 2, 26);
  const X0 = 1, X1 = X0 + L;
  const slabT = 3.5;
  k.slab(X0, 0, X1, D, 0, slabT, 'dark');
  k.checker(X0 + 0.3, 0.3, X1 - 0.3, D - 0.3, 0.01, 0.8, 'marble', 'marbleR');
  // fachada de la planta baja a Alcalá: zócalo almohadillado y tres puertas en arco
  const doors: Opening[] = [{ s0: L / 2 - 1.6, s1: L / 2 + 1.6, y0: 0, y1: 3.9, frame: 'bronze', arch: true }];
  for (let w = 0; w < 3; w++) for (const sgn of [-1, 1]) { const sm = L / 2 + sgn * (4.5 + w * 4.2); if (sm > 1.5 && sm < L - 1.5) doors.push({ s0: sm - 1.4, s1: sm + 1.4, y0: 0.9, y1: 3.6, frame: 'bronze', glass: true, arch: true }); }
  k.wall(X0, 0, X1, 0, -3, FL, 0.6, 'stoneD', doors);
  for (let y = 0.6; y < FL - 0.4; y += 0.6) k.box(X0, y - 0.04, -0.06, X1, y, 0.02, 'stone');
  const cba = signs.add('CÍRCULO DE BELLAS ARTES', '#e6dcc8', '#3a2e22', '700 36px Georgia, serif');
  k.geo(signs.plane(cba, 9, 0.7).rotateY(Math.PI).translate(X0 + L / 2, FL + 0.6, -0.65), 'signs');
  // muros interiores de la planta baja
  k.wall(X0, D, X0, 0, -3, FL, 0.3, 'stone');
  k.wall(X1, 0, X1, D, -3, FL, 0.3, 'stone');
  k.wall(X1, D, X0, D, -3, FL, 0.3, 'stone');
  k.box(X0, FL - 0.3, 0, X1, FL, D, 'stone');
  collision.add({ kind: 'quad', p: [k.w(X0, 0), k.w(X1, 0), k.w(X1, D), k.w(X0, D)].flat(), h: k.y0 + FL + 0.2, y0: k.y0 + FL - 0.35 });
  // el café (a la izquierda, con ventanas a Alcalá) separado del vestíbulo por columnas
  const CX1 = X0 + L / 2 - 3.5;
  for (let z = 2; z < D - 1; z += 3.2) k.cyl(CX1, z, 0, FL - 0.3, 0.28, 'marble', 12, true);
  for (let x = X0 + 2; x < CX1 - 1; x += 1.9) for (let z = 2.2; z < D - 4; z += 2.2) {
    k.roundTable(x, z, 0.01, 'marble', 'iron');
    k.chair(x + 0.5, z, 0.01, -Math.PI / 2, 'woodDark');
    if (((x * 7 + z * 3) | 0) % 3 === 0) people.push({ x: x + 0.55, z, y: 0.01, heading: -Math.PI / 2, action: 'sit', prop: 'coffee' });
  }
  for (const x of [X0 + 3, (X0 + CX1) / 2, CX1 - 2]) for (const z of [D / 3, (2 * D) / 3]) {
    k.cyl(x, z, FL - 1.3, FL - 0.3, 0.02, 'brass', 4);
    for (let a = 0; a < 6; a++) k.sphere(x + Math.cos(a) * 0.5, FL - 1.35, z + Math.sin(a) * 0.5, 0.1, 'glowWarm', 6);
  }
  // barra del café al fondo
  k.box(X0 + 1, 0, D - 3.2, CX1 - 1, 1.1, D - 2.6, 'woodDark', true);
  k.box(X0 + 0.95, 1.1, D - 3.25, CX1 - 0.95, 1.16, D - 2.55, 'marble');
  people.push({ x: (X0 + CX1) / 2, z: D - 1.9, y: 0.01, heading: Math.PI, action: 'arms', prop: 'none', look: { shirt: 0xf2efe8, pants: 0x151515 }, name: 'Benito',
    offer: { text: 'un café en el Círculo', price: 2.8, heal: 20, reply: ['Café del Círculo, como en los tiempos de Valle-Inclán.', 'Con su vasito de agua.'] },
    lines: ['Por aquí ha pasado medio Madrid de la cultura.', 'La azotea se sube por los ascensores del vestíbulo.'] });
  // vestíbulo: escalera de honor (arranque) y mostrador de entradas
  const VX = X0 + L / 2 + 2;
  k.stairs(VX + 2, D - 9, VX + 6.5, D - 1, 0, 2.2, 'marble', true);
  k.box(VX + 2, 2.2, D - 1, VX + 6.5, 2.35, D - 0.4, 'marble');
  k.box(VX + 1.85, 0, D - 9, VX + 2, 3.0, D - 0.4, 'brass');
  k.box(VX + 6.5, 0, D - 9, VX + 6.65, 3.0, D - 0.4, 'brass');
  k.box(VX + 2, 2.35, D - 0.5, VX + 6.5, FL - 0.3, D - 0.35, 'woodDark'); // puerta cerrada al rellano
  k.box(VX, 0, 6, VX + 4, 1.1, 7, 'woodDark', true);
  people.push({ x: VX + 2, z: 7.6, y: 0.01, heading: Math.PI, action: 'look', prop: 'none', name: 'Gloria', look: { shirt: 0x2c2c34 },
    lines: ['La azotea abre hasta la una. Los ascensores, a la derecha.', 'Hoy hay exposición en la Sala Picasso.', 'La Minerva mide más de seis metros, ¿sabías?'] });

  // ---- ascensor: hueco del suelo a la azotea, cabina que sube y baja
  const top = main.h;
  const EX0 = X1 - 3.4, EX1 = X1 - 0.6, EZ0 = 3, EZ1 = 5.8;
  k.wall(EX0, EZ1, EX0, EZ0, 0, top + 2.8, 0.15, 'stoneD', [{ s0: 0.6, s1: 2.2, y0: 0, y1: 2.3, frame: 'brass' }, { s0: 0.6, s1: 2.2, y0: top, y1: top + 2.3, frame: 'brass' }]);
  k.wall(EX0, EZ0, EX1, EZ0, 0, top + 2.8, 0.15, 'stoneD');
  k.wall(EX1, EZ1, EX0, EZ1, 0, top + 2.8, 0.15, 'stoneD');
  k.box(EX0, top + 2.8, EZ0, EX1, top + 3.0, EZ1, 'stoneD');
  k.walk(EX0, EZ0, EX1, EZ1, 0.02);
  k.walk(EX0, EZ0, EX1, EZ1, top + 0.02);
  const car = new THREE.Group();
  const carMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.4, metalness: 0.6 });
  const carFloor = new THREE.Mesh(new THREE.BoxGeometry(EX1 - EX0 - 0.2, 0.12, EZ1 - EZ0 - 0.2), carMat);
  const carRoof = carFloor.clone(); carRoof.position.y = 2.6;
  car.add(carFloor, carRoof);
  car.position.set((EX0 + EX1) / 2, -0.04, (EZ0 + EZ1) / 2);
  const lift = { y: 0, target: 0, moving: false };
  const ascSign = signs.add('ASCENSORES · AZOTEA', '#2c2c34', '#e2c06a', '700 30px Georgia, serif');
  k.geo(signs.plane(ascSign, 3.2, 0.4).rotateY(-Math.PI / 2).translate(EX0 - 0.1, 2.7, (EZ0 + EZ1) / 2), 'signs');

  // ---- azotea sobre la parte principal: tarima, barandilla de vidrio, bar, mesas, sofás y sombrillas
  const RX0 = X0, RX1 = X1, RZ0 = 0.6, RZ1 = D;
  k.slab(RX0, RZ0, RX1, RZ1, top, 0.4, 'deck', true);
  const mloc = ring(main.pts).map(([x, z]) => k.l(x, z));
  k.geo(new THREE.ShapeGeometry(new THREE.Shape(mloc.map(([x, z]) => new THREE.Vector2(x, -z)))).rotateX(-Math.PI / 2).translate(0, top - 0.05, 0), 'stoneD');
  for (const [ax, az, bx, bz] of [[RX0, RZ0, RX1, RZ0], [RX1, RZ0, RX1, RZ1], [RX1, RZ1, RX0, RZ1], [RX0, RZ1, RX0, RZ0]]) {
    k.wall(ax, az, bx, bz, top, top + 1.15, 0.05, 'glass', [], true);
    k.box(Math.min(ax, bx) - 0.04, top + 1.12, Math.min(az, bz) - 0.04, Math.max(ax, bx) + 0.04, top + 1.18, Math.max(az, bz) + 0.04, 'steel');
  }
  // bar de la azotea
  k.box(RX0 + 3, top, RZ1 - 4, RX0 + 12, top + 1.1, RZ1 - 3.3, 'woodDark', true);
  k.box(RX0 + 2.95, top + 1.1, RZ1 - 4.05, RX0 + 12.05, top + 1.16, RZ1 - 3.25, 'marble');
  for (let i = 0; i < 20; i++) k.cyl(RX0 + 3.4 + i * 0.42, RZ1 - 1.2, top + 1.2 + (i % 2) * 0.5, top + 1.5 + (i % 2) * 0.5, 0.04, i % 3 ? 'winDark' : 'brass', 6);
  k.box(RX0 + 3, top + 1.15, RZ1 - 1.4, RX0 + 12, top + 1.19, RZ1 - 1.0, 'woodDark');
  k.box(RX0 + 3, top + 1.65, RZ1 - 1.4, RX0 + 12, top + 1.69, RZ1 - 1.0, 'woodDark');
  people.push({ x: RX0 + 7.5, z: RZ1 - 2.4, y: top, heading: Math.PI, action: 'arms', prop: 'none', look: { shirt: 0x16181c }, name: 'Dani',
    offer: { text: 'un vermut con vistas', price: 6, heal: 20, reply: ['Mira qué atardecer sobre Gran Vía.', 'Aquí tienes. Las vistas van incluidas.'] },
    lines: ['Desde aquí se ven el Metrópolis, la Gran Vía y hasta la sierra si está despejado.', '¿Ves la Minerva? Protege la ciudad, dicen.'] });
  // mesas, sombrillas, sofás y jardineras
  for (let x = RX0 + 3; x < RX1 - 2; x += 3.2) for (const z of [RZ0 + 2.5, RZ0 + 6.5, RZ0 + 10.5]) {
    if (z > RZ1 - 6) continue;
    k.roundTable(x, z, top, 'marble', 'iron', 0.4);
    k.chair(x - 0.6, z, top, Math.PI / 2, 'iron'); k.chair(x + 0.6, z, top, -Math.PI / 2, 'iron');
    k.cyl(x, z, top + 0.76, top + 2.6, 0.03, 'steel', 6);
    k.add(new THREE.ConeGeometry(1.4, 0.5, 8, 1, true).translate(x, top + 2.6, z), 'awning');
    if (((x + z) | 0) % 2) people.push({ x: x + 0.65, z, y: top, heading: -Math.PI / 2, action: 'sit', prop: ((x | 0) % 3) ? 'beer' : 'coffee' });
  }
  for (let x = RX0 + 14; x < RX1 - 3; x += 4) {
    k.box(x, top, RZ1 - 2.2, x + 3, top + 0.4, RZ1 - 1.2, 'woodDark');
    k.box(x, top + 0.4, RZ1 - 2.2, x + 3, top + 0.55, RZ1 - 1.2, 'cushion');
    k.box(x, top + 0.55, RZ1 - 1.4, x + 3, top + 1.0, RZ1 - 1.2, 'cushion');
  }
  for (let x = RX0 + 1; x < RX1 - 1; x += 3) { k.box(x, top, RZ0 + 0.2, x + 1.2, top + 0.6, RZ0 + 0.7, 'woodDark'); k.sphere(x + 0.6, top + 0.85, RZ0 + 0.45, 0.45, 'plant', 6); }
  for (let i = 0; i < 6; i++) people.push({ x: RX0 + 4 + i * 3.6, z: RZ0 + 1.3, y: top, heading: Math.PI, action: i % 2 ? 'drink' : 'phone', prop: i % 2 ? 'beer' : 'phone' });

  const g = k.finish();
  g.add(car);
  const ppl = new People(g, people, k);
  const hallPoly = [k.w(X0, 0), k.w(X1, 0), k.w(X1, D), k.w(X0, D)].flat();
  const inCar = (p: THREE.Vector3) => { const [lx, lz] = k.l(p.x, p.z); return lx > EX0 && lx < EX1 && lz > EZ0 && lz < EZ1; };
  // puntos de la azotea en coordenadas del mapa (para las misiones)
  const [rcx, rcz] = k.w((RX0 + RX1) / 2, (RZ0 + RZ1) / 2);
  const [rax, raz] = k.w(RX0 + 2.5, RZ0 + 3.5), [rbx, rbz] = k.w(RX1 - 2.5, RZ0 + 3.5), [rdx, rdz] = k.w(RX1 - 4, RZ1 - 4.5);
  const [rbarx, rbarz] = k.w(RX0 + 7.5, RZ1 - 5);
  const [rlx, rlz] = k.w((EX0 + EX1) / 2, (EZ0 + EZ1) / 2);
  return {
    name: 'Círculo de Bellas Artes', group: g, footprint: main.pts, floor: k.y0, fill: 0.6,
    meta: { EX0, EX1, EZ0, EZ1, top, L, roofY: k.y0 + top, rcx, rcz, rax, raz, rbx, rbz, rdx, rdz, rbarx, rbarz, rlx, rlz },
    inside: (x, z, y) => inPoly(hallPoly, x, z) && ((y > k.y0 - 1 && y < k.y0 + FL) || (y > k.y0 + top - 0.5 && y < k.y0 + top + 3)),
    update: (dt, p) => {
      ppl.update(dt, Math.hypot(p.x - f.ox, p.z - f.oz) < 120);
      if (lift.moving) {
        const d = lift.target - lift.y, step = Math.sign(d) * Math.min(Math.abs(d), dt * 3.2);
        lift.y += step;
        if (Math.abs(lift.target - lift.y) < 0.01) { lift.y = lift.target; lift.moving = false; }
        car.position.y = lift.y - 0.04;
      }
    },
    npcNear: (p) => ppl.near(p),
    action: (p) => {
      if (lift.moving || !inCar(p)) return null;
      const up = lift.y < 1;
      return { text: up ? 'Subir a la azotea' : 'Bajar al vestíbulo', run: () => { lift.target = up ? top : 0; lift.moving = true; } };
    },
    floorAt: (p) => (lift.moving && inCar(p) ? k.y0 + lift.y + 0.02 : null),
  };
}

// ------------------------------------------------------------------ registro
