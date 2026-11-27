import * as THREE from 'three';
import type { WorldData, BuildingData } from './realData';
import type { Ground } from './roads';
import type { CollisionWorld } from './collision';
import { Kit, type Opening } from './arch';
import { Character, randomLook, type Action, type Prop } from '../entities/character';

/**
 * Edificios emblemáticos con interior real: se entra andando por su puerta, sin pantallas de carga.
 * Cada uno sustituye al bloque de OSM por un modelo propio con fachada, plantas, salas, escaleras y
 * mobiliario, sobre su planta real. Por ahora: Mercado de San Miguel y Chocolatería San Ginés.
 */

type V2 = [number, number];

export interface Landmark {
  name: string;
  group: THREE.Group;
  /** Polígono de la planta (mundo), para saber si estás dentro y para quitar el terreno de debajo. */
  footprint: number[];
  /** Cota del suelo de la planta baja (mundo). */
  floor: number;
  /** ¿El punto está dentro del edificio? */
  inside(x: number, z: number, y: number): boolean;
  update(dt: number, player: THREE.Vector3, hour: number): void;
  /** Persona con la que se puede hablar cerca del punto. */
  npcNear(p: THREE.Vector3): Npc | null;
  /** Acción propia del edificio (ascensor…) cerca del punto. */
  action?(p: THREE.Vector3): { text: string; run: () => void } | null;
  /** Luz de relleno extra dentro (se suma a la del cielo). */
  fill: number;
  /** Coches aparcados del entorno (taxis…). */
  parking?: { type: string; x: number; z: number; heading: number }[];
  /** Medidas internas (para pruebas). */
  meta?: Record<string, number>;
  /** Suelo «movible» (ascensor): si el jugador está en él, su altura. */
  floorAt?(p: THREE.Vector3): number | null;
}

/** Lo que se ofrece en un mostrador. */
export interface Offer { text: string; price: number; heal: number; reply: string[] }

export interface Npc {
  name: string;
  pos: THREE.Vector3;
  offer?: Offer;
  /** Frase al hablarle. */
  line(): string;
  /** Mirar al jugador y gesticular. */
  face(p: THREE.Vector3): void;
}

// ------------------------------------------------------------------ utilidades

function ring(pts: number[]): V2[] {
  const r: V2[] = [];
  for (let i = 0; i < pts.length; i += 2) r.push([pts[i], pts[i + 1]]);
  return r;
}
function inPoly(pts: number[], x: number, z: number) {
  let c = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], zi = pts[i + 1], xj = pts[j], zj = pts[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
/** Marco local de un edificio: x a lo largo de la arista elegida, z hacia dentro; origen en la esquina mínima. */
function frameOf(pts: number[], edgeIdx: number) {
  const r = ring(pts);
  const a = r[edgeIdx], b = r[(edgeIdx + 1) % r.length];
  let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const ux = Math.cos(ang), uz = Math.sin(ang);
  const proj = (p: V2) => [p[0] * ux + p[1] * uz, -p[0] * uz + p[1] * ux];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of r) { const [lx, lz] = proj(p); x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); z0 = Math.min(z0, lz); z1 = Math.max(z1, lz); }
  // que la arista elegida quede en z = 0 y el edificio hacia +z
  const [, ez] = proj(a);
  if (Math.abs(ez - z1) < Math.abs(ez - z0)) {
    ang += Math.PI;
    return frameOf2(r, ang);
  }
  return { ang, ox: x0 * ux - z0 * uz, oz: x0 * uz + z0 * ux, L: x1 - x0, W: z1 - z0 };
}
function frameOf2(r: V2[], ang: number) {
  const ux = Math.cos(ang), uz = Math.sin(ang);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of r) { const lx = p[0] * ux + p[1] * uz, lz = -p[0] * uz + p[1] * ux; x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); z0 = Math.min(z0, lz); z1 = Math.max(z1, lz); }
  return { ang, ox: x0 * ux - z0 * uz, oz: x0 * uz + z0 * ux, L: x1 - x0, W: z1 - z0 };
}
function longestEdge(pts: number[]) {
  const r = ring(pts);
  let best = 0, bi = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > best) { best = l; bi = i; } }
  return bi;
}
function edgeNearest(pts: number[], x: number, z: number, minLen = 4) {
  const r = ring(pts);
  let best = Infinity, bi = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const d = Math.hypot((a[0] + b[0]) / 2 - x, (a[1] + b[1]) / 2 - z);
    if (d < best && Math.hypot(b[0] - a[0], b[1] - a[1]) > minLen) { best = d; bi = i; }
  }
  return bi;
}

