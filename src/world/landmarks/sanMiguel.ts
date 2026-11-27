import * as THREE from 'three';
import type { BuildingData } from '../realData';
import type { Ground } from '../roads';
import type { CollisionWorld } from '../collision';
import { Kit } from '../arch';
import { type V2, type Landmark, inPoly, frameOf, longestEdge, Signs, type Extra, People, baseMats, OFFERS } from './common';

export function sanMiguel(b: BuildingData, ground: Ground, collision: CollisionWorld, terrainH: (x: number, z: number) => number): Landmark {
  const f = frameOf(b.pts, longestEdge(b.pts));
  let tMax = -Infinity;
  for (let i = 0; i < b.pts.length; i += 2) tMax = Math.max(tMax, terrainH(b.pts[i], b.pts[i + 1]));
  const k = new Kit(f.ox, f.oz, f.ang, tMax + 0.35, ground, collision);
  baseMats(k);
  k.std('zinc', 0x737a7f, { roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide });
  // la cubierta no apaga el mercado: de día entra luz de sobra por la linterna y los lucernarios
  k.noShadow.add('zinc');
  k.std('tileA', 0xd8cdb8, { roughness: 0.55, emissive: 0x2a2620 });
  k.std('tileB', 0xb4a68c, { roughness: 0.6 });
  k.std('ham', 0x8a3424, { roughness: 0.6 });
  k.std('fat', 0xe4cfa9);
  k.std('cheese', 0xe1b54c, { roughness: 0.5 });
  k.std('rind', 0x9b6b2c);
  k.std('ice', 0xe6f1f5, { roughness: 0.2 });
  k.std('oyster', 0x8f978e);
  k.std('prawn', 0xd9603b);
  k.std('fruitR', 0xc2352b); k.std('fruitO', 0xe58a22); k.std('fruitG', 0x7da63a); k.std('fruitY', 0xe8cf3c);
  k.std('bottleG', 0x1f4d2c, { roughness: 0.15, metalness: 0.1 }); k.std('bottleB', 0x5a3012, { roughness: 0.15 });
  k.std('croqueta', 0xc58a3c); k.std('olive', 0x6d7a2c); k.std('bread', 0xc9964f); k.std('vermut', 0x7a1f1a, { roughness: 0.2 });
  const signs = new Signs(20);
  k.mat('signs', new THREE.MeshStandardMaterial({ map: signs.texture, emissive: 0xffffff, emissiveMap: signs.texture, emissiveIntensity: 0.35, roughness: 0.6, side: THREE.DoubleSide }));

  const L = f.L, W = f.W;
  const H = 7, NAVE0 = W / 2 - 4.6, NAVE1 = W / 2 + 4.6, HN = 9.6;
  const bays = Math.max(6, Math.round(L / 5)), bay = L / bays;
  const bz = Math.max(3, Math.round(W / 4.8)), bayZ = W / bz;

  // zócalo de granito que llega a la calle (la plaza baja en pendiente)
  let tMin = Infinity;
  for (let i = 0; i < b.pts.length; i += 2) tMin = Math.min(tMin, terrainH(b.pts[i], b.pts[i + 1]));
  const plinth = tMin - k.y0 - 0.4;
  k.box(-0.25, plinth, -0.25, L + 0.25, 0, W + 0.25, 'granite');
  k.box(-0.32, -0.05, -0.32, L + 0.32, 0.12, W + 0.32, 'granite');
  // suelo de baldosa y superficie para andar
  k.checker(0.1, 0.1, L - 0.1, W - 0.1, 0.13, 0.6, 'tileA', 'tileB');
  k.walk(0, 0, L, W, 0.13);

  // puertas: centro de los lados cortos y centro de los largos
  const doorsLong = [Math.floor(bays / 2)];
  const doorsShort = [Math.floor(bz / 2)];
  const steps = (wx: number, wz: number, dirx: number, dirz: number, along: boolean, s0: number, s1: number) => {
    // escalinata desde la calle (medida delante del centro de la puerta) hasta el suelo del mercado
    const mid = (s0 + s1) / 2;
    const [gx, gz] = along ? k.w(mid, wz + dirz * 2.6) : k.w(wx + dirx * 2.6, mid);
    const street = terrainH(gx, gz) - k.y0;
    if (street > -0.15) return;
    if (along) k.stairs(s0, wz + dirz * 2.4, s1, wz, street, 0.13, 'granite', true);
    else k.stairs(wx + dirx * 2.4, s0, wx, s1, street, 0.13, 'granite');
  };

  // fachada de hierro y cristal: muros con un hueco acristalado por vano, y puertas
  const facade = (ax: number, az: number, bx: number, bzz: number, nB: number, doorIdx: number[]) => {
    const len = Math.hypot(bx - ax, bzz - az), bl = len / nB;
    const ops = [];
    for (let i = 0; i < nB; i++) {
      const s0 = i * bl + 0.22, s1 = (i + 1) * bl - 0.22;
      if (doorIdx.includes(i)) ops.push({ s0: s0 + 0.4, s1: s1 - 0.4, y0: 0, y1: 3.3, frame: 'iron' });
      else ops.push({ s0, s1, y0: 0.55, y1: 5.5, glass: true, frame: 'iron' });
    }
    k.wall(ax, az, bx, bzz, 0.13, H - 1.2, 0.14, 'iron', ops);
    const dx = (bx - ax) / len, dz = (bzz - az) / len;
    for (let i = 0; i < nB; i++) {
      const s0 = i * bl + 0.22, s1 = (i + 1) * bl - 0.22;
      const P = (s: number): V2 => [ax + dx * s, az + dz * s];
      if (doorIdx.includes(i)) {
        // montante acristalado sobre la puerta
        const [mx, mz] = P((s0 + s1) / 2);
        k.rbox(mx, 4.4, mz, s1 - s0 - 0.8, 2.2, 0.03, Math.atan2(-dz, dx), 'glass');
      } else {
        // parteluces y travesaño de cada paño
        for (const t of [1 / 3, 2 / 3]) { const [mx, mz] = P(s0 + (s1 - s0) * t); k.box(mx - 0.03, 0.55, mz - 0.03, mx + 0.03, 5.5, mz + 0.03, 'iron'); }
        const [a0x, a0z] = P(s0), [a1x, a1z] = P(s1);
        k.box(Math.min(a0x, a1x), 2.35, Math.min(a0z, a1z) - 0.04, Math.max(a0x, a1x), 2.45, Math.max(a0z, a1z) + 0.04, 'iron');
      }
      // medallones del friso
      for (let m = 0; m < 3; m++) {
        const [mx, mz] = P(i * bl + bl * (m + 0.5) / 3);
        const tor = new THREE.TorusGeometry(0.32, 0.05, 6, 14).rotateY(Math.atan2(-dz, dx) + Math.PI / 2).translate(mx, 6.25, mz);
        k.geo(tor, 'iron');
      }
    }
    // friso macizo hasta el alero
    k.wall(ax, az, bx, bzz, H - 1.2, H - 0.95, 0.2, 'iron', [], false);
    k.wall(ax, az, bx, bzz, H - 0.3, H, 0.3, 'iron', [], false);
  };
  facade(0, 0, L, 0, bays, doorsLong);
  facade(L, W, 0, W, bays, doorsLong);
  facade(0, W, 0, 0, bz, doorsShort);
  facade(L, 0, L, W, bz, doorsShort);
  for (const i of doorsLong) {
    steps(0, 0, 0, -1, true, i * bay + 0.6, (i + 1) * bay - 0.6);
    steps(0, W, 0, 1, true, i * bay + 0.6, (i + 1) * bay - 0.6);
  }
  for (const j of doorsShort) {
    steps(0, 0, -1, 0, false, j * bayZ + 0.6, (j + 1) * bayZ - 0.6);
    steps(L, 0, 1, 0, false, j * bayZ + 0.6, (j + 1) * bayZ - 0.6);
  }
  // rótulos exteriores sobre las puertas
  const rotMercado = signs.add('MERCADO DE SAN MIGUEL', '#2c3a32', '#e8d9a8', '700 36px Georgia, serif', '#b08d4a');
  for (const [x, z, r] of [[L / 2, -0.12, Math.PI], [L / 2, W + 0.12, 0], [-0.12, W / 2, -Math.PI / 2], [L + 0.12, W / 2, Math.PI / 2]] as [number, number, number][]) {
    k.geo(signs.plane(rotMercado, 6, 0.75).rotateY(r).translate(x, 3.75, z), 'signs');
  }

  // columnas de fundición: perímetro y las dos filas de la nave central
  for (let i = 0; i <= bays; i++) {
    const x = i * bay;
    for (const z of [0.07, W - 0.07]) { k.cyl(x, z, 0.13, H, 0.13, 'iron', 10, true); k.box(x - 0.25, H - 0.35, z - 0.25, x + 0.25, H - 0.2, z + 0.25, 'iron'); }
    for (const z of [NAVE0, NAVE1]) {
      if (i === 0 || i === bays) continue;
      k.cyl(x, z, 0.13, HN, 0.15, 'iron', 10, true);
      k.cyl(x, z, 0.13, 0.5, 0.26, 'iron', 10);
      k.box(x - 0.3, HN - 0.4, z - 0.3, x + 0.3, HN - 0.25, z + 0.3, 'iron');
    }
  }
  for (let j = 1; j < bz; j++) for (const x of [0.07, L - 0.07]) k.cyl(x, j * bayZ, 0.13, H, 0.13, 'iron', 10, true);

  // cubierta: naves laterales en pendiente, linterna acristalada y caballete de la central
  const roofPlane = (x0: number, x1: number, zA: number, yA: number, zB: number, yB: number, mat: string) => {
    const len = Math.hypot(zB - zA, yB - yA);
    const g = new THREE.BoxGeometry(x1 - x0, 0.1, len).rotateX(-Math.atan2(yB - yA, zB - zA)).translate((x0 + x1) / 2, (yA + yB) / 2, (zA + zB) / 2);
    k.geo(g, mat);
  };
  roofPlane(-0.4, L + 0.4, -0.5, H - 0.2, NAVE0, HN - 1.2, 'zinc');
  roofPlane(-0.4, L + 0.4, W + 0.5, H - 0.2, NAVE1, HN - 1.2, 'zinc');
  k.wall(0, NAVE0, L, NAVE0, HN - 1.2, HN + 0.6, 0.1, 'iron', Array.from({ length: bays }, (_, i) => ({ s0: i * bay + 0.2, s1: (i + 1) * bay - 0.2, y0: HN - 1.0, y1: HN + 0.4, glass: true })), false);
  k.wall(L, NAVE1, 0, NAVE1, HN - 1.2, HN + 0.6, 0.1, 'iron', Array.from({ length: bays }, (_, i) => ({ s0: i * bay + 0.2, s1: (i + 1) * bay - 0.2, y0: HN - 1.0, y1: HN + 0.4, glass: true })), false);
  const ridge = HN + 2.1;
  roofPlane(-0.3, L + 0.3, NAVE0 - 0.3, HN + 0.55, W / 2, ridge, 'zinc');
  roofPlane(-0.3, L + 0.3, NAVE1 + 0.3, HN + 0.55, W / 2, ridge, 'zinc');
  // hastiales de la nave central en los extremos (cristal con montantes)
  for (const x of [0, L]) {
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([x, HN + 0.6, NAVE0, x, HN + 0.6, NAVE1, x, ridge, W / 2], 3));
    tri.computeVertexNormals();
    k.geo(tri, 'glass');
    k.box(x - 0.05, HN - 1.2, NAVE0, x + 0.05, HN + 0.6, NAVE1, 'iron');
  }
  // cerchas de hierro en cada vano de la nave
  for (let i = 1; i < bays; i++) {
    const x = i * bay;
    k.box(x - 0.06, HN - 0.25, NAVE0, x + 0.06, HN - 0.12, NAVE1, 'iron');
    for (let s = 0; s < 6; s++) {
      const z0 = NAVE0 + ((NAVE1 - NAVE0) * s) / 6, z1 = NAVE0 + ((NAVE1 - NAVE0) * (s + 1)) / 6;
      const yTop = (z: number) => HN + 0.55 + (ridge - HN - 0.55) * (1 - Math.abs(z - W / 2) / (W / 2 - NAVE0));
      const g = new THREE.BoxGeometry(0.06, 0.06, Math.hypot(z1 - z0, yTop(z1) - (HN - 0.2))).rotateX(-Math.atan2(yTop(z1) - (HN - 0.2), z1 - z0)).translate(x, (HN - 0.2 + yTop(z1)) / 2, (z0 + z1) / 2);
      k.geo(g, 'iron');
    }
    // tirantes en las naves laterales
    k.box(x - 0.05, H - 0.15, 0, x + 0.05, H - 0.05, NAVE0, 'iron');
    k.box(x - 0.05, H - 0.15, NAVE1, x + 0.05, H - 0.05, W, 'iron');
  }
  // techo para la cámara
  collision.add({ kind: 'quad', p: [k.w(0, 0), k.w(L, 0), k.w(L, W), k.w(0, W)].flat(), h: k.y0 + ridge + 0.5, y0: k.y0 + H - 0.4 });

  // ---- puestos
  const kinds = ['JAMONES Y EMBUTIDOS', 'QUESOS DE ESPAÑA', 'OSTRAS · MARISCO', 'FRUTAS Y ZUMOS', 'VERMUT DE GRIFO', 'VINOS', 'CROQUETAS',
    'ACEITUNAS Y ENCURTIDOS', 'PAN Y DULCES', 'PESCADOS', 'TAPAS', 'CAFÉ', 'CAVA Y SANGRÍA', 'PULPO A FEIRA'];
  const signRows = kinds.map((t, i) => signs.add(t, i % 2 ? '#1f2a24' : '#2a2320', '#efe2bd', '700 30px Georgia, serif'));
  const people: Extra[] = [];
  let kindI = 0;
  /** Puesto de `w` de ancho: mostrador hacia `face` (+1: hacia +z, −1: hacia −z), con fondo en z0. */
  const stall = (x0: number, x1: number, zBack: number, face: 1 | -1, depth = 2.6) => {
    const kind = kinds[kindI % kinds.length];
    const row = signRows[kindI % kinds.length];
    kindI++;
    const zF = zBack + face * depth; // línea del mostrador
    const zin = (d: number) => zBack + face * d;
    const lo = Math.min(zBack, zF), hi = Math.max(zBack, zF);
    // tarima, mamparas laterales y trasera de madera
    k.box(x0, 0.13, lo, x1, 0.18, hi, 'woodDark');
    k.box(x0, 0.13, lo, x0 + 0.08, 2.4, hi, 'wood', true);
    k.box(x1 - 0.08, 0.13, lo, x1, 2.4, hi, 'wood', true);
    // mostrador de mármol con frente de madera y vitrina
    k.box(x0 + 0.08, 0.13, Math.min(zF, zF - face * 0.65), x1 - 0.08, 1.05, Math.max(zF, zF - face * 0.65), 'woodDark', true);
    k.box(x0 + 0.05, 1.05, Math.min(zF + face * 0.05, zF - face * 0.7), x1 - 0.05, 1.1, Math.max(zF + face * 0.05, zF - face * 0.7), 'marble');
    k.box(x0 + 0.2, 1.1, Math.min(zF - face * 0.05, zF - face * 0.55), x1 - 0.2, 1.48, Math.max(zF - face * 0.05, zF - face * 0.55), 'glass');
    // estantes del fondo
    for (const y of [1.2, 1.7, 2.2]) k.box(x0 + 0.1, y, Math.min(zin(0.05), zin(0.45)), x1 - 0.1, y + 0.04, Math.max(zin(0.05), zin(0.45)), 'wood');
    // rótulo y marquesina con luz
    k.box(x0, 2.45, lo, x1, 2.55, hi, 'iron');
    k.geo(signs.plane(row, x1 - x0 - 0.3, 0.42).rotateY(face > 0 ? 0 : Math.PI).translate((x0 + x1) / 2, 2.85, zF + face * 0.02), 'signs');
    k.box(x0 + 0.1, 2.62, Math.min(zF, zF + face * 0.04), x1 - 0.1, 3.08, Math.max(zF, zF + face * 0.04), 'iron');
    k.box(x0 + 0.2, 2.4, Math.min(zF - face * 0.3, zF - face * 0.35), x1 - 0.2, 2.44, Math.max(zF - face * 0.3, zF - face * 0.35), 'glowWarm');
    // género según el puesto
    const cx = (x0 + x1) / 2, n = Math.max(3, Math.floor((x1 - x0) / 0.45));
    const vit = zF - face * 0.3;
    const row3 = (fn: (x: number, i: number) => void) => { for (let i = 0; i < n; i++) fn(x0 + 0.35 + (i * (x1 - x0 - 0.7)) / (n - 1), i); };
    if (kind.startsWith('JAMONES')) {
      // jamones colgados de la barra y embutido en la vitrina
      k.box(x0 + 0.2, 2.25, Math.min(zin(0.9), zin(0.95)), x1 - 0.2, 2.3, Math.max(zin(0.9), zin(0.95)), 'steel');
      row3((x) => { k.add(new THREE.ConeGeometry(0.13, 0.75, 8).rotateX(Math.PI).translate(x, 1.85, zin(0.92)), 'ham'); k.cyl(x, zin(0.92), 2.2, 2.25, 0.015, 'steel', 4); });
      row3((x) => k.add(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8).rotateZ(Math.PI / 2).translate(x, 1.16, vit), 'ham'));
      k.add(new THREE.BoxGeometry(0.5, 0.18, 0.2).translate(cx, 1.19, vit), 'fat');
    } else if (kind.startsWith('QUESOS')) {
      row3((x, i) => k.cyl(x, vit, 1.1, 1.24, 0.17, i % 3 ? 'cheese' : 'rind', 14));
      for (const y of [1.24, 1.74, 2.24]) row3((x, i) => { if (i % 2) k.cyl(x, zin(0.25), y, y + 0.14, 0.15, i % 4 === 1 ? 'cheese' : 'rind', 12); });
    } else if (kind.startsWith('OSTRAS') || kind.startsWith('PESCADOS') || kind.startsWith('PULPO')) {
      k.box(x0 + 0.2, 1.1, Math.min(vit - 0.25, vit + 0.25), x1 - 0.2, 1.18, Math.max(vit - 0.25, vit + 0.25), 'ice');
      for (let i = 0; i < n * 2; i++) {
        const x = x0 + 0.3 + ((i * 0.37) % (x1 - x0 - 0.6)), z = vit + (((i * 7) % 5) - 2) * 0.08;
        k.add(new THREE.SphereGeometry(0.07, 6, 4).scale(1.3, 0.4, 1).translate(x, 1.2, z), i % 3 ? 'oyster' : 'prawn');
      }
    } else if (kind.startsWith('FRUTAS')) {
      const cols = ['fruitR', 'fruitO', 'fruitG', 'fruitY'];
      row3((x, i) => { for (let a = 0; a < 3; a++) for (let b2 = 0; b2 < 3 - a; b2++) k.sphere(x - 0.12 + b2 * 0.1 + a * 0.05, 1.17 + a * 0.08, vit - 0.08 + a * 0.04, 0.05, cols[i % 4], 6); });
      for (const y of [1.24, 1.74]) row3((x, i) => k.sphere(x, y + 0.06, zin(0.25), 0.06, cols[(i + 1) % 4], 6));
    } else if (kind.startsWith('VERMUT') || kind.startsWith('VINOS') || kind.startsWith('CAVA')) {
      for (const y of [1.24, 1.74, 2.24]) row3((x, i) => k.cyl(x, zin(0.25), y, y + 0.3, 0.035, i % 2 ? 'bottleG' : 'bottleB', 6));
      // barricas con grifo en el mostrador
      k.add(new THREE.CylinderGeometry(0.2, 0.2, 0.42, 12).rotateX(Math.PI / 2).translate(cx - 0.4, 1.32, vit), 'wood');
      k.add(new THREE.CylinderGeometry(0.2, 0.2, 0.42, 12).rotateX(Math.PI / 2).translate(cx + 0.4, 1.32, vit), 'wood');
      row3((x, i) => { if (i % 3 === 0) k.cyl(x, vit + face * 0.3, 1.1, 1.24, 0.035, 'vermut', 8); });
    } else if (kind.startsWith('CROQUETAS') || kind.startsWith('TAPAS')) {
      row3((x) => { k.box(x - 0.16, 1.1, vit - 0.12, x + 0.16, 1.13, vit + 0.12, 'steel'); for (let a = 0; a < 4; a++) k.add(new THREE.CapsuleGeometry(0.025, 0.05, 2, 6).rotateZ(Math.PI / 2).translate(x - 0.09 + a * 0.06, 1.16, vit), 'croqueta'); });
    } else if (kind.startsWith('ACEITUNAS')) {
      row3((x) => { k.cyl(x, vit, 1.1, 1.2, 0.14, 'steel', 12); for (let a = 0; a < 5; a++) k.sphere(x - 0.06 + (a % 3) * 0.05, 1.21, vit - 0.03 + (a > 2 ? 0.05 : 0), 0.03, 'olive', 5); });
    } else {
      row3((x, i) => k.add(new THREE.CapsuleGeometry(0.05, 0.12, 2, 6).rotateZ(Math.PI / 2).translate(x, 1.17, vit), i % 2 ? 'bread' : 'croqueta'));
    }
    // dependiente, con lo que vende el puesto
    people.push({ x: cx, z: zin(1.3), y: 0.18, heading: face > 0 ? 0 : Math.PI, action: Math.random() < 0.5 ? 'arms' : 'look', prop: 'none', look: { shirt: 0xf2efe8 },
      offer: OFFERS[kind], lines: ['¿Qué te pongo, guapo?', 'Prueba esto, que está de muerte.', 'Lo más fresco del mercado, te lo digo yo.'] });
  };
  // puestos adosados a las fachadas largas (sin tapar las puertas) y la isla central
  for (let i = 0; i < bays; i++) {
    if (doorsLong.includes(i)) continue;
    const x0 = i * bay + 0.25, x1 = (i + 1) * bay - 0.25;
    if (i === 0 || i === bays - 1) continue; // las esquinas, libres junto a las puertas de los lados cortos
    stall(x0, x1, 0.35, 1);
    stall(x0, x1, W - 0.35, -1);
  }
  const iz0 = W / 2 - 0.1, iz1 = W / 2 + 0.1;
  for (let i = 2; i < bays - 2; i++) {
    const x0 = i * bay + 0.3, x1 = (i + 1) * bay - 0.3;
    stall(x0, x1, iz0, -1, 2.3);
    stall(x0, x1, iz1, 1, 2.3);
  }
  // mesas altas (barricas) y gente en los pasillos
  const aisles = [(0.35 + 2.6 + iz0 - 2.3) / 2, (W - 0.35 - 2.6 + iz1 + 2.3) / 2];
  for (const az of aisles) {
    for (let i = 1; i < bays; i++) {
      const x = i * bay;
      k.cyl(x, az, 0.13, 1.0, 0.32, 'wood', 12, true);
      k.cyl(x, az, 1.0, 1.06, 0.4, 'marble', 14);
      for (const a of [0.4, 2.6, 4.2]) {
        if (Math.random() < 0.35) continue;
        people.push({ x: x + Math.cos(a) * 0.75, z: az + Math.sin(a) * 0.75, y: 0.13, heading: Math.atan2(-Math.cos(a), -Math.sin(a)) + Math.PI / 2, action: Math.random() < 0.7 ? 'drink' : 'talk', prop: Math.random() < 0.5 ? 'beer' : 'coffee' });
      }
    }
  }
  // lámparas colgantes en la nave y las naves laterales
  for (let i = 0; i < bays; i++) {
    const x = (i + 0.5) * bay;
    k.pendant(x, W / 2, HN - 0.2, 2.4, 'glowWarm', 'iron', 0.28);
    for (const z of [NAVE0 / 2, (NAVE1 + W) / 2]) k.pendant(x, z, H - 0.2, 1.4, 'glowWarm', 'iron', 0.2);
  }

  const g = k.finish();
  const ppl = new People(g, people, k);
  return {
    name: 'Mercado de San Miguel', group: g, footprint: b.pts, floor: k.y0, fill: 0.9,
    inside: (x, z, y) => inPoly(b.pts, x, z) && y > k.y0 - 1 && y < k.y0 + H,
    update: (dt, p) => ppl.update(dt, Math.hypot(p.x - (f.ox), p.z - f.oz) < 110),
    npcNear: (p) => ppl.near(p),
  };
}

// ------------------------------------------------------------------ Chocolatería San Ginés

/**
 * Chocolatería San Ginés (pasadizo de San Ginés, desde 1894): escaparate de madera verde con rótulo dorado;
 * dentro, salón de mármol y terciopelo verde con espejos de marco dorado, barra con las porras recién hechas,
 * obrador con la churrera, aseos y la escalera que baja al salón abovedado del sótano.
 */
