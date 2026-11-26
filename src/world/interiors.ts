import * as THREE from 'three';
import type { CollisionWorld } from './collision';
import { Character, randomLook, type Action, type Prop } from '../entities/character';
import type { ShopDoor } from './shopfronts';

/*
 * Locales en los que se puede entrar. Cada interior se construye la primera vez que entras y se
 * coloca fuera del mapa, a 2 km de altura (así no choca con nada de la ciudad): al cruzar la puerta
 * la pantalla funde a negro y te lleva dentro.
 *   - Bar de toda la vida: azulejos, barra de madera con grifo de cerveza y cafetera, botellero
 *     iluminado, tele con el fútbol, tragaperras, mesas con parroquianos y camarero/a.
 *   - Tienda 24 h / bazar / locutorio: estanterías, neveras iluminadas y dependiente en el mostrador.
 */

export const INTERIOR_Y = 2000;

export interface InteriorNpc {
  ch: Character; pos: THREE.Vector3; heading: number; role: 'staff' | 'guest'; name: string; alive: boolean; action: Action;
  /** Puntos entre los que se mueve (local, relativos al origen del interior). */
  route?: THREE.Vector3[]; routeI?: number; waitT?: number; baseHeading?: number;
}
/** Qué se puede pedir en cada local: texto del menú, precio, vida que da y respuesta. */
export interface Offer { text: string; price: number; heal: number; prop: Prop; replies: string[] }
export interface Interior {
  door: ShopDoor;
  group: THREE.Group;
  origin: THREE.Vector3; // centro de la puerta por dentro
  spawn: THREE.Vector3;
  exit: THREE.Vector3;
  counter: THREE.Vector3; // dónde se pide
  npcs: InteriorNpc[];
  lights: THREE.Vector3[];
  kind: 'bar' | 'tienda';
  style: string;
  offer: Offer;
  slot: number;
  flicker: THREE.MeshBasicMaterial[];
}

const STAFF_NAMES = ['Lola', 'Manolo', 'Pili', 'Rafa', 'Encarna', 'Toñi', 'Jesús', 'Mari Carmen'];

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

let tex: Record<string, THREE.Texture> | null = null;
function textures() {
  if (tex) return tex;
  tex = {
    terrazo: canvasTex(128, 128, (g) => {
      g.fillStyle = '#b9b2a4'; g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 900; i++) { g.fillStyle = ['#8a8274', '#d8d2c4', '#6e665a', '#a39886'][i % 4]; g.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 3, 2 + Math.random() * 3); }
      g.strokeStyle = 'rgba(60,55,50,0.5)'; g.strokeRect(0, 0, 128, 128);
    }, [6, 8]),
    azulejo: canvasTex(64, 64, (g) => {
      g.fillStyle = '#e8e4da'; g.fillRect(0, 0, 64, 64);
      g.strokeStyle = '#b7b1a5'; g.lineWidth = 2; g.strokeRect(1, 1, 31, 31); g.strokeRect(33, 1, 30, 31); g.strokeRect(1, 33, 31, 30); g.strokeRect(33, 33, 30, 30);
      g.fillStyle = '#2f5aa0'; for (const [x, y] of [[16, 16], [48, 48]]) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
    }, [10, 2]),
    madera: canvasTex(64, 64, (g) => {
      g.fillStyle = '#5a3820'; g.fillRect(0, 0, 64, 64);
      for (let y = 0; y < 64; y += 2) { g.fillStyle = `rgba(30,15,5,${0.1 + Math.random() * 0.2})`; g.fillRect(0, y, 64, 1); }
    }, [4, 1]),
    menu: canvasTex(256, 128, (g) => {
      g.fillStyle = '#1b1d1b'; g.fillRect(0, 0, 256, 128);
      g.fillStyle = '#e9e6df'; g.font = 'bold 22px sans-serif'; g.fillText('TAPAS · RACIONES', 20, 32);
      g.font = '16px sans-serif';
      ['Caña ......... 1,50 €', 'Tinto ........ 1,80 €', 'Bocata calamares 4 €', 'Torreznos .... 3,50 €', 'Café ......... 1,30 €'].forEach((l, i) => g.fillText(l, 22, 56 + i * 15));
    }),
    tv: canvasTex(64, 40, (g) => {
      g.fillStyle = '#2f7a2f'; g.fillRect(0, 0, 64, 40);
      g.strokeStyle = '#e9e6df'; g.lineWidth = 1; g.strokeRect(4, 4, 56, 32); g.beginPath(); g.moveTo(32, 4); g.lineTo(32, 36); g.stroke();
      g.beginPath(); g.arc(32, 20, 6, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#e9e6df'; g.fillRect(20, 14, 2, 3); g.fillRect(41, 25, 2, 3); g.fillStyle = '#c23a2a'; g.fillRect(28, 22, 2, 3);
      g.fillStyle = '#111'; g.fillRect(2, 2, 22, 6); g.fillStyle = '#fff'; g.font = '6px monospace'; g.fillText('RMA 1-1 ATM', 3, 7);
    }),
    poster: canvasTex(64, 96, (g) => {
      g.fillStyle = '#b75b32'; g.fillRect(0, 0, 64, 96);
      g.fillStyle = '#f2e2b8'; g.font = 'bold 11px sans-serif'; g.fillText('FIESTAS', 8, 18); g.fillText('SAN ISIDRO', 2, 32);
      g.fillStyle = '#202b3a'; g.beginPath(); g.arc(32, 62, 18, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f2e2b8'; g.font = '9px sans-serif'; g.fillText('15 MAYO', 14, 90);
    }),
  };
  return tex;
}