/** Atlas de rótulos: una fila de 512×64 px por texto. */
class Signs {
  readonly canvas = document.createElement('canvas');
  private readonly c: CanvasRenderingContext2D;
  private n = 0;
  readonly texture: THREE.CanvasTexture;
  constructor(private rows = 24) {
    this.canvas.width = 512; this.canvas.height = 64 * rows;
    this.c = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }
  /** Dibuja un rótulo y devuelve su fila. */
  add(text: string, bg: string, fg: string, font = '700 34px Georgia, serif', border?: string) {
    const c = this.c, y = this.n * 64;
    c.fillStyle = bg; c.fillRect(0, y, 512, 64);
    if (border) { c.strokeStyle = border; c.lineWidth = 4; c.strokeRect(6, y + 6, 500, 52); }
    c.fillStyle = fg; c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle';
    let size = 34;
    while (c.measureText(text).width > 470 && size > 14) { size -= 2; c.font = font.replace(/\d+px/, `${size}px`); }
    c.fillText(text, 256, y + 34);
    this.texture.needsUpdate = true;
    return this.n++;
  }
  /** Plano de w×h con el rótulo `row`, mirando a +z local antes de girarlo `rot`. */
  plane(row: number, w: number, h: number) {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const v0 = 1 - (row + 1) / this.rows, v1 = 1 - row / this.rows;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) > 0.5 ? v1 : v0);
    return g;
  }
}

/** Personaje fijo de un interior (dependiente, cliente…), que aparece solo si estás cerca. */
interface Extra {
  x: number; z: number; y: number; heading: number; action: Action; prop: Prop;
  look?: Partial<ReturnType<typeof randomLook>>; ch?: Character;
  name?: string; offer?: Offer; lines?: string[]; talkT?: number;
}

const NAMES = ['Lucía', 'Javier', 'Carmen', 'Manolo', 'Pilar', 'Andrés', 'Marta', 'Rafa', 'Elena', 'Paco', 'Nuria', 'Sergio', 'Rocío', 'Álvaro', 'Inés', 'Toni'];
const GUEST_LINES = [
  '¡Qué bien se está aquí!', 'Esto no lo hay en ningún sitio, ¿eh?', 'Vengo todos los domingos.', 'Perdona, ¿tienes hora?',
  'Mi abuela me traía aquí de pequeño.', 'Están buenísimas, pídete una.', 'Madre mía, cómo está esto hoy de gente.',
  '¿Eres de Madrid? Pues ya lo sabes.', 'Luego me voy al Retiro a dar una vuelta.', 'Hoy invito yo, que he cobrado.',
];

class People {
  private on = false;
  constructor(private group: THREE.Group, private list: Extra[], private kit: Kit) {
    for (const e of list) e.name ??= NAMES[Math.floor(Math.random() * NAMES.length)];
  }
  /** La persona más cercana (a menos de 2,2 m) al punto del mundo. */
  near(p: THREE.Vector3): Npc | null {
    if (!this.on) return null;
    const [lx, lz] = this.kit.l(p.x, p.z), ly = p.y - this.kit.y0;
    let best: Extra | null = null, bd = 2.2;
    for (const e of this.list) {
      if (!e.ch || Math.abs(e.y - ly) > 1.5) continue;
      // al dependiente se le habla desde el otro lado del mostrador
      const d = Math.hypot(e.x - lx, e.z - lz) - (e.offer ? 1.4 : 0);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) return null;
    const e = best;
    const wp = new THREE.Vector3();
    e.ch!.root.getWorldPosition(wp);
    return {
      name: e.name!, pos: wp, offer: e.offer,
      line: () => (e.lines ?? GUEST_LINES)[Math.floor(Math.random() * (e.lines ?? GUEST_LINES).length)],
      face: (pp) => {
        const [qx, qz] = this.kit.l(pp.x, pp.z);
        if (e.action !== 'sit' && e.ch) e.ch.root.rotation.y = Math.atan2(qx - e.x, qz - e.z);
        if (e.ch && e.action !== 'sit') { e.ch.setAction('talk'); e.talkT = 3; }
      },
    };
  }
  update(dt: number, near: boolean) {
    if (near && !this.on) {
      this.on = true;
      for (const e of this.list) {
        const ch = new Character({ ...randomLook(), ...(e.look ?? {}) });
        // el grupo ya es el sistema local del edificio
        ch.root.position.set(e.x, e.y, e.z);
        ch.root.rotation.y = e.heading;
        ch.setAction(e.action);
        if (e.prop !== 'none') ch.setProp(e.prop);
        this.group.add(ch.root);
        e.ch = ch;
      }
    } else if (!near && this.on) {
      this.on = false;
      for (const e of this.list) if (e.ch) { this.group.remove(e.ch.root); e.ch.dispose(); e.ch = undefined; }
    }
    if (this.on) for (const e of this.list) {
      e.ch?.animate(dt, 0);
      if (e.talkT !== undefined) { e.talkT -= dt; if (e.talkT <= 0) { e.talkT = undefined; e.ch?.setAction(e.action); } }
    }
  }
}

