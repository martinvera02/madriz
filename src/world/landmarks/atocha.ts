import * as THREE from 'three';
import type { BuildingData } from '../realData';
import type { Ground } from '../roads';
import type { CollisionWorld } from '../collision';
import { Kit } from '../arch';
import { type V2, type Landmark, inPoly, frameOf, edgeNearest, Signs, type Extra, People, baseMats } from './common';

function palm(k: Kit, x: number, z: number, y: number, h: number, lean: number, rot: number) {
  const segs = 7;
  let px = x, pz = z, py = y;
  for (let i = 0; i < segs; i++) {
    const t = (i + 1) / segs;
    const nx = x + Math.cos(rot) * lean * t * t, nz = z + Math.sin(rot) * lean * t * t, ny = y + h * t;
    const len = Math.hypot(nx - px, ny - py, nz - pz);
    const g = new THREE.CylinderGeometry(0.17 - 0.06 * t, 0.2 - 0.06 * t, len, 7);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx - px, ny - py, nz - pz).normalize()));
    g.translate((px + nx) / 2, (py + ny) / 2, (pz + nz) / 2);
    k.geo(g, 'palmTrunk');
    px = nx; py = ny; pz = nz;
  }
  for (let f = 0; f < 11; f++) {
    const a = (f / 11) * Math.PI * 2 + rot;
    const leaf = new THREE.ConeGeometry(0.45, 3.4, 4, 1).scale(1, 1, 0.12).translate(0, 1.7, 0);
    leaf.rotateX(Math.PI / 2 + 0.55 + (f % 3) * 0.18).rotateY(-a + Math.PI / 2);
    leaf.translate(px, py, pz);
    k.geo(leaf, f % 2 ? 'palmLeaf' : 'palmLeaf2');
  }
}

/**
 * Estación de Atocha (Alberto de Palacio, 1892): fachada a la glorieta del Emperador Carlos V con dos pabellones
 * de ladrillo y piedra y el gran testero acristalado con nervios de hierro en abanico; nave de 150 m cubierta por
 * una bóveda de hierro y cristal sobre muros de ladrillo con ventanales en arco. Dentro, el jardín tropical con sus
 * palmeras y el estanque de las tortugas, el vestíbulo con el panel de salidas, cafés y la terraza del restaurante.
 */