let mats: Record<string, THREE.Material> | null = null;
function materials() {
  if (mats) return mats;
  const t = textures();
  mats = {
    floor: new THREE.MeshStandardMaterial({ map: t.terrazo, roughness: 0.6 }),
    tile: new THREE.MeshStandardMaterial({ map: t.azulejo, roughness: 0.4 }),
    wall: new THREE.MeshStandardMaterial({ color: 0xcdbf9f, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ map: t.madera, roughness: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.7 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.3, metalness: 0.8 }),
    ceiling: new THREE.MeshStandardMaterial({ color: 0x3a3833, roughness: 1 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff0d0 }),
    menu: new THREE.MeshBasicMaterial({ map: t.menu }),
    tv: new THREE.MeshBasicMaterial({ map: t.tv }),
    poster: new THREE.MeshStandardMaterial({ map: t.poster, roughness: 0.8 }),
    street: new THREE.MeshBasicMaterial({ color: 0x3a4a63 }),
    fridge: new THREE.MeshBasicMaterial({ color: 0xd8ecf2 }),
  };
  return mats;
}

let nextSlot = 0;

export function buildInterior(door: ShopDoor, mapX1: number, mapZ0: number, collision: CollisionWorld): Interior {
  const slot = nextSlot++;
  const ox = mapX1 + 600 + (slot % 8) * 40, oz = mapZ0 + Math.floor(slot / 8) * 40, oy = INTERIOR_Y;
  const g = new THREE.Group();
  g.position.set(ox, oy, oz);
  const m = materials();
  const W = door.kind === 'bar' ? 9 : 8, D = door.kind === 'bar' ? 13 : 11, H = 3.2;
  const STYLE_BY_NAME: Record<string, string> = {
    'CAFETERÍA': 'cafeteria', 'CERVECERÍA': 'cerveceria', FARMACIA: 'farmacia', LOCUTORIO: 'locutorio', 'PELUQUERÍA': 'peluqueria',
    'FRUTERÍA': 'fruteria', ESTANCO: 'estanco', 'LOTERÍAS': 'estanco', 'PANADERÍA': 'panaderia', KEBAB: 'kebab',
  };
  const style = STYLE_BY_NAME[door.name] ?? (door.kind === 'bar' ? (slot % 2 ? 'taberna' : 'azulejo') : 'tienda');
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z); mesh.rotation.y = ry;
    mesh.receiveShadow = false;
    g.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => add(new THREE.BoxGeometry(w, h, d), mat, x, y + h / 2, z);
  const solid = (x0: number, z0: number, x1: number, z1: number, h: number) => {
    collision.addSeg(ox + x0, oz + z0, ox + x1, oz + z0, oy + h, oy - 1);
    collision.addSeg(ox + x1, oz + z0, ox + x1, oz + z1, oy + h, oy - 1);
    collision.addSeg(ox + x1, oz + z1, ox + x0, oz + z1, oy + h, oy - 1);
    collision.addSeg(ox + x0, oz + z1, ox + x0, oz + z0, oy + h, oy - 1);
  };

  // Suelo, techo y paredes (la puerta está en z = 0, se entra hacia +z)
  const floor = add(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), m.floor, 0, 0, D / 2);
  (floor.material as THREE.MeshStandardMaterial).map!.repeat.set(W / 1.5, D / 1.5);
  add(new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2), m.ceiling, 0, H, D / 2);
  const tint = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
  const upper = style === 'azulejo' || style === 'kebab' ? m.tile : style === 'taberna' ? m.wood : style === 'cafeteria' ? tint(0xe2d6bc)
    : style === 'cerveceria' ? tint(0x2a221a) : style === 'farmacia' ? tint(0xeef0ec) : style === 'peluqueria' ? tint(0xd9c7cc) : m.wall;
  const wall = (len: number, x: number, z: number, ry: number) => {
    add(new THREE.PlaneGeometry(len, 1.1), m.wood, x, 0.55, z, ry);
    add(new THREE.PlaneGeometry(len, H - 1.1), upper, x, 1.1 + (H - 1.1) / 2, z, ry);
  };
  wall(W, 0, D, Math.PI); // fondo
  wall(D, -W / 2, D / 2, Math.PI / 2);
  wall(D, W / 2, D / 2, -Math.PI / 2);
  // fachada interior con la puerta acristalada (se ve la calle de noche)
  for (const sx of [-1, 1]) add(new THREE.PlaneGeometry(W / 2 - 0.6, H), m.wall, sx * (W / 4 + 0.3), H / 2, 0);
  add(new THREE.PlaneGeometry(1.2, 0.9), m.wall, 0, H - 0.45, 0);
  add(new THREE.PlaneGeometry(1.1, 2.2), m.street, 0, 1.1, 0.01);
  box(1.3, 0.08, 0.12, m.dark, 0, 2.25, 0.05);
  for (const sx of [-1, 1]) box(0.08, 2.3, 0.12, m.dark, sx * 0.62, 0, 0.05);
  // escaparates por dentro
  for (const sx of [-1, 1]) add(new THREE.PlaneGeometry(2.4, 1.8), m.street, sx * (W / 4 + 0.5), 1.5, 0.02);
  // tubos de luz
  for (const z of [D * 0.3, D * 0.65]) box(1.4, 0.05, 0.25, m.lamp, 0, H - 0.06, z);
  collision.addSeg(ox - W / 2, oz, ox + W / 2, oz, oy + H, oy - 1);
  collision.addSeg(ox + W / 2, oz, ox + W / 2, oz + D, oy + H, oy - 1);
  collision.addSeg(ox + W / 2, oz + D, ox - W / 2, oz + D, oy + H, oy - 1);
  collision.addSeg(ox - W / 2, oz + D, ox - W / 2, oz, oy + H, oy - 1);

  const npcs: InteriorNpc[] = [];
  const person = (x: number, z: number, heading: number, action: Action, prop: Prop, role: 'staff' | 'guest', name: string, look = randomLook()) => {
    const ch = new Character(look);
    ch.root.position.set(x, 0, z);
    ch.root.rotation.y = heading;
    ch.setAction(action);
    ch.setProp(prop);
    g.add(ch.root);
    npcs.push({ ch, pos: new THREE.Vector3(ox + x, oy, oz + z), heading, role, name, alive: true, action });
  };
  const flicker: THREE.MeshBasicMaterial[] = [];
  let counter: THREE.Vector3;

  const basic = (c: number) => new THREE.MeshBasicMaterial({ color: c });
  const std = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });
  let staffRoute: THREE.Vector3[] | undefined;
  if (door.kind === 'bar') {
    // Barra a la derecha, con encimera y zócalo; varía según el tipo de bar
    const cx = W / 2 - 1.9;
    box(0.7, 1.05, 7.5, style === 'cerveceria' ? m.dark : m.wood, cx, 0, 7.2);
    box(0.85, 0.06, 7.6, style === 'cafeteria' ? std(0xd8d2c6) : m.dark, cx, 1.05, 7.2);
    box(0.72, 0.12, 7.5, m.metal, cx, 0, 7.2);
    solid(cx - 0.4, 3.4, cx + 0.4, 11, 1.1);
    // grifos y cafetera
    const taps = style === 'cerveceria' ? 4 : 1;
    for (let k = 0; k < taps; k++) { box(0.08, 0.4, 0.08, m.metal, cx, 1.1, 5.2 + k * 0.35); box(0.2, 0.12, 0.3, m.metal, cx, 1.4, 5.2 + k * 0.35); }
    box(0.45, 0.45, 0.6, m.metal, cx, 1.1, 8.6);
    // botellero iluminado detrás de la barra
    box(0.3, 1.6, 6, m.dark, W / 2 - 0.2, 1.0, 7.2);
    for (const y of [1.22, 1.82]) box(0.35, 0.03, 6, m.wood, W / 2 - 0.4, y, 7.2);
    const bottleCols = [0x2f7a3a, 0x7a2a1e, 0xd9a64a, 0xe9e6df, 0x3a5aa0];
    for (let i = 0; i < 40; i++) box(0.07, 0.28, 0.07, basic(bottleCols[i % 5]), W / 2 - 0.42, 1.25 + Math.floor(i / 20) * 0.6, 4.6 + (i % 20) * 0.27);
    // tele, menú y cartel
    add(new THREE.PlaneGeometry(1.1, 0.68), m.tv, W / 2 - 0.05, 2.45, 10.5, -Math.PI / 2);
    box(0.08, 0.72, 1.16, m.dark, W / 2 - 0.02, 2.09, 10.5);
    add(new THREE.PlaneGeometry(1.6, 0.8), m.menu, W / 2 - 0.05, 2.5, 6.2, -Math.PI / 2);
    add(new THREE.PlaneGeometry(0.6, 0.9), m.poster, -W / 2 + 0.03, 1.9, 4, Math.PI / 2);
    // taburetes
    for (let k = 0; k < 5; k++) {
      const z = 4.4 + k * 1.3;
      box(0.06, 0.72, 0.06, m.metal, cx - 0.75, 0, z);
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 10), m.wood, cx - 0.75, 0.75, z);
    }
    // tragaperras junto a la puerta
    box(0.6, 1.6, 0.5, m.dark, -W / 2 + 0.5, 0, 1.4);
    const slotMat = basic(0xffb020);
    flicker.push(slotMat);
    box(0.5, 0.5, 0.02, slotMat, -W / 2 + 0.5, 1.0, 1.66);
    solid(-W / 2, 1.1, -W / 2 + 0.85, 1.7, 1.7);
    // mesas: redondas de mármol (cafetería), barriles (taberna), altas (cervecería) o de bar
    for (let k = 0; k < 3; k++) {
      const z = 4 + k * 2.8, x = -W / 2 + 1.5;
      if (style === 'taberna') {
        add(new THREE.CylinderGeometry(0.42, 0.45, 1.0, 12), m.wood, x, 0.5, z);
        for (const y of [0.15, 0.85]) add(new THREE.CylinderGeometry(0.455, 0.455, 0.05, 12), m.dark, x, y, z);
      } else {
        const hi = style === 'cerveceria' ? 1.05 : 0.74;
        box(0.07, hi, 0.07, m.metal, x, 0, z);
        add(new THREE.CylinderGeometry(style === 'cafeteria' ? 0.38 : 0.45, style === 'cafeteria' ? 0.38 : 0.45, 0.05, 12), style === 'cafeteria' ? std(0xe9e6df) : m.wood, x, hi, z);
      }
      solid(x - 0.45, z - 0.45, x + 0.45, z + 0.45, 1.0);
      if (style !== 'cerveceria') for (const sd of [-1, 1]) {
        box(0.4, 0.45, 0.4, m.wood, x + sd * 0.75, 0, z);
        box(0.4, 0.5, 0.05, m.wood, x + sd * 0.95, 0.45, z);
      }
      if (k !== 1) {
        if (style === 'cerveceria') {
          person(x - 0.7, z, Math.PI / 2, 'talk', 'beer', 'guest', 'Parroquiano');
          person(x + 0.7, z, -Math.PI / 2, 'drink', 'beer', 'guest', 'Parroquiano');
        } else {
          person(x - 0.78, z, Math.PI / 2, k === 0 ? 'talk' : 'drink', k === 0 ? 'none' : style === 'cafeteria' ? 'coffee' : 'beer', 'guest', 'Parroquiano');
          npcs[npcs.length - 1].ch.setAction(k === 0 ? 'sit' : 'sit');
          person(x + 0.78, z, -Math.PI / 2, 'sit', style === 'cafeteria' ? 'coffee' : 'beer', 'guest', 'Parroquiano');
        }
      }
    }
    // decoración propia
    if (style === 'taberna') {
      // jamones colgados sobre la barra y pizarra
      for (let k = 0; k < 5; k++) {
        const ham = add(new THREE.ConeGeometry(0.11, 0.55, 7), std(0x7a3a22), cx - 0.1, 2.6, 4.8 + k * 1.2);
        ham.rotation.x = Math.PI;
        box(0.02, 0.35, 0.02, m.dark, cx - 0.1, 2.85, 4.8 + k * 1.2);
      }
      box(1.4, 0.9, 0.03, std(0x1b1d1b), -W / 2 + 0.03 + 0.015, 1.5, 8.5).rotation.y = Math.PI / 2;
    } else if (style === 'cafeteria') {
      // vitrina de bollería iluminada al principio de la barra
      box(0.6, 0.55, 1.6, new THREE.MeshStandardMaterial({ color: 0xcfe6ee, transparent: true, opacity: 0.35 }), cx - 0.05, 1.1, 4.2);
      for (let k = 0; k < 12; k++) box(0.1, 0.06, 0.1, std([0xd9a64a, 0xb5651d, 0xf2e2b8, 0x7a3a22][k % 4]), cx - 0.15 + (k % 2) * 0.2, 1.15 + Math.floor(k / 6) * 0.22, 3.6 + (k % 6) * 0.24);
    } else if (style === 'cerveceria') {
      // tiras de neón en las paredes
      for (const [x, ry, col] of [[-W / 2 + 0.03, Math.PI / 2, 0xb75b32], [W / 2 - 0.03, -Math.PI / 2, 0x5fb0d8]] as const) {
        const nm = basic(col);
        flicker.push(nm);
        add(new THREE.PlaneGeometry(D - 2, 0.06), nm, x, 2.6, D / 2, ry);
      }
      for (let k = 0; k < 4; k++) add(new THREE.CylinderGeometry(0.35, 0.35, 0.8, 10), m.wood, -W / 2 + 0.5, 0.4, D - 0.6 - k * 0.75);
    }
    // camarero/a que va y viene por detrás de la barra; un cliente de pie que pasea
    const name = STAFF_NAMES[slot % STAFF_NAMES.length];
    person(cx + 0.7, 6.8, -Math.PI / 2, 'arms', 'none', 'staff', name, { ...randomLook(), shirt: style === 'cerveceria' ? 0x1d1f24 : 0xe9e6df, top: 'long', pants: 0x1d1f24 });
    staffRoute = [new THREE.Vector3(cx + 0.7, 0, 4.6), new THREE.Vector3(cx + 0.7, 0, 6.8), new THREE.Vector3(cx + 0.7, 0, 9.8)];
    person(cx - 0.75, 9.6, Math.PI / 2, 'drink', 'beer', 'guest', 'Parroquiano');
    person(-0.6, 3, 0, 'none', 'none', 'guest', 'Parroquiano');
    const w = npcs[npcs.length - 1];
    w.route = [new THREE.Vector3(-0.6, 0, 3), new THREE.Vector3(cx - 1.1, 0, 7.6), new THREE.Vector3(-1.4, 0, 11.6), new THREE.Vector3(0.4, 0, 1.6)];
    w.routeI = 0; w.waitT = 3;
    counter = new THREE.Vector3(ox + cx - 0.9, oy, oz + 6.8);
  } else {
    const cx = W / 2 - 1.2;
    // mostrador con caja junto a la puerta (en todas las tiendas)
    box(1.4, 1.0, 0.7, style === 'farmacia' ? std(0xe9e6df) : m.wood, cx, 0, 2.2);
    solid(cx - 0.7, 1.85, cx + 0.7, 2.55, 1.0);
    const sign = basic(new THREE.Color(door.neon).getHex());
    flicker.push(sign);
    box(2.2, 0.35, 0.03, sign, 0, H - 0.5, D - 0.02);
    const shelf = (x: number, cols: number[], white = false) => {
      box(0.6, 1.8, 6, white ? std(0xf2f2ee) : m.dark, x, 0, 6.2);
      solid(x - 0.3, 3.2, x + 0.3, 9.2, 1.8);
      for (let k = 0; k < 60; k++) box(0.62, 0.18, 0.16, std(cols[k % cols.length]), x, 0.25 + (k % 4) * 0.42, 3.4 + Math.floor(k / 4) * 0.38);
    };
    const staffLook = { ...randomLook(), shirt: style === 'farmacia' ? 0xf4f4f2 : randomLook().shirt, top: 'long' as const };
    switch (style) {
      case 'farmacia': {
        for (const x of [-1.8, 0.8]) shelf(x, [0xf2f2ee, 0xcfe8d6, 0xe0e4ea, 0x9ab5d0, 0xf4d6d6], true);
        const cross = basic(0x2fd16a); flicker.push(cross);
        box(0.25, 0.75, 0.03, cross, 0, 1.9, D - 0.04); box(0.75, 0.25, 0.03, cross, 0, 1.9, D - 0.04);
        break;
      }
      case 'locutorio':
        // cabinas de teléfono y ordenadores
        for (let k = 0; k < 3; k++) {
          const z = 4 + k * 1.6;
          box(0.05, 2.0, 1.4, std(0x8a5a3a), -W / 2 + 1.2, 0, z - 0.7);
          box(0.3, 0.4, 0.15, m.dark, -W / 2 + 0.25, 1.3, z);
        }
        for (let k = 0; k < 4; k++) {
          const z = 4 + k * 1.3;
          box(0.8, 0.75, 0.9, m.wood, 1.2, 0, z);
          box(0.45, 0.32, 0.04, m.dark, 1.2, 0.8, z);
          const scr = basic(0x5fa7d8); flicker.push(scr);
          box(0.4, 0.26, 0.01, scr, 1.2, 0.83, z - 0.03);
          solid(0.8, z - 0.45, 1.6, z + 0.45, 0.8);
        }
        break;
      case 'peluqueria':
        for (let k = 0; k < 3; k++) {
          const z = 4.2 + k * 2;
          box(0.04, 1.0, 0.8, std(0xa9c2d4), -W / 2 + 0.05, 1.0, z);
          box(0.6, 0.5, 0.6, m.dark, -W / 2 + 0.9, 0, z);
          box(0.6, 0.6, 0.12, m.dark, -W / 2 + 1.15, 0.5, z);
        }
        person(-W / 2 + 0.95, 4.2, -Math.PI / 2, 'sit', 'none', 'guest', 'Clienta', { ...randomLook(), female: true });
        person(-W / 2 + 1.6, 4.6, -Math.PI / 2 - 0.4, 'talk', 'none', 'staff', 'Peluquera', { ...randomLook(), female: true, shirt: 0x2b2d31 });
        break;
      case 'fruteria':
        for (let r = 0; r < 3; r++) for (let k = 0; k < 7; k++) {
          const col = [0xe04a2a, 0xf2a23a, 0xe9d24a, 0x6fb04a, 0xb5302a, 0x7ac04a, 0x8a3a8a][(k + r) % 7];
          box(0.55, 0.14, 0.45, m.wood, -W / 2 + 0.6 + r * 0.55, 0.35 + r * 0.25, 3.5 + k * 0.6);
          box(0.5, 0.08, 0.4, std(col), -W / 2 + 0.6 + r * 0.55, 0.49 + r * 0.25, 3.5 + k * 0.6);
        }
        solid(-W / 2, 3.1, -W / 2 + 1.9, 7.8, 1.2);
        shelf(1.2, [0x6fb04a, 0xe9d24a, 0xe04a2a]);
        break;
      case 'estanco': {
        // pared entera de cajetillas detrás del mostrador
        box(W - 1, 2.0, 0.3, m.dark, 0, 0.3, D - 1.2);
        for (let k = 0; k < 120; k++) box(0.1, 0.14, 0.04, std([0xe9e6df, 0xc23a2a, 0x1d1f24, 0xd9a64a, 0x2a4d8f][k % 5]), -W / 2 + 0.8 + (k % 24) * 0.27, 0.45 + Math.floor(k / 24) * 0.36, D - 1.37);
        box(W - 2, 1.0, 0.6, m.wood, 0, 0, D - 2.4);
        solid(-W / 2 + 1, D - 2.7, W / 2 - 1, D - 1, 1.1);
        break;
      }
      case 'panaderia':
        for (const x of [-1.8, 0.8]) shelf(x, [0xb5651d, 0xd9a64a, 0x8a4a22, 0xf2e2b8]);
        break;
      case 'kebab': {
        const spit = add(new THREE.CylinderGeometry(0.16, 0.22, 0.7, 10), std(0x8a4a22), cx, 1.55, 2.6);
        spit.userData.spin = true;
        add(new THREE.PlaneGeometry(2.2, 0.8), m.menu, 0, 2.4, D - 0.03, Math.PI);
        for (let k = 0; k < 3; k++) { box(0.07, 0.72, 0.07, m.metal, -1.8, 0, 5 + k * 2); add(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 12), m.wood, -1.8, 0.74, 5 + k * 2); solid(-2.2, 4.6 + k * 2, -1.4, 5.4 + k * 2, 0.8); }
        person(-2.4, 5, Math.PI / 2, 'sit', 'none', 'guest', 'Cliente');
        break;
      }
      default:
        for (let a = 0; a < 2; a++) shelf(-1.8 + a * 2.6, [0xc23a2a, 0xe9c24a, 0x3d6fb0, 0xe9e6df, 0x4f8a43, 0xb75b32]);
        box(W - 0.6, 2.0, 0.6, m.fridge, 0, 0, D - 0.35);
        for (let k = 0; k < 8; k++) box(0.04, 2.0, 0.62, m.dark, -W / 2 + 0.6 + k * (W - 1.2) / 7, 0, D - 0.35);
        solid(-W / 2, D - 0.7, W / 2, D, 2);
    }
    const staffName = { farmacia: 'Farmacéutica', locutorio: 'Encargado', peluqueria: 'Recepción', fruteria: 'Frutero', estanco: 'Estanquera', panaderia: 'Panadera', kebab: 'Cocinero' }[style] ?? 'Dependiente';
    person(cx, 2.95, Math.PI, style === 'kebab' ? 'arms' : 'phone', style === 'kebab' ? 'none' : 'phone', 'staff', staffName, staffLook);
    staffRoute = [new THREE.Vector3(cx - 0.4, 0, 2.95), new THREE.Vector3(cx + 0.4, 0, 2.95)];
    counter = new THREE.Vector3(ox + cx, oy, oz + 1.6);
    if (Math.random() < 0.8 && style !== 'peluqueria') {
      person(-0.5, 7, Math.random() * 6, 'look', 'none', 'guest', 'Cliente');
      const w = npcs[npcs.length - 1];
      w.route = [new THREE.Vector3(-0.5, 0, 7), new THREE.Vector3(-0.5, 0, 4), new THREE.Vector3(2.2, 0, 8.5)];
      w.routeI = 0; w.waitT = 4;
    }
  }
  const staff = npcs.find((n) => n.role === 'staff');
  if (staff && staffRoute) { staff.route = staffRoute; staff.routeI = 0; staff.waitT = 5; staff.baseHeading = staff.heading; }
  g.traverse((o) => { o.castShadow = false; });

  return {
    door, group: g, origin: new THREE.Vector3(ox, oy, oz),
    spawn: new THREE.Vector3(ox, oy, oz + 1.3), exit: new THREE.Vector3(ox, oy, oz + 0.5),
    counter, npcs, lights: [new THREE.Vector3(ox, oy + H - 0.4, oz + D * 0.3), new THREE.Vector3(ox, oy + H - 0.4, oz + D * 0.7)],
    kind: door.kind, style, offer: OFFERS[style] ?? OFFERS.tienda, slot, flicker,
  };
}

