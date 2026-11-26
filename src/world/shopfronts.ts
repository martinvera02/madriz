import * as THREE from 'three';
import type { FacadeRun } from './buildings';

/*
 * Locales de barrio en los bajos comerciales (solo cerca del jugador, con el LOD de fachadas):
 * rótulos con nombre (FARMACIA, BAR, ESTANCO…), banderolas, toldos y escaparates con un interior
 * pintado en perspectiva (estanterías, barra, fruta, sillones de peluquería…) que se ilumina de noche.
 * Se colocan exactamente donde el shader de fachada dibuja los escaparates (misma rejilla de 4 m y mismo hash).
 */

const CELL = 4;

/** Puertas de locales en los que se puede entrar (bares y tiendas), registradas al construir las fachadas cercanas. */
export interface ShopDoor { key: string; x: number; y: number; z: number; nx: number; nz: number; name: string; kind: 'bar' | 'tienda'; neon: string }
export const shopDoors = new Map<string, ShopDoor>();
const ATW = 1024, ATH = 1152;

function hash21(x: number, y: number) {
  x = (Math.floor(x + 0.5) % 289 + 289) % 289;
  y = (Math.floor(y + 0.5) % 289 + 289) % 289;
  let px = (x * 0.1031) % 1, py = (y * 0.103) % 1;
  const d = px * (py + 33.33) + py * (px + 33.33);
  px += d; py += d;
  return ((px + py) * px) % 1;
}

interface SignDef { text: string; bg: string; fg: string; neon?: string; kind: number }
// kind: 0 tienda, 1 bar/cafetería, 2 farmacia, 3 frutería, 4 peluquería, 5 comida rápida, 6 estanco/lotería, 7 bazar
const SIGNS: SignDef[] = [
  { text: 'FARMACIA', bg: '#1d2a22', fg: '#46d17a', neon: '#46d17a', kind: 2 },
  { text: 'BAR', bg: '#2a1b16', fg: '#f0c27a', neon: '#ffb347', kind: 1 },
  { text: 'CAFETERÍA', bg: '#2c2117', fg: '#e8d6b0', neon: '#ffcf7a', kind: 1 },
  { text: 'ESTANCO', bg: '#7a1f1a', fg: '#f3e2b8', kind: 6 },
  { text: 'PANADERÍA', bg: '#3a2a1c', fg: '#e9c98f', kind: 0 },
  { text: 'FRUTERÍA', bg: '#22361f', fg: '#e9e2b8', kind: 3 },
  { text: 'ALIMENTACIÓN 24H', bg: '#171a20', fg: '#ff6b3d', neon: '#ff6b3d', kind: 7 },
  { text: 'LOCUTORIO', bg: '#14263d', fg: '#7fd4ff', neon: '#7fd4ff', kind: 7 },
  { text: 'PELUQUERÍA', bg: '#2b2230', fg: '#e8c9e8', neon: '#ff8fd0', kind: 4 },
  { text: 'KEBAB', bg: '#3b1712', fg: '#ffd25a', neon: '#ffb02e', kind: 5 },
  { text: 'CERVECERÍA', bg: '#1f1a12', fg: '#d4c29a', neon: '#ffc76a', kind: 1 },
  { text: 'LOTERÍAS', bg: '#1d2e6b', fg: '#f2d14a', kind: 6 },
  { text: 'FERRETERÍA', bg: '#2a2d31', fg: '#e3e3e3', kind: 0 },
  { text: 'ÓPTICA', bg: '#e9e6df', fg: '#202b3a', kind: 0 },
  { text: 'BAZAR', bg: '#b75b32', fg: '#171a20', kind: 7 },
  { text: 'MERCERÍA', bg: '#3c2b3a', fg: '#e8dcc8', kind: 0 },
];

let atlas: { map: THREE.Texture; glow: THREE.Texture } | null = null;
const uvSign = (i: number) => [(i % 2) * 512 / ATW, 1 - Math.floor(i / 2) * 64 / ATH, ((i % 2) * 512 + 512) / ATW, 1 - (Math.floor(i / 2) * 64 + 64) / ATH];
const uvInterior = (i: number) => [(i % 4) * 256 / ATW, 1 - (512 + Math.floor(i / 4) * 256) / ATH, ((i % 4) * 256 + 256) / ATW, 1 - (512 + Math.floor(i / 4) * 256 + 256) / ATH];
const uvAwning = (i: number) => [i * 512 / ATW, 1 - 1024 / ATH, (i * 512 + 512) / ATW, 1 - 1152 / ATH];