export function atocha(b: BuildingData, ground: Ground, collision: CollisionWorld, terrainH: (x: number, z: number) => number): Landmark {
  const f = frameOf(b.pts, edgeNearest(b.pts, 930, 1000, 15));
  const W2 = (lx: number, lz: number): V2 => [f.ox + Math.cos(f.ang) * lx - Math.sin(f.ang) * lz, f.oz + Math.sin(f.ang) * lx + Math.cos(f.ang) * lz];
  const L = f.L, D = f.W;
  const k = new Kit(f.ox, f.oz, f.ang, terrainH(...W2(L / 2, -8)) + 0.12, ground, collision);
  baseMats(k);
  k.std('brick', 0xa6533a, { roughness: 0.9 });
  k.std('stone', 0xd8cdb6, { roughness: 0.85 });
  k.std('zinc', 0x6c7378, { roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide });
  k.noShadow.add('zinc');
  k.std('paving', 0xbfb4a0, { roughness: 0.8 });
  k.std('paving2', 0xa99d88, { roughness: 0.8 });
  k.std('soil', 0x3a2c1f, { roughness: 1 });
  k.std('palmTrunk', 0x7b6247, { roughness: 1 });
  k.std('palmLeaf', 0x3f7a35, { roughness: 0.8, side: THREE.DoubleSide });
  k.std('palmLeaf2', 0x5a9440, { roughness: 0.8, side: THREE.DoubleSide });
  k.std('fern', 0x2f6a2e, { roughness: 0.9, side: THREE.DoubleSide });
  k.std('rock', 0x7f7a70, { roughness: 1 });
  k.std('turtle', 0x4d5a2e, { roughness: 0.7 });
  k.std('clockFace', 0xf3efe2, { emissive: 0x5a5448 });
  k.mat('pond', new THREE.MeshStandardMaterial({ color: 0x2c5a55, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.85 }));
  const signs = new Signs(10);
  k.mat('signs', new THREE.MeshStandardMaterial({ map: signs.texture, emissive: 0xffffff, emissiveMap: signs.texture, emissiveIntensity: 0.6, side: THREE.DoubleSide }));
  k.mat('board', new THREE.MeshStandardMaterial({ map: signs.texture, emissive: 0xffffff, emissiveMap: signs.texture, emissiveIntensity: 1.1, side: THREE.DoubleSide }));

  const H = 12, TW = 13; // altura de los muros y anchura de cada pabellón
  const X0 = 0.8, X1 = L - 0.8; // la nave; los pabellones quedan a los lados, fuera de su planta
  // nave: muros laterales de ladrillo con ventanales en arco y el zócalo de piedra
  const win = (len: number) => {
    const ops = [];
    for (let s = 6; s < len - 4; s += 7.5) ops.push({ s0: s, s1: s + 3.2, y0: 4.5, y1: 10.4, glass: true, frame: 'iron', arch: true });
    return ops;
  };
  k.wall(0, D, 0, 16, -2, H, 0.8, 'brick', win(D - 16));
  k.wall(0, 16, 0, 0, -2, H, 0.8, 'brick');
  k.wall(L, 0, L, 16, -2, H, 0.8, 'brick');
  k.wall(L, 16, L, D, -2, H, 0.8, 'brick', win(D - 16));
  for (const x of [0, L]) { k.box(x - 0.5, -2, 16, x + 0.5, 1.2, D, 'stone'); k.box(x - 0.55, H - 0.6, 16, x + 0.55, H, D, 'stone'); }
  // testero trasero (hacia las vías): muro de ladrillo con puertas acristaladas a los andenes
  k.wall(L, D, 0, D, -2, H, 0.8, 'brick', [{ s0: L / 2 - 7, s1: L / 2 - 2, y0: 0, y1: 4, glass: true, frame: 'iron' }, { s0: L / 2 + 2, s1: L / 2 + 7, y0: 0, y1: 4, glass: true, frame: 'iron' }]);
  const toVias = signs.add('ANDENES · ALTA VELOCIDAD', '#1d2b3a', '#f2f2f2', '700 30px Arial, sans-serif');
  k.geo(signs.plane(toVias, 8, 0.8).rotateY(Math.PI).translate(L / 2, 5.0, D - 0.85), 'signs');
  // pabellones de la fachada: ladrillo con esquinas, impostas y cornisa de piedra, y remate con chapitel
  for (const [a, c] of [[-TW, 0.4], [L - 0.4, L + TW]] as [number, number][]) {
    const z0 = -10, z1 = 16;
    const wops = (len: number) => [1, 2, 3].flatMap((fl) => Array.from({ length: Math.floor(len / 4) }, (_, i) => ({ s0: 1.2 + i * 4, s1: 2.8 + i * 4, y0: fl * 4.6 - 2.6, y1: fl * 4.6 - 0.2, frame: 'stone', glass: true })).filter((o) => o.s1 < len - 0.8));
    k.wall(a, z0, c, z0, -2, 17, 0.7, 'brick', wops(c - a));
    k.wall(c, z0, c, z1, -2, 17, 0.7, 'brick', wops(z1 - z0));
    k.wall(a, z1, a, z0, -2, 17, 0.7, 'brick', wops(z1 - z0));
    k.wall(c, z1, a, z1, -2, 17, 0.7, 'brick');
    for (const [qx, qz] of [[a, z0], [c, z0], [a, z1], [c, z1]]) k.box(qx - 0.9, -2, qz - 0.9, qx + 0.9, 17.6, qz + 0.9, 'stone', true);
    for (const y of [4.6, 9.2, 13.8]) k.box(a - 0.25, y - 0.3, z0 - 0.25, c + 0.25, y, z1 + 0.25, 'stone');
    k.box(a - 0.6, 17, z0 - 0.6, c + 0.6, 17.8, z1 + 0.6, 'stone');
    k.slab(a, z0, c, z1, 17.9, 0.3, 'zinc', false);
    k.add(new THREE.ConeGeometry(Math.min(c - a, z1 - z0) * 0.42, 6, 4).rotateY(Math.PI / 4).translate((a + c) / 2, 21, (z0 + z1) / 2), 'zinc');
    k.box((a + c) / 2 - 0.08, 24, (z0 + z1) / 2 - 0.08, (a + c) / 2 + 0.08, 26.5, (z0 + z1) / 2 + 0.08, 'iron');
  }
  // bóveda de hierro y cristal (arco rebajado) sobre la nave entre los muros laterales
  const half = L / 2, rise = 15, R = (half * half + rise * rise) / (2 * rise), cy = H + rise - R, th = Math.asin(half / R);
  const N = 18, arc: [number, number][] = [];
  for (let i = 0; i <= N; i++) { const a = -th + (2 * th * i) / N; arc.push([half + Math.sin(a) * R, cy + Math.cos(a) * R]); }
  const strip = (i: number, z0: number, z1: number, mat: string) => {
    const [xa, ya] = arc[i], [xb, yb] = arc[i + 1];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([xa, ya, z0, xb, yb, z0, xb, yb, z1, xa, ya, z0, xb, yb, z1, xa, ya, z1], 3));
    g.computeVertexNormals();
    k.geo(g, mat);
  };
  for (let i = 0; i < N; i++) strip(i, 0, D, i >= 4 && i < N - 4 ? 'glass' : 'zinc');
  // cerchas en arco cada 10 m, correas a lo largo
  for (let z = 0; z <= D + 0.01; z += D / Math.round(D / 10)) {
    for (let i = 0; i < N; i++) {
      const [xa, ya] = arc[i], [xb, yb] = arc[i + 1];
      const len = Math.hypot(xb - xa, yb - ya);
      k.geo(new THREE.BoxGeometry(len, 0.5, 0.25).rotateZ(Math.atan2(yb - ya, xb - xa)).translate((xa + xb) / 2, (ya + yb) / 2 - 0.25, z), 'iron');
    }
    k.box(0.8, H - 0.2, z - 0.06, L - 0.8, H, z + 0.06, 'iron');
  }
  for (let i = 1; i < N; i++) k.box(arc[i][0] - 0.07, arc[i][1] - 0.15, 0, arc[i][0] + 0.07, arc[i][1], D, 'iron');
  collision.add({ kind: 'quad', p: [k.w(0, 0), k.w(L, 0), k.w(L, D), k.w(0, D)].flat(), h: k.y0 + H + rise + 1, y0: k.y0 + H + 1 });
  // testero de la fachada: el gran abanico de cristal con nervios radiales, y debajo el muro con las puertas
  {
    const pos: number[] = [];
    for (let i = 0; i < N; i++) pos.push(half, H, -0.2, arc[i][0], arc[i][1], -0.2, arc[i + 1][0], arc[i + 1][1], -0.2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    k.geo(g, 'glass');
    for (let i = 0; i <= N; i += 2) {
      const [xa, ya] = arc[i], len = Math.hypot(xa - half, ya - H);
      k.geo(new THREE.BoxGeometry(len, 0.18, 0.3).rotateZ(Math.atan2(ya - H, xa - half)).translate((xa + half) / 2, (ya + H) / 2, -0.25), 'iron');
    }
    for (let i = 0; i < N; i++) {
      const [xa, ya] = arc[i], [xb, yb] = arc[i + 1], len = Math.hypot(xb - xa, yb - ya);
      k.geo(new THREE.BoxGeometry(len, 0.7, 0.6).rotateZ(Math.atan2(yb - ya, xb - xa)).translate((xa + xb) / 2, (ya + yb) / 2, -0.3), 'stone');
    }
  }
  const doorOps = [-1, 0, 1].map((d) => ({ s0: half - X0 + d * 9 - 2.6, s1: half - X0 + d * 9 + 2.6, y0: 0, y1: 7.5, frame: 'iron', arch: true }));
  k.wall(X0, 0, X1, 0, -2, H, 0.8, 'brick', doorOps);
  k.box(X0, H - 0.8, -0.5, X1, H, 0.3, 'stone');
  // reloj sobre la puerta central
  k.cyl(half, -0.9, 9.0, 9.0, 1.3, 'stone', 24);
  k.add(new THREE.CylinderGeometry(1.15, 1.15, 0.12, 28).rotateX(Math.PI / 2).translate(half, 9.6, -0.95), 'clockFace');
  const hands = new THREE.Group();
  hands.position.set(half, 9.6, -1.05);
  const handMat = new THREE.MeshStandardMaterial({ color: 0x15171a });
  const hourH = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.04).translate(0, 0.3, 0), handMat);
  const minH = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.95, 0.04).translate(0, 0.47, -0.02), handMat);
  hands.add(hourH, minH);
  hands.rotation.y = Math.PI;
  // marquesina de hierro y cristal sobre la acera de la fachada
  k.box(X0, 5.2, -8, X1, 5.35, -0.5, 'glass');
  for (let x = X0 + 2; x < X1; x += 6) {
    if ([-9, 0, 9].some((d) => Math.abs(x - (half + d)) < 3.4)) continue; // no tapar las puertas
    k.cyl(x, -7.6, 0, 5.2, 0.12, 'iron', 8, true); k.box(x - 0.06, 5.0, -8, x + 0.06, 5.2, -0.5, 'iron');
  }
  const est = signs.add('ESTACIÓN DE ATOCHA', '#e8dfca', '#5a2a1c', '700 38px Georgia, serif', '#5a2a1c');
  k.geo(signs.plane(est, 12, 1.1).rotateY(Math.PI).translate(half, 6.4, -0.95), 'signs');

  // suelos: explanada bajo la marquesina, vestíbulo y nave
  k.checker(X0, -9, X1, 0, 0.02, 1.2, 'paving', 'paving2');
  k.walk(X0, -10, X1, 0.5, 0.02);
  k.checker(0.8, 0.3, L - 0.8, D - 0.8, 0.02, 1.5, 'paving', 'paving2');
  k.walk(0.8, 0, L - 0.8, D - 0.8, 0.02);

  // vestíbulo: panel de salidas, mostrador de información y bancos
  const board = signs.add('SALIDAS  ·  18:30 SEVILLA  ·  18:45 MÁLAGA  ·  19:00 VALENCIA', '#101418', '#f7c948', '700 26px monospace');
  k.box(half - 6, 5.2, 6.6, half + 6, 7.2, 7.0, 'dark');
  k.geo(signs.plane(board, 11.6, 1.7).translate(half, 6.2, 6.55).rotateY(0), 'board');
  k.geo(signs.plane(board, 11.6, 1.7).rotateY(Math.PI).translate(half, 6.2, 7.05), 'board');
  for (const x of [half - 6.2, half + 6.2]) k.cyl(x, 6.8, 0, 7.2, 0.15, 'iron', 8, true);
  k.box(half - 3, 0, 11, half + 3, 1.1, 12.2, 'woodDark', true);
  k.box(half - 3.1, 1.1, 10.9, half + 3.1, 1.16, 12.3, 'marble');
  const info = signs.add('INFORMACIÓN', '#c4302b', '#ffffff', '700 34px Arial, sans-serif');
  k.geo(signs.plane(info, 3, 0.5).rotateY(Math.PI).translate(half, 2.8, 10.9), 'signs');
  const people: Extra[] = [];
  people.push({ x: half, z: 11.8, y: 0.02, heading: Math.PI, action: 'look', prop: 'none', name: 'Puri', look: { shirt: 0xc4302b },
    lines: ['El AVE a Sevilla sale por la vía 9, cariño.', 'Los de Cercanías, por la otra estación, al fondo a la derecha.', 'El jardín cierra cuando cierra la estación.'] });
  const bench = (x: number, z: number, rot: number) => {
    k.rbox(x, 0.45, z, 2.2, 0.08, 0.5, rot, 'wood');
    k.rbox(x - Math.sin(rot) * 0.25, 0.8, z - Math.cos(rot) * 0.25, 2.2, 0.5, 0.06, rot, 'wood');
    for (const s of [-0.95, 0.95]) k.rbox(x + Math.cos(rot) * s, 0.22, z - Math.sin(rot) * s, 0.06, 0.45, 0.5, rot, 'iron');
  };

  // jardín tropical: arriate central con bordillo de granito, tierra, palmeras, helechos y el estanque
  const GX0 = 11, GX1 = L - 11, GZ0 = 24, GZ1 = D - 28;
  k.box(GX0, 0, GZ0, GX1, 0.55, GZ0 + 0.4, 'stone', true); k.box(GX0, 0, GZ1 - 0.4, GX1, 0.55, GZ1, 'stone', true);
  k.box(GX0, 0, GZ0, GX0 + 0.4, 0.55, GZ1, 'stone', true); k.box(GX1 - 0.4, 0, GZ0, GX1, 0.55, GZ1, 'stone', true);
  k.box(GX0 + 0.4, 0, GZ0 + 0.4, GX1 - 0.4, 0.45, GZ1 - 0.4, 'soil');
  // estanque
  const PX = (GX0 + GX1) / 2, PZ = (GZ0 + GZ1) / 2, PR = Math.min(6, (GX1 - GX0) / 4);
  k.add(new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2).scale(PR * 1.6, 1, PR).translate(PX, 0.5, PZ), 'pond');
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    k.sphere(PX + Math.cos(a) * PR * 1.6, 0.45, PZ + Math.sin(a) * PR, 0.5 + (i % 3) * 0.15, 'rock', 6);
  }
  for (let i = 0; i < 6; i++) {
    const a = i * 1.1;
    k.sphere(PX + Math.cos(a) * PR * 0.9, 0.62, PZ + Math.sin(a) * PR * 0.5, 0.6, 'rock', 6);
    k.add(new THREE.SphereGeometry(0.18, 8, 5).scale(1.2, 0.45, 1).translate(PX + Math.cos(a) * PR * 0.9, 1.0, PZ + Math.sin(a) * PR * 0.5), 'turtle');
  }
  // palmeras de distintas alturas y plantas bajas
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 46; i++) {
    const x = GX0 + 1.5 + rnd() * (GX1 - GX0 - 3), z = GZ0 + 1.5 + rnd() * (GZ1 - GZ0 - 3);
    if (Math.hypot((x - PX) / 1.6, z - PZ) < PR + 1.2) continue;
    palm(k, x, z, 0.45, 7 + rnd() * 12, (rnd() - 0.5) * 2.5, rnd() * 6.28);
  }
  for (let i = 0; i < 140; i++) {
    const x = GX0 + 1 + rnd() * (GX1 - GX0 - 2), z = GZ0 + 1 + rnd() * (GZ1 - GZ0 - 2);
    if (Math.hypot((x - PX) / 1.6, z - PZ) < PR + 0.4) continue;
    const r = 0.5 + rnd() * 0.9;
    k.add(new THREE.ConeGeometry(r, r * 1.6, 6).translate(x, 0.45 + r * 0.8, z), rnd() < 0.5 ? 'fern' : 'palmLeaf2');
  }
  // bancos alrededor del jardín y farolas
  for (let z = GZ0 + 4; z < GZ1 - 2; z += 9) { bench(GX0 - 1.6, z, Math.PI / 2); bench(GX1 + 1.6, z, -Math.PI / 2); }
  for (let z = GZ0; z <= GZ1; z += 12) for (const x of [GX0 - 3.5, GX1 + 3.5]) { k.cyl(x, z, 0, 4.2, 0.08, 'iron', 8, true); k.sphere(x, 4.4, z, 0.3, 'glowWarm', 8); }
  for (let i = 0; i < 18; i++) {
    const side = i % 2, z = GZ0 + 4 + Math.floor(i / 2) * 9;
    if (z > GZ1 - 2) break;
    if (rnd() < 0.5) people.push({ x: side ? GX1 + 1.4 : GX0 - 1.4, z, y: 0.02, heading: side ? -Math.PI / 2 : Math.PI / 2, action: 'sit', prop: rnd() < 0.5 ? 'phone' : 'none' });
  }
  for (let i = 0; i < 14; i++) {
    const x = rnd() < 0.5 ? GX0 - 5 - rnd() * 3 : GX1 + 5 + rnd() * 3, z = 14 + rnd() * (D - 30);
    people.push({ x, z, y: 0.02, heading: rnd() * 6.28, action: rnd() < 0.4 ? 'phone' : 'look', prop: rnd() < 0.4 ? 'phone' : 'none' });
  }
  // cafés bajo los muros laterales
  const cafe = signs.add('CAFÉ · BOCADILLOS', '#2c3a32', '#f0e2b6', '700 30px Georgia, serif');
  for (const [x0, x1, face] of [[1.2, 6, 1], [L - 6, L - 1.2, -1]] as [number, number, number][]) {
    const zc = 18;
    k.box(x0, 0, zc - 4, x1, 1.1, zc + 4, 'woodDark', true);
    k.box(x0 - 0.05, 1.1, zc - 4.05, x1 + 0.05, 1.16, zc + 4.05, 'marble');
    k.geo(signs.plane(cafe, 5, 0.6).rotateY(face > 0 ? Math.PI / 2 : -Math.PI / 2).translate(face > 0 ? x1 + 0.05 : x0 - 0.05, 3.2, zc), 'signs');
    for (let i = 0; i < 4; i++) { const tx = face > 0 ? x1 + 2.2 : x0 - 2.2, tz = zc - 3 + i * 2; k.roundTable(tx, tz, 0.02, 'marble', 'iron'); k.chair(tx + face * 0.55, tz, 0.02, face > 0 ? Math.PI / 2 : -Math.PI / 2, 'iron'); if (rnd() < 0.6) people.push({ x: tx + face * 0.6, z: tz, y: 0.02, heading: face > 0 ? -Math.PI / 2 : Math.PI / 2, action: 'sit', prop: 'coffee' }); }
    people.push({ x: (x0 + x1) / 2 - face * 0.6, z: zc, y: 0.02, heading: face > 0 ? Math.PI / 2 : -Math.PI / 2, action: 'arms', prop: 'none', look: { shirt: 0xf2efe8 },
      offer: { text: 'un café y un bocadillo de calamares', price: 6.5, heal: 55, reply: ['El de calamares, como manda Madrid.', 'Aquí lo tienes, que no se te escape el tren.'] } });
  }
  // terraza del restaurante al fondo, en alto, con su escalera
  const TZ0 = D - 22, TZ1 = D - 1.2, TY = 5.2;
  k.slab(2, TZ0, L - 2, TZ1, TY, 0.4, 'woodDark', true, 'stone');
  for (let x = 4; x < L - 3; x += 7) k.cyl(x, TZ0 + 0.3, 0, TY - 0.4, 0.22, 'iron', 10, true);
  k.box(2, TY, TZ0 - 0.05, L / 2 - 3, TY + 1.0, TZ0 + 0.05, 'iron');
  k.box(L / 2 + 3, TY, TZ0 - 0.05, L - 2, TY + 1.0, TZ0 + 0.05, 'iron');
  k.segCol(2, TZ0, L / 2 - 3, TZ0, TY, TY + 1.0); k.segCol(L / 2 + 3, TZ0, L - 2, TZ0, TY, TY + 1.0);
  k.stairs(L / 2 - 2.5, TZ0 - 9, L / 2 + 2.5, TZ0, 0.02, TY, 'stone', true);
  for (let x = 5; x < L - 5; x += 3.5) for (const z of [TZ0 + 3, TZ0 + 7, TZ0 + 11]) {
    if (Math.abs(x - L / 2) < 3 && z < TZ0 + 4) continue;
    k.roundTable(x, z, TY, 'marble', 'iron');
    k.chair(x - 0.55, z, TY, Math.PI / 2, 'woodDark');
    k.chair(x + 0.55, z, TY, -Math.PI / 2, 'woodDark');
    if (rnd() < 0.45) people.push({ x: x + 0.6, z, y: TY, heading: -Math.PI / 2, action: 'sit', prop: rnd() < 0.5 ? 'beer' : 'coffee' });
  }
  for (let x = 6; x < L - 4; x += 8) k.pendant(x, TZ0 + 8, TY + 4.2, 1.2, 'glowWarm', 'iron', 0.3);

  // entorno de la glorieta: bolardos, farolas fernandinas, bancos y parada de taxis delante de la fachada
  for (let x = X0 - 6; x <= X1 + 6; x += 2.4) k.cyl(x, -11.5, 0, 0.9, 0.1, 'iron', 8, true);
  for (const x of [X0 - 4, half, X1 + 4]) { k.cyl(x, -14, 0, 4.8, 0.12, 'iron', 8, true); for (const d of [-0.5, 0.5]) k.sphere(x + d, 4.9, -14, 0.25, 'glowWarm', 8); }
  for (const x of [X0 + 4, X1 - 4]) bench(x, -12.6, Math.PI);
  const taxi = signs.add('TAXI', '#1e3f8a', '#ffffff', '700 40px Arial, sans-serif');
  k.cyl(X1 + 6, -13, 0, 3.2, 0.06, 'steel', 6, true);
  k.geo(signs.plane(taxi, 1.2, 0.5).rotateY(Math.PI).translate(X1 + 6, 3.0, -13.07), 'signs');
  const parking: { type: string; x: number; z: number; heading: number }[] = [];
  const dirX = Math.atan2(Math.cos(f.ang), Math.sin(f.ang));
  for (let i = 0; i < 3; i++) { const [wx, wz] = W2(X1 + 2 - i * 6, -17.5); parking.push({ type: 'taxi', x: wx, z: wz, heading: dirX + Math.PI }); }
  for (let i = 0; i < 6; i++) people.push({ x: X0 + 3 + i * 5, z: -6 - (i % 2) * 2, y: 0.02, heading: Math.PI + (i - 3) * 0.3, action: i % 3 ? 'look' : 'phone', prop: i % 3 ? 'none' : 'phone' });

  const g = k.finish();
  g.add(hands);
  const ppl = new People(g, people, k);
  const hall = [k.w(0, -10), k.w(L, -10), k.w(L, D), k.w(0, D)].flat();
  return {
    name: 'Estación de Atocha', group: g, footprint: b.pts, floor: k.y0, fill: 0.7, parking, meta: { L, D },
    inside: (x, z, y) => inPoly(hall, x, z) && y > k.y0 - 2 && y < k.y0 + H,
    update: (dt, p, hour) => {
      ppl.update(dt, Math.hypot(p.x - (f.ox + Math.cos(f.ang) * half), p.z - (f.oz + Math.sin(f.ang) * half)) < 160);
      minH.rotation.z = -((hour % 1) * Math.PI * 2);
      hourH.rotation.z = -(((hour % 12) / 12) * Math.PI * 2);
    },
    npcNear: (p) => ppl.near(p),
  };
}

// ------------------------------------------------------------------ Círculo de Bellas Artes

/**
 * Círculo de Bellas Artes (Antonio Palacios, 1926): fachada de piedra con zócalo almohadillado y orden gigante,
 * torre en la esquina de Alcalá con la Minerva en lo alto. Dentro: vestíbulo de mármol con la escalera de honor,
 * el café con sus columnas y arañas, y los ascensores que suben a la azotea, con su bar, terraza y vistas.
 */