const OFFERS: Record<string, Offer> = {
  azulejo: { text: 'una caña', price: 1.5, heal: 35, prop: 'beer', replies: ['¡Marchando una caña!', 'Aquí tienes, bien fresquita.', '¿Unas aceitunas también?'] },
  taberna: { text: 'un vino y una tapa', price: 2.5, heal: 45, prop: 'beer', replies: ['Un tinto y unos torreznos, ¡marchando!', 'Te pongo de lo bueno, que eres de la casa.'] },
  cafeteria: { text: 'un café con porras', price: 2.2, heal: 40, prop: 'coffee', replies: ['¿Cortado o con leche?', 'Recién hechas, cuidado que queman.'] },
  cerveceria: { text: 'una artesana', price: 4, heal: 35, prop: 'beer', replies: ['Esta es una IPA de Carabanchel, ya me dirás.', 'Te la pongo bien tirada.'] },
  tienda: { text: 'un refresco', price: 1.2, heal: 25, prop: 'coffee', replies: ['Uno veinte.', '¿Algo más?', 'Que pase buena noche.'] },
  farmacia: { text: 'unas tiritas y un ibuprofeno', price: 6, heal: 70, prop: 'none', replies: ['Uno cada ocho horas, y con el estómago lleno.', 'Cúrate eso, que tiene mala pinta.'] },
  locutorio: { text: 'media hora de internet', price: 1, heal: 0, prop: 'none', replies: ['La cabina tres está libre.', 'Si llamas fuera, va aparte.'] },
  peluqueria: { text: 'cita para un corte', price: 0, heal: 0, prop: 'none', replies: ['Mañana a las cinco te hago hueco.', '¿Degradado como siempre?'] },
  fruteria: { text: 'unas mandarinas', price: 2, heal: 30, prop: 'none', replies: ['Están dulcísimas, de Valencia.', '¿Te pongo un kilo?'] },
  estanco: { text: 'un décimo de lotería', price: 20, heal: 0, prop: 'none', replies: ['Este termina en siete, que da suerte.', 'Si toca, acuérdate de mí.'] },
  panaderia: { text: 'una barra de pan', price: 1.1, heal: 25, prop: 'none', replies: ['Recién salida del horno.', '¿Bien hecha o poco hecha?'] },
  kebab: { text: 'un dürüm mixto', price: 6, heal: 60, prop: 'none', replies: ['¿Con salsa picante o de yogur?', 'Ahora mismo, amigo.'] },
};