function buildAtlas() {
  const c = document.createElement('canvas'); c.width = ATW; c.height = ATH;
  const g = c.getContext('2d')!;
  const gc = document.createElement('canvas'); gc.width = ATW; gc.height = ATH;
  const gg = gc.getContext('2d')!;
  gg.fillStyle = '#000'; gg.fillRect(0, 0, ATW, ATH);
  let seed = 77;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // Rótulos
  SIGNS.forEach((s, i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 64;
    g.fillStyle = s.bg; g.fillRect(x, y, 512, 64);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y + 58, 512, 6);
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 2; g.strokeRect(x + 3, y + 3, 506, 58);
    g.font = `700 ${s.text.length > 12 ? 34 : 42}px 'Arial Narrow', 'Roboto Condensed', sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = s.fg; g.fillText(s.text, x + 256, y + 34);
    if (s.kind === 2) { // cruz verde
      for (const cx of [x + 34, x + 478]) { g.fillStyle = s.fg; g.fillRect(cx - 6, y + 14, 12, 36); g.fillRect(cx - 18, y + 26, 36, 12); }
    }
    if (s.neon) {
      gg.font = g.font; gg.textAlign = 'center'; gg.textBaseline = 'middle';
      gg.fillStyle = s.neon; gg.fillText(s.text, x + 256, y + 34);
      if (s.kind === 2) for (const cx of [x + 34, x + 478]) { gg.fillRect(cx - 6, y + 14, 12, 36); gg.fillRect(cx - 18, y + 26, 36, 12); }
    } else {
      gg.fillStyle = 'rgba(212,194,154,0.35)'; gg.fillRect(x, y, 512, 64); // retroiluminado suave
    }
  });

  // Interiores en perspectiva: 8 tipos
  const interiors = [0, 1, 2, 3, 4, 5, 6, 7];
  interiors.forEach((kind, i) => {
    const x = (i % 4) * 256, y = 512 + Math.floor(i / 4) * 256;
    const W = 256, H = 256;
    const bx0 = x + 60, bx1 = x + 196, by0 = y + 50, by1 = y + 170; // pared del fondo
    const warm = kind === 1 || kind === 5 ? '#6a4a2c' : kind === 2 ? '#cfd8cf' : kind === 4 ? '#d6c7c9' : '#c9c2b2';
    const draw = (ctx: CanvasRenderingContext2D, lit: boolean) => {
      const L = (col: string) => (lit ? col : col);
      // techo, suelo, paredes laterales
      ctx.fillStyle = L('#3a3833'); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + W, y); ctx.lineTo(bx1, by0); ctx.lineTo(bx0, by0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = L(kind === 1 ? '#5a3b26' : kind === 2 ? '#b8bdb6' : '#8b857a'); ctx.beginPath(); ctx.moveTo(x, y + H); ctx.lineTo(x + W, y + H); ctx.lineTo(bx1, by1); ctx.lineTo(bx0, by1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = L(warm); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(bx0, by0); ctx.lineTo(bx0, by1); ctx.lineTo(x, y + H); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + W, y); ctx.lineTo(bx1, by0); ctx.lineTo(bx1, by1); ctx.lineTo(x + W, y + H); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x, y, W, H); // sombra general (las paredes laterales se oscurecen abajo)
      ctx.fillStyle = L(warm); ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
      // tubos fluorescentes o lámparas
      ctx.fillStyle = kind === 1 || kind === 5 ? '#ffd28a' : '#f4f6ee';
      for (let k = 0; k < 3; k++) ctx.fillRect(x + 70 + k * 40, y + 18 + k * 6, 34 - k * 6, 4);
    };
    draw(g, true);
    // contenido según el tipo de local
    const shelf = (cols: string[]) => {
      for (let r = 0; r < 4; r++) {
        const yy = by0 + 12 + r * 27;
        g.fillStyle = '#4a4036'; g.fillRect(bx0 + 4, yy + 18, bx1 - bx0 - 8, 3);
        for (let k = 0; k < 14; k++) { g.fillStyle = cols[Math.floor(rnd() * cols.length)]; g.fillRect(bx0 + 6 + k * 9, yy + 4 + rnd() * 4, 7, 14 - rnd() * 4); }
      }
      // estanterías laterales
      for (let r = 0; r < 5; r++) for (const side of [0, 1]) {
        g.fillStyle = cols[Math.floor(rnd() * cols.length)];
        const t = r / 5;
        const xx = side ? x + W - 28 - t * 20 : x + 8 + t * 20;
        g.fillRect(xx, y + 40 + r * 34, 18, 10);
      }
    };
    if (kind === 0 || kind === 7 || kind === 6) shelf(['#c23a2a', '#e9c24a', '#3d6fb0', '#e9e6df', '#4f8a43', '#b75b32', '#7a4aa0']);
    if (kind === 2) shelf(['#e9e6df', '#cfe8d6', '#5aa878', '#e0e4ea', '#9ab5d0']);
    if (kind === 1 || kind === 5) {
      // barra, botellas, taburetes y la tele en la esquina
      for (let k = 0; k < 16; k++) { g.fillStyle = ['#2f5a2a', '#6a2a1e', '#c9a64a', '#d9d4c4'][k % 4]; g.fillRect(bx0 + 6 + k * 8, by0 + 36 + (k % 2) * 3, 5, 18); }
      g.fillStyle = '#3a2416'; g.fillRect(bx0 + 2, by0 + 22, bx1 - bx0 - 4, 4);
      g.fillStyle = '#4b2e1b'; g.beginPath(); g.moveTo(x + 20, y + 200); g.lineTo(x + 236, y + 200); g.lineTo(bx1 - 8, by1 - 4); g.lineTo(bx0 + 8, by1 - 4); g.closePath(); g.fill();
      g.fillStyle = '#c9b48a'; g.fillRect(x + 20, y + 196, 216, 6);
      for (let k = 0; k < 4; k++) { g.fillStyle = '#26201a'; g.fillRect(x + 40 + k * 50, y + 206, 6, 40); g.fillRect(x + 30 + k * 50, y + 202, 26, 6); }
      g.fillStyle = '#10131a'; g.fillRect(x + W - 60, y + 30, 46, 30); g.fillStyle = '#4fa3d8'; g.fillRect(x + W - 57, y + 33, 40, 24); // tele con el fútbol
      g.fillStyle = '#3f9a3a'; g.fillRect(x + W - 57, y + 47, 40, 10);
    }
    if (kind === 3) {
      // cajas de fruta en gradas
      for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) {
        const col = ['#e04a2a', '#f2a23a', '#e9d24a', '#6fb04a', '#b5302a', '#7ac04a'][(k + r) % 6];
        const yy = y + 150 + r * 30, ww = 30 + r * 6, xx = x + 12 + k * (ww + 2);
        g.fillStyle = '#6a4a2c'; g.fillRect(xx, yy + 14, ww, 10);
        g.fillStyle = col; for (let q = 0; q < 6; q++) { g.beginPath(); g.arc(xx + 4 + q * (ww / 6), yy + 12, 4, 0, Math.PI * 2); g.fill(); }
      }
      shelf(['#6fb04a', '#e9d24a', '#e04a2a']);
    }
    if (kind === 4) {
      // espejos y sillones de peluquería
      for (let k = 0; k < 3; k++) {
        g.fillStyle = '#a9c2d4'; g.fillRect(bx0 + 8 + k * 44, by0 + 20, 32, 46);
        g.fillStyle = '#1b1b1f'; g.fillRect(x + 30 + k * 70, y + 180, 40, 36); g.fillRect(x + 36 + k * 70, y + 150, 28, 34);
      }
    }
    // silueta de un dependiente o un cliente
    if (rnd() < 0.8) {
      const px = x + 90 + rnd() * 70, py = y + 120;
      g.fillStyle = '#2a2622'; g.fillRect(px, py + 22, 22, 50); g.beginPath(); g.arc(px + 11, py + 12, 10, 0, Math.PI * 2); g.fill();
    }
    // brillo de noche: el interior entero, algo apagado en los bordes
    gg.drawImage(c, x, y, W, H, x, y, W, H);
    gg.fillStyle = 'rgba(0,0,0,0.35)'; gg.fillRect(x, y, W, H);
  });

  // Toldos a rayas
  [['#b75b32', '#e6dcc4'], ['#2f5a3a', '#e6dcc4']].forEach(([a, b], i) => {
    const x = i * 512, y = 1024;
    for (let k = 0; k < 16; k++) { g.fillStyle = k % 2 ? a : b; g.fillRect(x + k * 32, y, 32, 128); }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + 108, 512, 20);
    for (let k = 0; k < 16; k++) { g.fillStyle = k % 2 ? a : b; g.beginPath(); g.arc(x + k * 32 + 16, y + 112, 16, 0, Math.PI); g.fill(); }
  });

  const mk = (cv: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.anisotropy = 4;
    return t;
  };
  atlas = { map: mk(c), glow: mk(gc) };
}

let mats: { interior: THREE.MeshStandardMaterial; signLit: THREE.MeshStandardMaterial; sign: THREE.MeshStandardMaterial; awning: THREE.MeshStandardMaterial; frame: THREE.MeshStandardMaterial } | null = null;
export function shopMaterials() {
  if (mats) return mats;
  if (!atlas) buildAtlas();
  const a = atlas!;
  mats = {
    interior: new THREE.MeshStandardMaterial({ map: a.map, emissiveMap: a.glow, emissive: 0xffe2b0, emissiveIntensity: 0, color: 0x8a8a8a, roughness: 0.15, metalness: 0.3, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    signLit: new THREE.MeshStandardMaterial({ map: a.map, emissiveMap: a.glow, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 }),
    sign: new THREE.MeshStandardMaterial({ map: a.map, roughness: 0.7 }),
    awning: new THREE.MeshStandardMaterial({ map: a.map, roughness: 0.9, side: THREE.DoubleSide }),
    frame: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.5, metalness: 0.6 }),
  };
  return mats;
}

/** Ajuste día/noche: los locales encienden escaparates y rótulos al anochecer. */
export function setShopNight(n: number) {
  const m = shopMaterials();
  const k = Math.max(0, Math.min(1, (n - 0.15) / 0.45));
  m.interior.emissiveIntensity = 1.1 * k;
  m.signLit.emissiveIntensity = 1.6 * k;
}

class Quads {
  pos: number[] = []; uv: number[] = []; nrm: number[] = [];
  /** Cuadrilátero vertical de anchura w y altura h centrado en (cx, y0..y0+h), con su normal (nx,nz); u a lo largo de (dx,dz). */
  add(cx: number, cz: number, y0: number, w: number, h: number, _dx: number, _dz: number, nx: number, nz: number, r: number[], lean = 0) {
    // u siempre hacia la derecha de quien mira la cara de frente (el texto nunca sale en espejo)
    const dx = nz, dz = -nx;
    const ax = cx - dx * w / 2, az = cz - dz * w / 2, bx = cx + dx * w / 2, bz = cz + dz * w / 2;
    const tx = nx * lean, tz = nz * lean; // el borde superior sale hacia fuera (toldos)
    const P = [[ax, y0, az], [bx, y0, bz], [bx + tx, y0 + h, bz + tz], [ax + tx, y0 + h, az + tz]];
    const U = [[r[0], r[3]], [r[2], r[3]], [r[2], r[1]], [r[0], r[1]]];
    for (const k of [0, 1, 2, 0, 2, 3]) { this.pos.push(...P[k]); this.uv.push(...U[k]); this.nrm.push(nx, lean ? 0.5 : 0, nz); }
  }
  /** Caja orientada (rótulo con grosor). */
  box(cx: number, cy: number, cz: number, w: number, h: number, d: number, dx: number, dz: number, nx: number, nz: number, front: number[]) {
    const fx = cx + nx * d / 2, fz = cz + nz * d / 2;
    this.add(fx, fz, cy - h / 2, w, h, dx, dz, nx, nz, front);
  }
  geometry() {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** Construye los locales comerciales de un grupo de fachadas. */
export function buildShopfronts(list: FacadeRun[]): THREE.Object3D[] {
  const m = shopMaterials();
  const interior = new Quads(), signLit = new Quads(), sign = new Quads(), awning = new Quads();
  const frames: THREE.Matrix4[] = [];
  const blades: { x: number; y: number; z: number; ang: number; lit: boolean; s: number }[] = [];
  for (const f of list) {
    if (f.style !== 0 && f.style !== 3 && f.style !== 5) continue;
    const gh = f.style === 0 ? 4.2 : 4.5;
    if (f.top - f.ground < gh + 2) continue;
    const dx = (f.bx - f.ax) / f.len, dz = (f.bz - f.az) / f.len;
    const k0 = Math.ceil((f.u0 + 0.2) / CELL), k1 = Math.floor((f.u0 + f.len - 0.2) / CELL) - 1;
    for (let k = k0; k <= k1; k++) {
      const hs = hash21(k + f.seed * 3, 11);
      if (hs < 0.3 || hs >= 0.75) continue; // local cerrado o con cierre metálico: lo pinta el shader
      const along = k * CELL + CELL / 2 - f.u0;
      const cx = f.ax + dx * along, cz = f.az + dz * along;
      const kind = Math.floor(hash21(k + 2, f.seed) * SIGNS.length);
      const s = SIGNS[kind];
      const lit = hash21(k + 9, f.seed) >= 0.55 || !!s.neon;
      // todos los locales con escaparate iluminado son visitables: bares, cafeterías, tiendas, farmacias, peluquerías…
      {
        const key = `${Math.round(cx * 10)}:${Math.round(cz * 10)}`;
        if (!shopDoors.has(key)) shopDoors.set(key, { key, x: cx + f.nx * 0.6, y: f.ground, z: cz + f.nz * 0.6, nx: f.nx, nz: f.nz, name: s.text, kind: s.kind === 1 ? 'bar' : 'tienda', neon: s.neon ?? s.fg });
      }
      // escaparate con interior (encima del cristal pintado)
      const inter = s.kind === 1 ? 1 : s.kind === 5 ? 5 : s.kind === 2 ? 2 : s.kind === 3 ? 3 : s.kind === 4 ? 4 : s.kind === 6 ? 6 : s.kind === 7 ? 7 : 0;
      interior.add(cx + f.nx * 0.03, cz + f.nz * 0.03, f.ground + 0.05, 3.0, gh * 0.78 - 0.08, dx, dz, f.nx, f.nz, uvInterior(inter));
      // perfilería del escaparate
      frames.push(new THREE.Matrix4().compose(new THREE.Vector3(cx + f.nx * 0.05, f.ground + gh * 0.39, cz + f.nz * 0.05), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-dz, dx)), new THREE.Vector3(1, gh * 0.78, 1)));
      if (hs >= 0.45) {
        // rótulo corrido sobre el escaparate
        (lit ? signLit : sign).box(cx, f.ground + gh * 0.865, cz, 3.3, gh * 0.14, 0.14, dx, dz, f.nx, f.nz, uvSign(kind));
        if (s.kind === 2 || (s.kind === 1 && hash21(k, f.seed + 4) > 0.5)) blades.push({ x: cx + dx * 1.9 + f.nx * 0.55, y: f.ground + gh + 0.6, z: cz + dz * 1.9 + f.nz * 0.55, ang: Math.atan2(f.nx, f.nz), lit, s: kind });
      } else if (hash21(k + 5, f.seed) > 0.4) {
        // toldo
        awning.add(cx + f.nx * 0.05, cz + f.nz * 0.05, f.ground + gh * 0.72, 3.3, 0.6, dx, dz, f.nx, f.nz, uvAwning(hash21(k + 6, f.seed) > 0.5 ? 1 : 0), 1.0);
      }
    }
  }
  // banderolas perpendiculares (cruz de farmacia, cartel de bar)
  for (const b of blades) {
    const px = Math.cos(b.ang), pz = -Math.sin(b.ang); // eje paralelo a la fachada → la banderola mira a lo largo de la calle
    const r = uvSign(b.s);
    const half = [r[0], r[1], (r[0] + r[2]) / 2 - 0.08, r[3]];
    (b.lit ? signLit : sign).add(b.x + px * 0.04, b.z + pz * 0.04, b.y, 0.9, 0.42, Math.sin(b.ang), Math.cos(b.ang), px, pz, half);
    (b.lit ? signLit : sign).add(b.x - px * 0.04, b.z - pz * 0.04, b.y, 0.9, 0.42, -Math.sin(b.ang), -Math.cos(b.ang), -px, -pz, half);
  }
  const out: THREE.Object3D[] = [];
  const add = (q: Quads, mat: THREE.Material) => {
    const g = q.geometry();
    if (!g) return;
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    out.push(mesh);
  };
  add(interior, m.interior); add(signLit, m.signLit); add(sign, m.sign); add(awning, m.awning);
  if (frames.length) {
    // marco del escaparate: dos montantes y un dintel, un solo InstancedMesh
    const fg = new THREE.BufferGeometry();
    const parts = [new THREE.BoxGeometry(0.08, 1, 0.08).translate(-1.52, 0, 0), new THREE.BoxGeometry(0.08, 1, 0.08).translate(1.52, 0, 0), new THREE.BoxGeometry(0.08, 1, 0.08).translate(0, 0, 0)];
    const pos: number[] = [], nrm: number[] = [];
    for (const p of parts) {
      const nonIdx = p.toNonIndexed();
      pos.push(...(nonIdx.attributes.position.array as Float32Array));
      nrm.push(...(nonIdx.attributes.normal.array as Float32Array));
    }
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fg.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    const im = new THREE.InstancedMesh(fg, m.frame, frames.length);
    frames.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.computeBoundingSphere();
    out.push(im);
  }
  return out;
}
