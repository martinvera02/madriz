import * as THREE from 'three';
import type { BuildingData } from '../realData';
import type { Ground } from '../roads';
import type { CollisionWorld } from '../collision';
import { Kit } from '../arch';
import { type V2, type Landmark, type Offer, ring, inPoly, frameOf, edgeNearest, Signs, type Extra, People, baseMats } from './common';

export function sanGines(b: BuildingData, ground: Ground, collision: CollisionWorld, terrainH: (x: number, z: number) => number): Landmark {
  const f = frameOf(b.pts, edgeNearest(b.pts, -262, -42));
  let tMax = -Infinity, tMin = Infinity;
  for (let i = 0; i < b.pts.length; i += 2) { const h = terrainH(b.pts[i], b.pts[i + 1]); tMax = Math.max(tMax, h); tMin = Math.min(tMin, h); }
  // el suelo del local, a la altura del pasadizo en la puerta principal (el pasadizo es una cuesta)
  const doorW = (lx: number, lz: number): V2 => [f.ox + Math.cos(f.ang) * lx - Math.sin(f.ang) * lz, f.oz + Math.sin(f.ang) * lx + Math.cos(f.ang) * lz];
  const k = new Kit(f.ox, f.oz, f.ang, terrainH(...doorW(3.6, -0.8)) + 0.12, ground, collision);
  void tMax;
  baseMats(k);
  k.std('greenWood', 0x1f4a35, { roughness: 0.5 });
  k.std('velvet', 0x24583f, { roughness: 0.95 });
  k.std('cream', 0xe8dcc0, { roughness: 0.9, side: THREE.DoubleSide });
  k.std('blackTile', 0x1c1c1e, { roughness: 0.3 }); k.std('whiteTile', 0xeeeae2, { roughness: 0.3 });
  k.std('mirror', 0xaeb9bd, { roughness: 0.12, metalness: 0.35, emissive: 0x2b3236 });
  k.std('gilt', 0xc9a24f, { roughness: 0.3, metalness: 0.85 });
  k.std('brick', 0x9a5a3c, { roughness: 0.95, side: THREE.DoubleSide });
  k.std('tileW', 0xf1f1ec, { roughness: 0.25 });
  k.std('choco', 0x3b2014, { roughness: 0.3 });
  k.std('churro', 0xd29a4b, { roughness: 0.7 });
  k.std('oil', 0xb9862a, { roughness: 0.1, metalness: 0.3 });
  k.std('cup', 0xf4f1ea, { roughness: 0.4 });
  k.std('roofTile', 0x8e4a33, { roughness: 0.9 });
  k.std('winDark', 0x20262c, { roughness: 0.3 });
  const signs = new Signs(6);
  k.mat('signs', new THREE.MeshStandardMaterial({ map: signs.texture, emissive: 0xffffff, emissiveMap: signs.texture, emissiveIntensity: 0.3, side: THREE.DoubleSide }));

  // ---- envolvente del edificio entero sobre su planta real (la chocolatería ocupa la esquina del pasadizo)
  const H = b.h || 17.5, FL = 3.6;
  const loc = ring(b.pts).map(([x, z]) => k.l(x, z));
  const area2 = loc.reduce((s, p, i) => { const q = loc[(i + 1) % loc.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  const SHOP = { x0: 1.2, x1: 15.2, z0: 0, z1: 13 };
  // planta baja del resto, plantas altas y cubierta
  for (let i = 0; i < loc.length; i++) {
    const a = loc[area2 > 0 ? i : (i + 1) % loc.length], c = loc[area2 > 0 ? (i + 1) % loc.length : i];
    // muro hacia dentro: el kit pone el grosor a la izquierda de a→b; con la planta en sentido antihorario es el interior
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 0.3) continue;
    const ops: { s0: number; s1: number; y0: number; y1: number; frame?: string; glass?: boolean }[] = [];
    const nWin = Math.floor(len / 2.6);
    for (let fl = 1; fl < Math.floor(H / FL); fl++) {
      for (let w = 0; w < nWin; w++) {
        const s = (len / nWin) * (w + 0.5);
        ops.push({ s0: s - 0.55, s1: s + 0.55, y0: fl * FL + 0.4, y1: fl * FL + 2.6, frame: 'woodDark' });
      }
    }
    // el escaparate de la chocolatería se hace aparte: aquí, en la planta baja, el resto de locales y portales cerrados
    const onFront = Math.abs(a[1]) < 0.6 && Math.abs(c[1]) < 0.6;
    if (!onFront) {
      for (let w = 0; w < nWin; w += 2) { const s = (len / nWin) * (w + 0.5); ops.push({ s0: s - 0.7, s1: s + 0.7, y0: 0.4, y1: 2.8, frame: 'woodDark' }); }
    }
    k.wall(a[0], a[1], c[0], c[1], onFront ? FL : tMin - k.y0 - 0.2, H, 0.45, 'stucco', ops.filter((o) => o.y0 >= (onFront ? FL : -99)));
    // persianas/fondo oscuro tras las ventanas de los pisos (no se ve un edificio hueco)
    const dx = (c[0] - a[0]) / len, dz = (c[1] - a[1]) / len;
    for (const o of ops) {
      const s = (o.s0 + o.s1) / 2;
      const px = a[0] + dx * s - dz * 0.5, pz = a[1] + dz * s + dx * 0.5;
      k.rbox(px, (o.y0 + o.y1) / 2, pz, o.s1 - o.s0, o.y1 - o.y0, 0.05, Math.atan2(-dz, dx), 'winDark');
      // balcón de forja en cada ventana de los pisos
      if (o.y0 > FL) {
        const bx = a[0] + dx * s + dz * 0.35, bzz = a[1] + dz * s - dx * 0.35;
        k.rbox(bx, o.y0 - 0.05, bzz, o.s1 - o.s0 + 0.4, 0.1, 0.7, Math.atan2(-dz, dx), 'granite');
        k.rbox(bx + dz * 0.32, o.y0 + 0.45, bzz - dx * 0.32, o.s1 - o.s0 + 0.4, 0.9, 0.03, Math.atan2(-dz, dx), 'iron');
      }
    }
    // cornisa
    k.wall(a[0], a[1], c[0], c[1], H - 0.4, H - 0.1, 0.8, 'granite', [], false);
  }
  // fachada al pasadizo en la planta baja: el resto (fuera de la chocolatería), cerrado
  if (f.L > SHOP.x1 + 0.5) k.wall(SHOP.x1, 0, f.L, 0, tMin - k.y0 - 0.2, FL, 0.45, 'stucco', [{ s0: 1, s1: 2.6, y0: 0, y1: 2.7, frame: 'woodDark' }, { s0: 4, s1: 7, y0: 0.4, y1: 2.8, frame: 'woodDark' }]);
  if (SHOP.x0 > 0.2) k.wall(0, 0, SHOP.x0, 0, tMin - k.y0 - 0.2, FL, 0.45, 'stucco');
  // cubierta: forjado plano sobre la planta y faldón de teja perimetral
  const shape = new THREE.Shape(loc.map(([x, z]) => new THREE.Vector2(x, -z)));
  k.geo(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, H, 0), 'roofTile');
  collision.add({ kind: 'quad', p: [k.w(0, 0), k.w(f.L, 0), k.w(f.L, f.W), k.w(0, f.W)].flat(), h: k.y0 + H + 0.3, y0: k.y0 + FL - 0.4 });

  // ---- el local
  const { x0: X0, x1: X1, z1: Z1 } = SHOP;
  const CEIL = 3.6;
  // losa de la planta baja: gruesa para que el terreno quede dentro; hueco de la escalera
  const slabBottom = -0.9; // el terreno de dentro se rebaja por debajo de esta cota (cutTerrain)
  const ST = { x0: X0 + 0.25, x1: X0 + 2.05, z0: 8.4, z1: 12.8 };
  k.slab(X0, 0, X1, ST.z0, 0, -slabBottom, 'dark');
  k.slab(X0, ST.z1, X1, Z1, 0, -slabBottom, 'dark');
  k.slab(ST.x1, ST.z0, X1, ST.z1, 0, -slabBottom, 'dark');
  k.checker(X0 + 0.25, 0.25, X1 - 0.25, 8, 0.01, 0.5, 'blackTile', 'whiteTile');
  k.checker(ST.x1, 8, X1 - 0.25, Z1 - 0.25, 0.01, 0.3, 'tileW', 'whiteTile');
  // techo del salón con su moldura
  k.box(X0, CEIL, 0, X1, CEIL + 0.2, Z1, 'cream');
  collision.add({ kind: 'quad', p: [k.w(X0, 0), k.w(X1, 0), k.w(X1, Z1), k.w(X0, Z1)].flat(), h: k.y0 + CEIL + 0.3, y0: k.y0 + CEIL - 0.05 });
  for (const [ax, az, bx, bzz] of [[X0, 0.25, X1, 0.25], [X0, 7.95, X1, 7.95], [X0 + 0.25, 0, X0 + 0.25, 8], [X1 - 0.25, 0, X1 - 0.25, 8]]) {
    k.box(Math.min(ax, bx) - 0.08, CEIL - 0.22, Math.min(az, bzz) - 0.08, Math.max(ax, bx) + 0.08, CEIL, Math.max(az, bzz) + 0.08, 'gilt');
  }

  // fachada de madera verde al pasadizo: dos puertas acristaladas y dos escaparates
  const front = [
    { s0: 1.6, s1: 3.2, y0: 0, y1: 2.85, frame: 'greenWood', glass: false },
    { s0: 4.0, s1: 7.4, y0: 0.7, y1: 2.85, frame: 'greenWood', glass: true },
    { s0: 8.2, s1: 11.6, y0: 0.7, y1: 2.85, frame: 'greenWood', glass: true },
    { s0: 12.2, s1: 13.8, y0: 0, y1: 2.85, frame: 'greenWood', glass: false },
  ];
  k.wall(X0, 0, X1, 0, slabBottom - 3.6, FL, 0.45, 'greenWood', front);
  // pilastras, zócalo y rótulo dorado
  for (const s of [0, 3.6, 7.8, 11.9, X1 - X0]) k.box(X0 + s - 0.18, 0, -0.12, X0 + s + 0.18, 3.25, 0.02, 'greenWood');
  k.box(X0 - 0.1, 3.0, -0.18, X1 + 0.1, 3.6, 0.02, 'greenWood');
  const sg = signs.add('CHOCOLATERÍA SAN GINÉS', '#1f4a35', '#e2c06a', '700 36px Georgia, serif', '#c9a24f');
  k.geo(signs.plane(sg, 9, 0.5).rotateY(Math.PI).translate((X0 + X1) / 2, 3.3, -0.19), 'signs');
  const since = signs.add('DESDE 1894', '#1f4a35', '#e2c06a', 'italic 700 34px Georgia, serif');
  for (const s of [2.4, 13]) k.geo(signs.plane(since, 1.6, 0.24).rotateY(Math.PI).translate(X0 + s, 2.98, -0.15), 'signs');
  // faroles del pasadizo junto a la puerta
  for (const s of [0.8, X1 - X0 - 0.8]) { k.box(X0 + s - 0.05, 2.6, -0.5, X0 + s + 0.05, 2.65, 0, 'iron'); k.box(X0 + s - 0.12, 2.3, -0.62, X0 + s + 0.12, 2.6, -0.38, 'glowWarm'); }

  // muros laterales del local y tabique del fondo del salón (con pasos a la escalera, los aseos y la cocina)
  k.wall(X0, Z1, X0, 0, slabBottom - 3.6, CEIL, 0.25, 'cream');
  k.wall(X1, 0, X1, Z1, slabBottom - 3.6, CEIL, 0.25, 'cream');
  k.wall(X1, Z1, X0, Z1, slabBottom - 3.6, CEIL, 0.25, 'cream');
  k.wall(X0, 8, X1, 8, 0, CEIL, 0.18, 'cream', [
    { s0: 0.3, s1: 2.1, y0: 0, y1: 2.6, frame: 'woodDark', arch: true },
    { s0: 5.0, s1: 6.0, y0: 0, y1: 2.2, frame: 'woodDark' },
    { s0: 12.4, s1: 13.4, y0: 0, y1: 2.2, frame: 'woodDark' },
  ]);
  // zócalo de madera, espejos con marco dorado y bancadas de terciopelo verde en los laterales
  for (const [x, dir] of [[X0 + 0.25, 1], [X1 - 0.25, -1]] as [number, number][]) {
    k.box(Math.min(x, x + dir * 0.05), 0, 0.3, Math.max(x, x + dir * 0.05), 1.1, 7.9, 'woodDark');
    for (let m = 0; m < 3; m++) {
      const z0 = 0.6 + m * 2.45, z1 = z0 + 2.1;
      k.box(Math.min(x, x + dir * 0.06), 1.3, z0, Math.max(x, x + dir * 0.06), 2.9, z1, 'gilt');
      k.box(Math.min(x, x + dir * 0.07), 1.38, z0 + 0.08, Math.max(x, x + dir * 0.07), 2.82, z1 - 0.08, 'mirror');
    }
    // bancada corrida con respaldo
    k.box(Math.min(x, x + dir * 0.55), 0, 0.6, Math.max(x, x + dir * 0.55), 0.45, 7.7, 'woodDark', true);
    k.box(Math.min(x, x + dir * 0.55), 0.45, 0.6, Math.max(x, x + dir * 0.55), 0.52, 7.7, 'velvet');
    k.box(Math.min(x, x + dir * 0.14), 0.52, 0.6, Math.max(x, x + dir * 0.14), 1.05, 7.7, 'velvet');
  }
  // barra de mármol frente a la cocina, con su vitrina de porras, tazas y la cafetera
  const BX0 = 9.6, BX1 = X1 - 1.1, BZ = 6.5;
  k.box(BX0, 0, BZ, BX1, 1.05, BZ + 0.6, 'woodDark', true);
  k.box(BX0 - 0.05, 1.05, BZ - 0.05, BX1 + 0.05, 1.1, BZ + 0.65, 'marble');
  k.box(BX0 + 0.3, 1.1, BZ + 0.15, BX0 + 2.4, 1.45, BZ + 0.5, 'glass');
  for (let i = 0; i < 10; i++) k.add(new THREE.CapsuleGeometry(0.025, 0.22, 2, 6).rotateZ(Math.PI / 2).translate(BX0 + 0.5 + (i % 5) * 0.38, 1.14 + Math.floor(i / 5) * 0.06, BZ + 0.3 + (i % 2) * 0.08), 'churro');
  for (let i = 0; i < 6; i++) { const x = BX0 + 3 + i * 0.35; k.cyl(x, BZ + 0.2, 1.1, 1.2, 0.05, 'cup', 10); k.cyl(x, BZ + 0.2, 1.19, 1.2, 0.045, 'choco', 10); }
  k.box(BX1 - 1.2, 1.1, BZ + 0.2, BX1 - 0.3, 1.65, BZ + 0.6, 'steel');
  // estantes con espejo tras la barra
  k.box(BX0, 1.4, 7.75, BX1, 2.7, 7.8, 'mirror');
  for (const y of [1.6, 2.1, 2.6]) k.box(BX0, y, 7.55, BX1, y + 0.04, 7.8, 'woodDark');
  for (let i = 0; i < 14; i++) k.cyl(BX0 + 0.3 + i * 0.32, 7.66, 1.64 + (i % 2) * 0.5, 1.9 + (i % 2) * 0.5, 0.035, i % 3 ? 'cup' : 'brass', 6);
  // veladores de mármol con sillas
  const people: Extra[] = [];
  const tables: V2[] = [];
  for (const z of [1.5, 3.4, 5.3]) for (const x of [X0 + 1.3, X0 + 3.3, X0 + 5.3, X0 + 7.3]) tables.push([x, z]);
  for (const z of [1.5, 3.4]) for (const x of [X1 - 1.3, X1 - 3.2, X1 - 5.1]) tables.push([x, z]);
  for (const [x, z] of tables) {
    k.roundTable(x, z, 0.01, 'marble', 'iron');
    const nearWall = x < X0 + 1.5 || x > X1 - 1.5;
    k.cyl(x, z, 0.77, 0.85, 0.045, 'cup', 10); k.cyl(x, z, 0.84, 0.85, 0.04, 'choco', 10);
    k.add(new THREE.CapsuleGeometry(0.02, 0.18, 2, 6).rotateZ(Math.PI / 2).translate(x + 0.15, 0.79, z), 'churro');
    if (!nearWall) k.chair(x - 0.55, z, 0.01, Math.PI / 2, 'woodDark');
    k.chair(x + (x < (X0 + X1) / 2 ? 0.55 : -0.55), z, 0.01, x < (X0 + X1) / 2 ? -Math.PI / 2 : Math.PI / 2, 'woodDark');
    if (Math.random() < 0.6) people.push({ x: x + (x < (X0 + X1) / 2 ? 0.6 : -0.6), z, y: 0.01, heading: x < (X0 + X1) / 2 ? -Math.PI / 2 : Math.PI / 2, action: 'sit', prop: Math.random() < 0.5 ? 'coffee' : 'none' });
  }
  // lámparas: tres arañas de latón con globos
  for (const x of [X0 + 3.5, (X0 + X1) / 2, X1 - 3.5]) {
    k.cyl(x, 4, CEIL - 0.7, CEIL, 0.02, 'brass', 4);
    for (let a = 0; a < 5; a++) k.sphere(x + Math.cos((a / 5) * 6.28) * 0.4, CEIL - 0.8, 4 + Math.sin((a / 5) * 6.28) * 0.4, 0.09, 'glowWarm', 8);
    k.cyl(x, 4, CEIL - 0.82, CEIL - 0.78, 0.45, 'brass', 12);
  }
  // camareros
  const choco: Offer = { text: 'chocolate con churros', price: 4.8, heal: 60, reply: ['Seis churros y su chocolate, bien espeso.', 'Marchando una de churros. ¡Cuidado, que quema!', 'Si prefieres porras, me lo dices.'] };
  people.push({ x: 11.5, z: 7.2, y: 0.01, heading: Math.PI, action: 'arms', prop: 'none', look: { shirt: 0xf2efe8, pants: 0x151515 }, name: 'Julián', offer: choco,
    lines: ['Desde 1894 haciendo churros, chaval.', 'A las seis de la mañana esto está lleno de gente que sale de fiesta.'] });
  people.push({ x: 6.2, z: 4.2, y: 0.01, heading: 0.4, action: 'look', prop: 'coffee', look: { shirt: 0xf2efe8, pants: 0x151515 }, name: 'Encarna', offer: choco,
    lines: ['Siéntate donde quieras, que ahora voy.', 'Abajo hay más sitio, en el sótano.'] });

  // ---- obrador: azulejo blanco, la churrera y el perol de aceite
  const KX0 = 12.4, KZ0 = 8.2;
  k.box(KX0, 0.02, KZ0, X1 - 0.25, 2.0, KZ0 + 0.04, 'tileW');
  k.cyl(KX0 + 1.0, 11.2, 0.01, 0.9, 0.62, 'steel', 18, true);
  k.cyl(KX0 + 1.0, 11.2, 0.88, 0.9, 0.55, 'oil', 18);
  // la rueda de churro en espiral dentro del aceite
  const pts: THREE.Vector3[] = [];
  for (let a = 0; a < 6 * Math.PI; a += 0.2) pts.push(new THREE.Vector3(KX0 + 1.0 + Math.cos(a) * (0.08 + a * 0.022), 0.92, 11.2 + Math.sin(a) * (0.08 + a * 0.022)));
  k.geo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.028, 6), 'churro');
  k.box(KX0 + 0.3, 2.2, 10.4, KX0 + 1.8, 2.5, 12.0, 'steel'); // campana
  k.box(KX0 + 0.5, 2.5, 11.0, KX0 + 0.9, CEIL, 11.4, 'steel');
  k.box(X1 - 1.0, 0.01, 8.6, X1 - 0.3, 0.92, 12.6, 'steel', true); // mesa de trabajo
  k.box(X1 - 0.9, 0.92, 9.0, X1 - 0.4, 1.3, 9.5, 'steel'); // la máquina de masa
  for (let i = 0; i < 8; i++) k.add(new THREE.CapsuleGeometry(0.03, 0.3, 2, 6).rotateX(Math.PI / 2).translate(X1 - 0.65, 0.97, 10 + i * 0.3), 'churro');
  k.wall(KX0, 8, KX0, Z1, 0, CEIL, 0.15, 'tileW', [{ s0: 0.4, s1: 1.3, y0: 0, y1: 2.2, frame: 'steel' }]);
  people.push({ x: KX0 + 1.9, z: 11.2, y: 0.01, heading: -Math.PI / 2, action: 'arms', prop: 'none', look: { shirt: 0xf6f6f2 }, name: 'Rufino',
    lines: ['Aquí no se pasa, que el aceite está a 200 grados.', 'La masa: harina, agua y sal. Ni más ni menos.', 'La rueda se corta con tijeras, así salen los churros.'] });

  // ---- aseos: dos cabinas desde el pasillo
  const AX0 = X0 + 2.4, AX1 = X0 + 4.9;
  k.wall(AX0, 8, AX0, Z1, 0, CEIL, 0.12, 'tileW');
  k.wall(AX1, Z1, AX1, 8, 0, CEIL, 0.12, 'tileW', [{ s0: 0.6, s1: 1.4, y0: 0, y1: 2.1, frame: 'woodDark' }, { s0: 2.9, s1: 3.7, y0: 0, y1: 2.1, frame: 'woodDark' }]);
  k.wall(AX0, 10.5, AX1, 10.5, 0, CEIL, 0.1, 'tileW');
  for (const z of [9.2, 11.8]) {
    k.box(AX0 + 0.2, 0.01, z - 0.25, AX0 + 0.75, 0.45, z + 0.25, 'cup', true);
    k.box(AX0 + 0.15, 0.45, z - 0.3, AX0 + 0.35, 0.9, z + 0.3, 'cup');
    k.box(AX1 - 0.6, 0.8, z - 0.3, AX1 - 0.15, 0.9, z + 0.3, 'marble');
    k.box(AX1 - 0.15, 1.2, z - 0.35, AX1 - 0.12, 1.9, z + 0.35, 'mirror');
  }

  // ---- escalera al sótano y salón abovedado
  const BF = slabBottom - 3.3;
  k.wall(ST.x1 + 0.12, 8, ST.x1 + 0.12, Z1, BF, 0, 0.12, 'brick', [{ s0: 3.3, s1: 4.7, y0: BF, y1: BF + 2.3, frame: 'woodDark' }], true);
  k.stairs(ST.x0, ST.z0, ST.x1, ST.z1, 0, BF, 'marble', true);
  // barandilla de latón junto al hueco
  k.box(ST.x1 + 0.02, 0, ST.z0, ST.x1 + 0.08, 0.95, ST.z1, 'brass');
  // descansillo al pie y el salón
  const SX0 = X0 + 0.3, SX1 = X1 - 0.3, SZ0 = 3.6, SZ1 = Z1 - 0.3;
  k.box(SX0, BF - 0.3, SZ0, SX1, BF, SZ1, 'dark');
  k.walk(SX0, SZ0, SX1, SZ1, BF);
  k.checker(SX0, SZ0, SX1, SZ1, BF + 0.01, 0.5, 'blackTile', 'whiteTile');
  k.wall(SX0, SZ0, SX1, SZ0, BF, slabBottom, 0.3, 'brick');
  k.wall(SX1, SZ1, SX0, SZ1, BF, slabBottom, 0.3, 'brick');
  // bóvedas de ladrillo en tres crujías, sobre arcos fajones
  const span = (SZ1 - SZ0) / 3;
  for (let i = 0; i < 3; i++) {
    const z0 = SZ0 + i * span, z1 = z0 + span;
    k.vault(SX0, SX1, z0, z1, slabBottom - span / 2 - 0.05, 'brick', 10);
    if (i > 0) for (let x = SX0 + 2.5; x < SX1 - 1; x += 3.2) {
      if (x < ST.x1 + 0.5 && z0 > ST.z0 - 1) continue;
      k.box(x - 0.3, BF, z0 - 0.3, x + 0.3, slabBottom - 0.3, z0 + 0.3, 'brick', true);
    }
  }
  collision.add({ kind: 'quad', p: [k.w(SX0, SZ0), k.w(SX1, SZ0), k.w(SX1, SZ1), k.w(SX0, SZ1)].flat(), h: k.y0 + slabBottom + 0.1, y0: k.y0 + slabBottom - 0.9 });
  // mesas, bancadas y espejos del sótano
  for (let x = ST.x1 + 1.4; x < SX1 - 0.8; x += 1.6) for (const z of [SZ0 + 1.2, (SZ0 + SZ1) / 2, SZ1 - 1.2]) {
    if (Math.abs(z - (SZ0 + SZ1) / 2) < 0.1 && (x - ST.x1) % 3.2 < 1.7) continue;
    k.roundTable(x, z, BF, 'marble', 'iron');
    k.chair(x, z - 0.55, BF, Math.PI, 'woodDark');
    k.chair(x, z + 0.55, BF, 0, 'woodDark');
    if (Math.random() < 0.45) people.push({ x, z: z + 0.6, y: BF, heading: Math.PI, action: 'sit', prop: Math.random() < 0.5 ? 'coffee' : 'none' });
  }
  k.box(SX1 - 0.55, BF, SZ0 + 0.3, SX1 - 0.05, BF + 0.45, SZ1 - 0.3, 'woodDark', true);
  k.box(SX1 - 0.55, BF + 0.45, SZ0 + 0.3, SX1 - 0.05, BF + 0.52, SZ1 - 0.3, 'velvet');
  for (let m = 0; m < 3; m++) {
    const z0 = SZ0 + 0.5 + m * span;
    k.box(SX1 - 0.12, BF + 1.2, z0, SX1 - 0.06, BF + 2.4, z0 + span - 1, 'gilt');
    k.box(SX1 - 0.13, BF + 1.28, z0 + 0.08, SX1 - 0.07, BF + 2.32, z0 + span - 1.08, 'mirror');
  }
  for (let x = SX0 + 3; x < SX1; x += 3.2) for (let i = 0; i < 3; i++) k.pendant(x, SZ0 + span * (i + 0.5), slabBottom - 0.05 + span / 2 - 0.4, 0.6, 'glowWarm', 'brass', 0.14);

  // terraza en el pasadizo
  for (const s of [5.0, 7.6, 10.2]) {
    const x = X0 + s, z = -2.2;
    k.roundTable(x, z, terrainH(...k.w(x, z)) - k.y0, 'marble', 'iron');
    k.chair(x - 0.55, z, terrainH(...k.w(x - 0.55, z)) - k.y0, Math.PI / 2, 'iron');
    k.chair(x + 0.55, z, terrainH(...k.w(x + 0.55, z)) - k.y0, -Math.PI / 2, 'iron');
  }

  const g = k.finish();
  const ppl = new People(g, people, k);
  const shopPoly = [k.w(X0, 0), k.w(X1, 0), k.w(X1, Z1), k.w(X0, Z1)].flat();
  return {
    name: 'Chocolatería San Ginés', group: g, footprint: b.pts, floor: k.y0, fill: 0.4,
    inside: (x, z, y) => inPoly(shopPoly, x, z) && y > k.y0 + BF - 1 && y < k.y0 + CEIL,
    update: (dt, p) => ppl.update(dt, Math.hypot(p.x - f.ox, p.z - f.oz) < 70),
    npcNear: (p) => ppl.near(p),
  };
}


// ------------------------------------------------------------------ Estación de Atocha (histórica)

/** Palmera: tronco anillado algo curvado y corona de hojas colgantes. */