/** Animación y paseos del personal y los clientes. */
export function updateInterior(room: Interior, dt: number) {
  for (const n of room.npcs) {
    if (!n.alive) { n.ch.setDown(1); continue; }
    let speed = 0;
    if (n.route && n.route.length) {
      if ((n.waitT ?? 0) > 0) {
        n.waitT! -= dt;
        if (n.baseHeading !== undefined) n.heading += (n.baseHeading - n.heading) * Math.min(1, dt * 4);
      } else {
        const t = n.route[n.routeI! % n.route.length];
        const lx = n.ch.root.position.x, lz = n.ch.root.position.z;
        const dx = t.x - lx, dz = t.z - lz, d = Math.hypot(dx, dz);
        if (d < 0.15) { n.routeI = (n.routeI! + 1) % n.route.length; n.waitT = 2 + Math.random() * 5; }
        else {
          speed = 1.1;
          const want = Math.atan2(dx, dz);
          let da = want - n.heading; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
          n.heading += da * Math.min(1, dt * 6);
          n.ch.root.position.x += Math.sin(n.heading) * speed * dt;
          n.ch.root.position.z += Math.cos(n.heading) * speed * dt;
          n.pos.set(room.origin.x + n.ch.root.position.x, room.origin.y, room.origin.z + n.ch.root.position.z);
        }
      }
      n.ch.setAction(speed > 0 ? 'none' : n.action);
    }
    n.ch.root.rotation.y = n.heading;
    n.ch.animate(dt, speed);
  }
  room.group.traverse((o) => { if (o.userData.spin) o.rotation.y += dt * 0.6; });
}