function baseMats(k: Kit) {
  k.mat('glass', new THREE.MeshStandardMaterial({ color: 0x9fb6bf, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  k.mat('glowWarm', new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffc97a, emissiveIntensity: 1.6 }));
  k.mat('glowCool', new THREE.MeshStandardMaterial({ color: 0xf2f6ff, emissive: 0xdfe9ff, emissiveIntensity: 1.2 }));
  k.std('iron', 0x2c3a32, { roughness: 0.55, metalness: 0.55 });
  k.std('brass', 0xb08d4a, { roughness: 0.35, metalness: 0.8 });
  k.std('steel', 0xb9bec3, { roughness: 0.3, metalness: 0.75 });
  k.std('marble', 0xece8df, { roughness: 0.25 });
  k.std('woodDark', 0x4a2e1c, { roughness: 0.6 });
  k.std('wood', 0x7a5232, { roughness: 0.7 });
  k.std('granite', 0x8e8a82, { roughness: 0.9 });
  k.std('stucco', 0xe3d6bd, { roughness: 0.95, side: THREE.DoubleSide });
  k.std('dark', 0x16181c, { roughness: 0.9 });
}

// ------------------------------------------------------------------ Mercado de San Miguel

const OFFERS: Record<string, Offer> = {
  'JAMONES Y EMBUTIDOS': { text: 'un cucurucho de jamón', price: 6, heal: 40, reply: ['Ibérico de bellota, cortado a cuchillo.', 'Aquí tienes, que aproveche.'] },
  'QUESOS DE ESPAÑA': { text: 'una tabla de quesos', price: 7, heal: 40, reply: ['Manchego, idiazábal y un torta del Casar.', 'Con un poco de membrillo, ¿vale?'] },
  'OSTRAS · MARISCO': { text: 'dos ostras', price: 8, heal: 30, reply: ['Gallegas, abiertas al momento.', 'Unas gotas de limón y para dentro.'] },
  'FRUTAS Y ZUMOS': { text: 'un zumo natural', price: 4, heal: 25, reply: ['Naranja recién exprimida.', 'Vitaminas, que falta te hacen.'] },
  'VERMUT DE GRIFO': { text: 'un vermut de grifo', price: 3.5, heal: 20, reply: ['Con su naranja y su aceituna.', 'El de toda la vida.'] },
  'VINOS': { text: 'una copa de vino de Madrid', price: 4, heal: 20, reply: ['Un garnacha de San Martín de Valdeiglesias.', 'De la tierra, para que veas.'] },
  'CROQUETAS': { text: 'tres croquetas', price: 5, heal: 35, reply: ['Jamón, boletus y cocido.', 'Cuidado, que queman.'] },
  'ACEITUNAS Y ENCURTIDOS': { text: 'una banderilla', price: 2.5, heal: 15, reply: ['Gilda de las buenas.', 'Pica un poquito, avisado estás.'] },
  'PAN Y DULCES': { text: 'una napolitana', price: 2.5, heal: 25, reply: ['Recién hecha, todavía calentita.', 'De chocolate, como debe ser.'] },
  'PESCADOS': { text: 'un pincho de boquerones', price: 4.5, heal: 30, reply: ['En vinagre, como en Madrid.', 'Del Cantábrico.'] },
  'TAPAS': { text: 'una tapa de tortilla', price: 4, heal: 35, reply: ['Con cebolla, que aquí no hay debate.', 'Jugosita, como tiene que ser.'] },
  'CAFÉ': { text: 'un café con leche', price: 2, heal: 15, reply: ['Marchando.', 'Con la leche templada, ¿no?'] },
  'CAVA Y SANGRÍA': { text: 'una copa de cava', price: 5, heal: 15, reply: ['Bien fresquito.', 'Para celebrar lo que sea.'] },
  'PULPO A FEIRA': { text: 'una ración de pulpo', price: 9, heal: 45, reply: ['Con su pimentón y su aceite.', 'Del bueno, de Galicia.'] },
};

/**
 * Mercado de San Miguel (Alfonso Dubé, 1916): nave de hierro forjado y cristal sobre zócalo de granito,
 * nave central más alta con linterna acristalada, friso de hierro con medallones, puestos de mármol con
 * sus rótulos y mesas altas en los pasillos.
 */
function sanMiguel(b: BuildingData, ground: Ground, collision: CollisionWorld, terrainH: (x: number, z: number) => number): Landmark {
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
function sanGines(b: BuildingData, ground: Ground, collision: CollisionWorld, terrainH: (x: number, z: number) => number): Landmark {
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
function atocha(b: BuildingData, ground: Ground, collision: CollisionWorld, terrainH: (x: number, z: number) => number): Landmark {
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
function circulo(parts: BuildingData[], ground: Ground, collision: CollisionWorld, terrainH: (x: number, z: number) => number): Landmark {
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
  return {
    name: 'Círculo de Bellas Artes', group: g, footprint: main.pts, floor: k.y0, fill: 0.6, meta: { EX0, EX1, EZ0, EZ1, top, L },
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

interface Def {
  /** Nombre del edificio (o identificador OSM) de las partes que se sustituyen. */
  match(b: BuildingData): boolean;
  build(parts: BuildingData[], ground: Ground, collision: CollisionWorld, terrainH: (x: number, z: number) => number): Landmark;
}

const nameIs = (n: string) => (b: BuildingData) => (b as { name?: string }).name === n;
const DEFS: Def[] = [
  { match: nameIs('Mercado de San Miguel'), build: (p, g, c, t) => sanMiguel(p[0], g, c, t) },
  // el edificio del pasadizo de San Ginés que da a la calle del Arenal (la chocolatería)
  { match: (b) => b.id === 'w334382546', build: (p, g, c, t) => sanGines(p[0], g, c, t) },
  // la nave histórica: el polígono de 26 m es la nave entera; el resto de partes (pabellones, marquesina…) se rehacen
  { match: nameIs('Atocha (Histórica)'), build: (p, g, c, t) => atocha(p.reduce((a, b) => (b.h === 26 ? b : a)), g, c, t) },
  { match: nameIs('Círculo de Bellas Artes'), build: (p, g, c, t) => circulo(p, g, c, t) },
];

/** Edificios de OSM que se sustituyen por un modelo con interior, agrupados por definición. */
export function landmarkBuildings(data: WorldData): Map<BuildingData, Def> {
  const out = new Map<BuildingData, Def>();
  for (const b of data.buildings) for (const d of DEFS) if (d.match(b)) { out.set(b, d); break; }
  return out;
}

export function buildLandmarks(data: WorldData, ground: Ground, collision: CollisionWorld, chosen: Map<BuildingData, Def>): Landmark[] {
  const byDef = new Map<Def, BuildingData[]>();
  for (const [b, d] of chosen) { let a = byDef.get(d); if (!a) byDef.set(d, (a = [])); a.push(b); }
  const out: Landmark[] = [];
  for (const [d, parts] of byDef) {
    try { out.push(d.build(parts, ground, collision, (x, z) => ground.terrain.heightAt(x, z))); }
    catch (e) { console.error('No se ha podido levantar un edificio con interior', e); }
  }
  void data;
  return out;
}

/**
 * Terreno bajo los edificios con interior: los vértices que caen dentro se bajan por debajo del suelo del edificio
 * (así no asoma el terreno en las salas aunque la calle tenga cuesta) y los triángulos que quedan enteros dentro
 * se quitan (sótanos y huecos de escalera).
 */
export function cutTerrain(group: THREE.Object3D, polys: { pts: number[]; floor: number }[]) {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry as THREE.BufferGeometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const idx = g.index;
    if (!idx) return;
    m.updateMatrixWorld();
    const inv = m.matrixWorld.clone().invert();
    const v = new THREE.Vector3();
    const inside = new Uint8Array(pos.count);
    let any = false;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      for (const p of polys) {
        if (!inPoly(p.pts, v.x, v.z)) continue;
        inside[i] = 1; any = true;
        if (v.y > p.floor - 0.6) { v.y = p.floor - 0.6; v.applyMatrix4(inv); pos.setXYZ(i, v.x, v.y, v.z); }
        break;
      }
    }
    if (!any) return;
    pos.needsUpdate = true;
    const keep: number[] = [];
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      if (inside[a] && inside[b] && inside[c]) continue;
      keep.push(a, b, c);
    }
    g.setIndex(keep);
    g.computeBoundingSphere();
  });
}
