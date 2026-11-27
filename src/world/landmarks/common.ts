import * as THREE from 'three';
import { Kit } from '../arch';
import { Character, randomLook, type Action, type Prop } from '../../entities/character';

/** Piezas compartidas por todos los edificios emblemáticos. */

export type V2 = [number, number];

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

export function ring(pts: number[]): V2[] {
  const r: V2[] = [];
  for (let i = 0; i < pts.length; i += 2) r.push([pts[i], pts[i + 1]]);
  return r;
}
export function inPoly(pts: number[], x: number, z: number) {
  let c = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], zi = pts[i + 1], xj = pts[j], zj = pts[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
/** Marco local de un edificio: x a lo largo de la arista elegida, z hacia dentro; origen en la esquina mínima. */
export function frameOf(pts: number[], edgeIdx: number) {
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
export function frameOf2(r: V2[], ang: number) {
  const ux = Math.cos(ang), uz = Math.sin(ang);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of r) { const lx = p[0] * ux + p[1] * uz, lz = -p[0] * uz + p[1] * ux; x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); z0 = Math.min(z0, lz); z1 = Math.max(z1, lz); }
  return { ang, ox: x0 * ux - z0 * uz, oz: x0 * uz + z0 * ux, L: x1 - x0, W: z1 - z0 };
}
export function longestEdge(pts: number[]) {
  const r = ring(pts);
  let best = 0, bi = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > best) { best = l; bi = i; } }
  return bi;
}
export function edgeNearest(pts: number[], x: number, z: number, minLen = 4) {
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
export class Signs {
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
export interface Extra {
  x: number; z: number; y: number; heading: number; action: Action; prop: Prop;
  look?: Partial<ReturnType<typeof randomLook>>; ch?: Character;
  name?: string; offer?: Offer; lines?: string[]; talkT?: number;
}

export const NAMES = ['Lucía', 'Javier', 'Carmen', 'Manolo', 'Pilar', 'Andrés', 'Marta', 'Rafa', 'Elena', 'Paco', 'Nuria', 'Sergio', 'Rocío', 'Álvaro', 'Inés', 'Toni'];
export const GUEST_LINES = [
  '¡Qué bien se está aquí!', 'Esto no lo hay en ningún sitio, ¿eh?', 'Vengo todos los domingos.', 'Perdona, ¿tienes hora?',
  'Mi abuela me traía aquí de pequeño.', 'Están buenísimas, pídete una.', 'Madre mía, cómo está esto hoy de gente.',
  '¿Eres de Madrid? Pues ya lo sabes.', 'Luego me voy al Retiro a dar una vuelta.', 'Hoy invito yo, que he cobrado.',
];

export class People {
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

export function baseMats(k: Kit) {
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

export const OFFERS: Record<string, Offer> = {
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
