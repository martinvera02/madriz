import * as THREE from 'three';

/*
 * Personajes low-poly con proporciones humanas (estética sandbox de principios de los 2000):
 * torso modelado por secciones elípticas (pecho, cintura, cadera), brazos y piernas cónicos con codos
 * y rodillas, manos con pulgar, cabeza ovalada con nariz, orejas y pelo/gorra, ropa variada
 * (camiseta, sudadera con capucha, chaqueta abierta, chándal, vaqueros, zapatillas…).
 *
 * Todo el personaje es UNA malla con esqueleto (SkinnedMesh) y colores por vértice:
 * una sola llamada de dibujo por persona, y articulaciones animadas con un ciclo de paso suave
 * (rodillas y codos que se doblan, balanceo de cadera y hombros, cabeza estable).
 */

export interface Look {
  skin: number; shirt: number; pants: number; hair: number;
  shoes?: number; top?: 'tee' | 'long' | 'hoodie' | 'jacket'; inner?: number;
  hairStyle?: 'short' | 'buzz' | 'long' | 'cap' | 'beanie' | 'bald'; capColor?: number;
  female?: boolean; height?: number; build?: number; stripe?: boolean; beard?: boolean;
}

const SKINS = [0xf1c7a5, 0xe6b48f, 0xd19a72, 0xb07850, 0x8d5a3b, 0x5e3a26];
const SHIRTS = [0xb8202a, 0x2a4d8f, 0xe9e6df, 0x2b2d31, 0x3f6a4a, 0xc9a24a, 0x5e4a7a, 0x8a96a0, 0xb75b32, 0x1f2a3a, 0x6b2e2e, 0x9a8a6a];
const PANTS = [0x2b3a55, 0x1d1f24, 0x3c4250, 0x5a4a36, 0x34402f, 0x7a7266, 0x41526e];
const HAIRS = [0x15100c, 0x2e2117, 0x5a3a22, 0x8a6a40, 0xb39a70, 0x7a7a7a, 0x3a1f14];
const SHOES = [0xe9e6df, 0x1a1a1d, 0x5a3a24, 0x2b3a55, 0xb8202a];

export function randomLook(r: () => number = Math.random): Look {
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const female = r() < 0.48;
  const q = r();
  const top: Look['top'] = q < 0.35 ? 'tee' : q < 0.55 ? 'long' : q < 0.78 ? 'hoodie' : 'jacket';
  const h = r();
  const hairStyle: Look['hairStyle'] = female
    ? (h < 0.7 ? 'long' : h < 0.85 ? 'short' : 'beanie')
    : (h < 0.4 ? 'short' : h < 0.6 ? 'buzz' : h < 0.78 ? 'cap' : h < 0.9 ? 'beanie' : 'bald');
  return {
    skin: pick(SKINS), shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIRS), shoes: pick(SHOES),
    top, inner: pick([0xe9e6df, 0x2b2d31, 0x8a96a0, 0xc9a24a]), hairStyle, capColor: pick([0x1d1f24, 0xb8202a, 0x2a4d8f, 0xe9e6df, 0x3f6a4a]),
    female, height: (female ? 0.94 : 1.0) * (0.95 + r() * 0.09), build: 0.9 + r() * 0.25, stripe: r() < 0.2, beard: !female && r() < 0.25,
  };
}

// Huesos
const B = { root: 0, hips: 1, spine: 2, chest: 3, neck: 4, head: 5, shL: 6, elL: 7, haL: 8, shR: 9, elR: 10, haR: 11, thL: 12, knL: 13, ftL: 14, thR: 15, knR: 16, ftR: 17 } as const;

class Builder {
  pos: number[] = []; col: number[] = []; si: number[] = []; sw: number[] = []; idx: number[] = [];
  private c = new THREE.Color();
  private base = 0;
  begin() { this.base = this.pos.length / 3; }
  v(x: number, y: number, z: number, color: number, bone: number) {
    this.c.setHex(color);
    this.pos.push(x, y, z); this.col.push(this.c.r, this.c.g, this.c.b);
    this.si.push(bone, 0, 0, 0); this.sw.push(1, 0, 0, 0);
  }
  /**
   * Sólido por secciones elípticas horizontales (de abajo arriba). Cada anillo: [y, rx, rz, cx, cz].
   * seg lados. color por anillo (permite cinturón, puños, cuellos…), hueso por anillo.
   */
  rings(rings: number[][], seg: number, color: (i: number) => number, bone: (i: number) => number, capBottom = true, capTop = true) {
    // siempre de abajo arriba (si no, las caras quedarían del revés)
    if (rings.length > 1 && rings[0][0] > rings[rings.length - 1][0]) {
      const n0 = rings.length, c0 = color, b0 = bone;
      rings = rings.slice().reverse();
      color = (i) => c0(n0 - 1 - i);
      bone = (i) => b0(n0 - 1 - i);
      [capBottom, capTop] = [capTop, capBottom];
    }
    this.begin();
    const n = rings.length;
    for (let i = 0; i < n; i++) {
      const [y, rx, rz, cx = 0, cz = 0] = rings[i];
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2 + Math.PI / seg;
        this.v(cx + Math.sin(a) * rx, y, cz + Math.cos(a) * rz, color(i), bone(i));
      }
    }
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < seg; k++) {
      const a = this.base + i * seg + k, b = this.base + i * seg + ((k + 1) % seg);
      const c = a + seg, d = b + seg;
      this.idx.push(a, b, d, a, d, c);
    }
    const cap = (i: number, up: boolean) => {
      const [y, , , cx = 0, cz = 0] = rings[i];
      const ci = this.pos.length / 3;
      this.v(cx, y + (up ? 0.005 : -0.005), cz, color(i), bone(i));
      for (let k = 0; k < seg; k++) {
        const a = this.base + i * seg + k, b = this.base + i * seg + ((k + 1) % seg);
        if (up) this.idx.push(a, b, ci); else this.idx.push(b, a, ci);
      }
    };
    if (capBottom) cap(0, false);
    if (capTop) cap(n - 1, true);
  }
  /** Miembro cónico entre dos alturas a lo largo de Y (en posición de reposo). */
  limb(x: number, z: number, y0: number, r0: number, y1: number, r1: number, color: number, bone: number, seg = 7, flat = 0.9, mid?: number) {
    const rs = [[y0, r0, r0 * flat, x, z]];
    if (mid !== undefined) rs.push([(y0 + y1) / 2, mid, mid * flat, x, z]);
    rs.push([y1, r1, r1 * flat, x, z]);
    this.rings(rs, seg, () => color, () => bone);
  }
  /** Caja (manos, zapatos, nariz, visera…). */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: number, bone: number, taper = 1) {
    this.begin();
    const P: number[][] = [];
    for (const y of [-1, 1]) for (const z of [-1, 1]) for (const x of [-1, 1]) {
      const t = y > 0 ? taper : 1;
      P.push([cx + x * sx / 2 * t, cy + y * sy / 2, cz + z * sz / 2 * t]);
    }
    P.forEach((p) => this.v(p[0], p[1], p[2], color, bone));
    const f = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
    for (const [a, b, c, d] of f) this.idx.push(this.base + a, this.base + b, this.base + c, this.base + a, this.base + c, this.base + d);
  }
  /** Elipsoide de baja resolución (cabeza, pelo, gorro). */
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, color: number, bone: number, seg = 9, rowsN = 6, yMin = -1, yMax = 1) {
    const rings: number[][] = [];
    for (let i = 0; i <= rowsN; i++) {
      const t = yMin + (yMax - yMin) * (i / rowsN);
      const r = Math.sqrt(Math.max(0.0001, 1 - t * t));
      rings.push([cy + t * ry, rx * r, rz * r, cx, cz]);
    }
    this.rings(rings, seg, () => color, () => bone, true, true);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

let sharedMat: THREE.MeshStandardMaterial | null = null;
function material() {
  if (!sharedMat) sharedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 });
  return sharedMat;
}

function shade(c: number, k: number) { return new THREE.Color(c).multiplyScalar(k).getHex(); }

/** Construye la geometría en reposo (de pie, brazos ligeramente separados). Medidas para 1,78 m. */
function buildBody(look: Look) {
  const g = new Builder();
  const f = !!look.female, w = look.build ?? 1;
  const skin = look.skin, top = look.shirt, pants = look.pants, shoes = look.shoes ?? 0x1a1a1d;
  const kind = look.top ?? 'tee';
  const sleeveLong = kind !== 'tee';
  const shW = (f ? 0.19 : 0.215) * w, hipW = (f ? 0.17 : 0.15) * w;

  // --- piernas (pantalón) y zapatillas
  for (const s of [-1, 1]) {
    const x = s * 0.095 * w;
    const th = s < 0 ? B.thL : B.thR, kn = s < 0 ? B.knL : B.knR, ft = s < 0 ? B.ftL : B.ftR;
    g.limb(x, 0, 0.92, 0.098 * w, 0.5, 0.068 * w, pants, th, 8, 0.95, 0.088 * w);
    g.limb(x, 0, 0.5, 0.068 * w, 0.09, 0.052 * w, pants, kn, 8, 0.95, 0.064 * w);
    if (look.stripe) g.box(x + s * 0.06 * w, 0.5, 0, 0.012, 0.8, 0.03, 0xe9e6df, th); // raya del chándal
    g.box(x, 0.045, 0.045, 0.1, 0.09, 0.27, shoes, ft, 0.85);
    g.box(x, 0.012, 0.045, 0.105, 0.025, 0.28, shade(shoes, shoes === 0xe9e6df ? 0.85 : 1.6), ft); // suela
  }
  // --- cadera, cintura y torso: tramos separados para que el cambio de color (cinturón, camiseta) sea nítido
  const chestZ = f ? 0.02 : 0.0;
  const waistR = (f ? 0.14 : 0.15) * w;
  const tuck = kind === 'tee' || kind === 'long';
  const hemY = tuck ? 1.0 : 0.9; // la sudadera y la chaqueta cubren la cintura
  g.rings([[0.86, hipW, 0.11], [hemY, hipW * 0.99 - (hemY - 0.86) * 0.2, 0.113]], 10, () => pants, () => B.hips, true, false);
  if (tuck) g.rings([[1.0, waistR * 1.04, 0.112 * w], [1.03, waistR * 1.03, 0.112 * w]], 10, () => shade(pants, 0.45), () => B.hips, false, false); // cinturón
  const t0 = tuck ? 1.03 : hemY;
  g.rings([
    [t0, tuck ? waistR * 1.04 : hipW * 1.03, tuck ? 0.115 * w : 0.12],
    [1.1, waistR * (tuck ? 1 : 1.06), 0.112 * w],
    [1.22, (f ? 0.155 : 0.178) * w, 0.122 * w, 0, chestZ],
    [1.36, shW * 0.96, 0.127 * w, 0, chestZ],
    [1.45, shW, 0.115 * w],
    [1.5, shW * 0.7, 0.088 * w],
  ], 10, () => top, (i) => (i <= 1 ? B.spine : B.chest), false, true);
  if (kind === 'jacket') {
    // chaqueta abierta: faldón algo más ancho y la camiseta interior por delante
    g.rings([[0.9, hipW * 1.06, 0.125], [1.1, 0.16 * w, 0.125 * w]], 10, () => top, () => B.spine, false, false);
    g.box(0, 1.2, 0.118 * w + chestZ, 0.12, 0.42, 0.012, look.inner ?? 0xe9e6df, B.chest);
  }
  if (kind === 'hoodie') {
    g.ellipsoid(0, 1.53, -0.1, 0.12, 0.06, 0.07, shade(top, 0.9), B.chest, 8, 4); // capucha a la espalda
    g.box(0, 1.15, 0.12 * w, 0.18, 0.12, 0.02, shade(top, 0.82), B.spine); // bolsillo canguro
  }
  // --- cuello y cabeza
  g.limb(0, 0, 1.5, 0.05, 1.6, 0.048, skin, B.neck, 7);
  const headY = 1.71;
  g.ellipsoid(0, headY, 0.005, 0.088, 0.115, 0.1, skin, B.head, 10, 7);
  g.box(0, headY - 0.01, 0.1, 0.03, 0.05, 0.04, shade(skin, 0.95), B.head, 0.7); // nariz
  for (const s of [-1, 1]) {
    g.box(s * 0.088, headY, -0.005, 0.02, 0.04, 0.035, shade(skin, 0.92), B.head); // orejas
    g.box(s * 0.032, headY + 0.025, 0.088, 0.024, 0.012, 0.01, 0x1a1512, B.head); // ojos
    g.box(s * 0.032, headY + 0.047, 0.09, 0.03, 0.008, 0.01, look.hair, B.head); // cejas
  }
  g.box(0, headY - 0.055, 0.088, 0.04, 0.008, 0.01, shade(skin, 0.7), B.head); // boca
  if (look.beard) g.ellipsoid(0, headY - 0.07, 0.03, 0.085, 0.05, 0.08, look.hair, B.head, 9, 4, -1, 0.3);
  const hs = look.hairStyle ?? 'short';
  if (hs === 'short' || hs === 'long' || hs === 'buzz') {
    const thick = hs === 'buzz' ? 0.006 : 0.016;
    g.ellipsoid(0, headY + 0.012, -0.008, 0.092 + thick, 0.115 + thick, 0.104 + thick, look.hair, B.head, 10, 5, -0.05, 1);
    if (hs === 'long') {
      g.rings([[headY - 0.2, 0.09, 0.05, 0, -0.07], [headY - 0.05, 0.1, 0.07, 0, -0.05], [headY + 0.05, 0.1, 0.08, 0, -0.03]], 9, () => look.hair, () => B.head);
    }
  } else if (hs === 'cap') {
    g.ellipsoid(0, headY + 0.03, -0.005, 0.098, 0.1, 0.108, look.capColor ?? 0x1d1f24, B.head, 10, 4, 0, 1);
    g.box(0, headY + 0.035, 0.15, 0.15, 0.015, 0.1, look.capColor ?? 0x1d1f24, B.head); // visera
  } else if (hs === 'beanie') {
    g.ellipsoid(0, headY + 0.03, -0.005, 0.1, 0.12, 0.11, look.capColor ?? 0x1d1f24, B.head, 10, 5, -0.15, 1);
  }
  // --- brazos: hombro → codo → muñeca, mano con pulgar
  for (const s of [-1, 1]) {
    const x = s * (shW + 0.02);
    const sh = s < 0 ? B.shL : B.shR, el = s < 0 ? B.elL : B.elR, ha = s < 0 ? B.haL : B.haR;
    g.ellipsoid(x - s * 0.02, 1.43, 0, 0.068 * w, 0.055, 0.07 * w, top, sh, 8, 4);
    g.limb(x, 0, 1.44, 0.066 * w, 1.15, 0.052 * w, top, sh, 8, 0.95, 0.06 * w);
    g.limb(x, 0.005, 1.15, 0.05 * w, 0.9, 0.038 * w, sleeveLong ? top : skin, el, 8, 0.9, 0.048 * w);
    if (!sleeveLong) g.limb(x, 0, 1.24, 0.068 * w, 1.15, 0.064 * w, top, sh, 8, 0.95); // manga corta
    else g.limb(x, 0.005, 0.95, 0.042 * w, 0.9, 0.04 * w, shade(top, 0.85), el, 7, 0.9); // puño
    g.box(x, 0.84, 0.01, 0.045, 0.11, 0.085, skin, ha, 0.85); // palma y dedos
    g.box(x - s * 0.005, 0.86, 0.05, 0.025, 0.05, 0.025, skin, ha); // pulgar
  }
  return g.geometry();
}

function makeSkeleton(height: number) {
  const bones: THREE.Bone[] = [];
  const mk = (parent: THREE.Bone | null, x: number, y: number, z: number) => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    if (parent) parent.add(b);
    bones.push(b);
    return b;
  };
  // posiciones de las articulaciones en reposo (coordenadas absolutas → relativas al padre)
  const root = mk(null, 0, 0, 0);
  const hips = mk(root, 0, 0.92, 0);
  const spine = mk(hips, 0, 0.12, 0);   // 1.04
  const chest = mk(spine, 0, 0.18, 0);  // 1.22
  const neck = mk(chest, 0, 0.28, 0);   // 1.50
  mk(neck, 0, 0.1, 0);                  // cabeza 1.60
  for (const s of [-1, 1]) {
    const sh = mk(chest, s * 0.235, 0.22, 0); // 1.44
    const el = mk(sh, 0, -0.29, 0);           // 1.15
    mk(el, 0, -0.25, 0);                      // 0.90
  }
  for (const s of [-1, 1]) {
    const th = mk(hips, s * 0.095, 0, 0); // 0.92
    const kn = mk(th, 0, -0.42, 0);       // 0.50
    mk(kn, 0, -0.41, 0);                  // 0.09
  }
  void height;
  // reordenar según B: root, hips, spine, chest, neck, head, shL, elL, haL, shR, elR, haR, thL, knL, ftL, thR, knR, ftR
  return bones;
}


// ------------------------------------------------------------------ acciones y objetos en la mano

export type Action =
  | 'none' | 'phone' | 'smoke' | 'arms' | 'look' | 'talk' | 'wave' | 'handsUp' | 'cower' | 'sit' | 'drink'
  | 'guitar' | 'sweep' | 'dance' | 'guard' | 'aimPistol' | 'aimRifle' | 'holdBat' | 'shout' | 'lean';
export type OneShot = 'punchL' | 'punchR' | 'swing' | 'kick' | 'hit' | 'recoil' | 'recoilBig' | 'stab';
export type Prop = 'none' | 'pistol' | 'smg' | 'shotgun' | 'bat' | 'phone' | 'cigarette' | 'beer' | 'guitar' | 'broom' | 'coffee';

const ONESHOT_LEN: Record<OneShot, number> = { punchL: 0.34, punchR: 0.34, swing: 0.55, kick: 0.6, hit: 0.4, recoil: 0.14, recoilBig: 0.3, stab: 0.3 };

const propCache = new Map<string, THREE.BufferGeometry>();
let propMat: THREE.MeshStandardMaterial | null = null;
/** Geometría de cada objeto en el espacio de la mano derecha (en la pose de apuntar: −Y adelante, +Z arriba). */
export function propGeometry(kind: Prop): THREE.BufferGeometry | null {
  if (kind === 'none') return null;
  const hit = propCache.get(kind);
  if (hit) return hit;
  const g = new Builder();
  const B0 = 0;
  const metal = 0x26282c, dark = 0x141518, wood = 0x6a4527;
  switch (kind) {
    case 'pistol':
      g.box(0, -0.07, 0.045, 0.03, 0.19, 0.045, metal, B0);
      g.box(0, -0.01, -0.01, 0.028, 0.045, 0.1, dark, B0);
      break;
    case 'smg':
      g.box(0, -0.12, 0.05, 0.04, 0.34, 0.06, metal, B0);
      g.box(0, -0.31, 0.055, 0.018, 0.08, 0.018, dark, B0);
      g.box(0, -0.06, -0.02, 0.026, 0.035, 0.12, dark, B0);
      g.box(0, -0.15, -0.03, 0.022, 0.035, 0.13, dark, B0); // cargador
      g.box(0, 0.08, 0.04, 0.025, 0.16, 0.03, dark, B0); // culata
      break;
    case 'shotgun':
      g.box(0, -0.25, 0.05, 0.035, 0.6, 0.035, metal, B0);
      g.box(0, -0.2, 0.02, 0.045, 0.3, 0.035, wood, B0); // corredera
      g.box(0, 0.05, 0.03, 0.04, 0.12, 0.06, metal, B0);
      g.box(0, 0.22, 0.0, 0.045, 0.26, 0.08, wood, B0); // culata
      g.box(0, 0.0, -0.02, 0.03, 0.04, 0.09, wood, B0);
      break;
    case 'bat':
      g.limb(0, 0, 0.06, 0.017, -0.12, 0.02, 0x2a1d14, B0, 7);
      g.limb(0, 0, -0.12, 0.02, -0.8, 0.036, 0xc89a62, B0, 8);
      break;
    case 'phone':
      g.box(0, -0.06, 0.03, 0.06, 0.12, 0.012, 0x111216, B0);
      g.box(0, -0.06, 0.037, 0.05, 0.1, 0.002, 0x5fa7d8, B0);
      break;
    case 'cigarette':
      g.box(0.03, -0.08, 0.0, 0.007, 0.06, 0.007, 0xe9e6df, B0);
      g.box(0.03, -0.11, 0.0, 0.008, 0.008, 0.008, 0xff6a2a, B0);
      break;
    case 'beer':
      g.limb(0, 0.0, -0.12, 0.035, 0.0, 0.03, 0xe6b84a, B0, 8);
      g.limb(0, 0.0, 0.0, 0.031, 0.02, 0.031, 0xf4f0e6, B0, 8);
      break;
    case 'coffee':
      g.limb(0, 0.0, -0.1, 0.03, 0.0, 0.034, 0xe9e6df, B0, 8);
      break;
    case 'broom':
      g.limb(0, 0, 0.5, 0.014, -0.9, 0.014, 0xb8a07a, B0, 6);
      g.box(0, -0.95, 0.06, 0.3, 0.08, 0.06, 0x2a7a3a, B0);
      break;
    case 'guitar':
      // se engancha al pecho, no a la mano
      g.ellipsoid(0.05, -0.12, 0.16, 0.2, 0.14, 0.06, 0x8a4a22, B0, 10, 5);
      g.ellipsoid(0.05, 0.05, 0.16, 0.16, 0.11, 0.06, 0x8a4a22, B0, 10, 5);
      g.box(-0.32, 0.12, 0.17, 0.5, 0.05, 0.03, 0x3a2414, B0);
      g.box(0.05, -0.02, 0.215, 0.07, 0.07, 0.01, 0x1a1210, B0);
      break;
  }
  const geo = g.geometry();
  geo.deleteAttribute('skinIndex');
  geo.deleteAttribute('skinWeight');
  propCache.set(kind, geo);
  return geo;
}
function propMaterial() {
  if (!propMat) propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 });
  return propMat;
}

/** Persona low-poly animada. */
export class Character {
  readonly root = new THREE.Group(); // posición/rotación en el mundo
  private readonly body = new THREE.Group(); // para tumbarlo al caer
  private readonly mesh: THREE.SkinnedMesh;
  private readonly b: THREE.Bone[];
  private phase = Math.random() * 6;
  private amp = 0;
  private runK = 0;
  private breath = Math.random() * 6;
  /** Acción de la parte superior (o de todo el cuerpo) mezclada sobre el andar. */
  action: Action = 'none';
  private actionW = 0;
  private actT = Math.random() * 10;
  private shot: OneShot | null = null;
  private shotT = 0;
  /** Inclinación de la mirada al apuntar (radianes, + hacia abajo). */
  aimPitch = 0;
  private propMesh: THREE.Mesh | null = null;
  private propKind: Prop = 'none';
  private prevAction: Action = 'none';
  private reloadT = 0;
  private reloadLen = 0;
  private reloadKind: Prop = 'none';

  constructor(look: Look) {
    const geo = buildBody(look);
    this.b = makeSkeleton(look.height ?? 1);
    // ajustar las posiciones de los huesos a las del modelo (hombros según la anchura)
    const w = look.build ?? 1, shW = (look.female ? 0.19 : 0.215) * w;
    this.b[B.shL].position.x = -(shW + 0.02);
    this.b[B.shR].position.x = shW + 0.02;
    this.b[B.thL].position.x = -0.095 * w;
    this.b[B.thR].position.x = 0.095 * w;
    this.mesh = new THREE.SkinnedMesh(geo, material());
    this.mesh.add(this.b[0]);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.b));
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false; // el esqueleto se mueve fuera del volumen en reposo
    const h = look.height ?? 1;
    this.body.scale.setScalar(h);
    this.body.add(this.mesh);
    this.root.add(this.body);
    this.pose(0, 0, 0, false);
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.skeleton.dispose(); }

  /** Rotaciones de todas las articulaciones para la fase del paso p, amplitud a (0..1) y carrera r (0..1). */
  private pose(p: number, a: number, r: number, air: boolean) {
    const b = this.b;
    const hipA = (0.42 + 0.35 * r) * a, kneeA = (0.55 + 0.7 * r) * a, armA = (0.32 + 0.45 * r) * a;
    for (const [s, off] of [[-1, 0], [1, Math.PI]] as const) {
      const q = p + off;
      const th = s < 0 ? b[B.thL] : b[B.thR], kn = s < 0 ? b[B.knL] : b[B.knR], ft = s < 0 ? b[B.ftL] : b[B.ftR];
      const sw = Math.sin(q);
      th.rotation.x = -sw * hipA - 0.05 * r;
      // la rodilla se dobla en la fase de vuelo (pierna avanzando) y un poco al apoyar
      const swing = Math.max(0, Math.cos(q));
      kn.rotation.x = kneeA * swing * swing + 0.08 * a + 0.12 * r;
      ft.rotation.x = -(th.rotation.x + kn.rotation.x) * 0.6 + 0.1 * a * Math.sin(q - 0.6);
      th.rotation.z = s * 0.03;
      const sh = s < 0 ? b[B.shL] : b[B.shR], el = s < 0 ? b[B.elL] : b[B.elR], ha = s < 0 ? b[B.haL] : b[B.haR];
      sh.rotation.x = sw * armA;
      sh.rotation.z = s * (0.05 + 0.05 * r);
      el.rotation.x = -(0.18 + 0.15 * a + 1.0 * r) - Math.max(0, sw) * 0.25 * a;
      ha.rotation.x = -0.1;
      if (air) { th.rotation.x = s < 0 ? -0.7 : -0.1; kn.rotation.x = s < 0 ? 1.1 : 0.4; sh.rotation.x = -1.2; sh.rotation.z = s * 0.5; el.rotation.x = -0.6; }
    }
    // tronco: giro opuesto de cadera y hombros, inclinación al correr, respiración en parado
    b[B.hips].rotation.y = Math.sin(p) * 0.07 * a;
    b[B.hips].rotation.z = Math.cos(p) * 0.035 * a;
    b[B.spine].rotation.x = 0.04 + 0.16 * r;
    b[B.chest].rotation.y = -Math.sin(p) * (0.1 + 0.05 * r) * a;
    b[B.chest].scale.setScalar(1 + Math.sin(this.breath) * 0.008 * (1 - a));
    // la cabeza compensa: mira siempre al frente
    b[B.neck].rotation.y = -(b[B.hips].rotation.y + b[B.chest].rotation.y) * 0.8;
    b[B.neck].rotation.x = -0.05 - 0.12 * r;
    // subida y bajada de la cadera: dos veces por ciclo, suave
    b[B.hips].position.y = 0.92 - (0.018 + 0.03 * r) * a * (1 - Math.cos(2 * p)) * 0.5;
  }

  /** speed en m/s; airborne para pose de salto. */
  animate(dt: number, speed: number, airborne = false) {
    // amplitud y "modo carrera" con transición suave
    const targetA = Math.min(1, speed / 2.5);
    const targetR = Math.max(0, Math.min(1, (speed - 4.5) / 2.5));
    this.amp += (targetA - this.amp) * Math.min(1, dt * 6);
    this.runK += (targetR - this.runK) * Math.min(1, dt * 4);
    // la fase avanza según la zancada (pasos más largos al correr): cadencia natural
    const stride = 0.85 + 0.55 * this.runK;
    this.phase += (dt * speed * Math.PI) / stride + (speed < 0.1 ? 0 : 0);
    if (speed < 0.1) this.phase += (Math.round(this.phase / Math.PI) * Math.PI - this.phase) * Math.min(1, dt * 4); // vuelve a pies juntos
    this.breath += dt * 1.6;
    this.pose(this.phase, this.amp, this.runK, airborne);
    this.applyAction(dt, airborne);
  }

  /** Cambiar la acción continua (se mezcla con suavidad). */
  setAction(a: Action) {
    if (a === this.action) return;
    this.prevAction = this.action;
    this.action = a;
    this.actionW = Math.min(this.actionW, 0.35);
  }

  /** Movimiento puntual (golpe, retroceso, impacto…) que se suma a la acción. */
  play(s: OneShot) { this.shot = s; this.shotT = 0; }
  get busy() { return this.shot !== null && this.shotT < ONESHOT_LEN[this.shot] * 0.8; }

  /** Animación de recarga (se suma a la pose de apuntar/empuñar). */
  reload(duration: number, kind: Prop) { this.reloadT = 0; this.reloadLen = duration; this.reloadKind = kind; }
  get reloading() { return this.reloadLen > 0 && this.reloadT < this.reloadLen; }

  /** Objeto en la mano derecha (o la guitarra colgada). */
  setProp(kind: Prop) {
    if (kind === this.propKind) return;
    this.propKind = kind;
    if (this.propMesh) { this.propMesh.parent?.remove(this.propMesh); this.propMesh = null; }
    const geo = propGeometry(kind);
    if (!geo) return;
    const m = new THREE.Mesh(geo, propMaterial());
    m.castShadow = true;
    if (kind === 'guitar') { m.position.set(0, -0.12, 0); m.rotation.set(0, 0, -0.5); this.b[B.chest].add(m); }
    else { m.position.set(0, -0.07, 0.02); this.b[B.haR].add(m); }
    this.propMesh = m;
  }

  /** Punto de la boca del arma en coordenadas de mundo. */
  /** ¿Tiene el arma ya levantada (pose de apuntar casi completa)? */
  get aimReady() { return (this.action === 'aimPistol' || this.action === 'aimRifle') && this.actionW > 0.8; }

  muzzle(out: THREE.Vector3) {
    const len = this.propKind === 'shotgun' ? 0.6 : this.propKind === 'smg' ? 0.36 : 0.19;
    out.set(0, -0.07 - len, 0.07);
    this.root.updateMatrixWorld(true);
    return out.applyMatrix4(this.b[B.haR].matrixWorld);
  }

  private applyAction(dt: number, air: boolean) {
    const b = this.b;
    this.actT += dt;
    const target = this.action === 'none' || air ? 0 : 1;
    this.actionW += (target - this.actionW) * Math.min(1, dt * 7);
    const w = this.actionW;
    const a = this.action !== 'none' ? this.action : this.prevAction;
    const t = this.actT;
    // fija una rotación mezclándola con la del andar
    const R = (i: number, x: number, y = 0, z = 0, k = w) => {
      const r = b[i].rotation;
      r.x += (x - r.x) * k; r.y += (y - r.y) * k; r.z += (z - r.z) * k;
    };
    const p = this.aimPitch;
    if (w > 0.01) switch (a) {
      case 'phone':
        R(B.shR, -0.75, 0, 0.12); R(B.elR, -1.35); R(B.haR, -0.4); R(B.neck, 0.35, 0, 0, w * 0.8); break;
      case 'smoke': {
        const c = (t % 5) / 5, up = c < 0.25 ? Math.sin((c / 0.25) * Math.PI) : 0;
        R(B.shR, -0.35 - 0.45 * up, 0, 0.18 + 0.2 * up); R(B.elR, -0.7 - 1.6 * up); R(B.neck, -0.12 * up, 0, 0, w * up);
        break;
      }
      case 'arms':
        R(B.shL, -0.55, 0.35, 0.25); R(B.shR, -0.55, -0.35, -0.25); R(B.elL, -1.75, 0.3); R(B.elR, -1.75, -0.3); break;
      case 'look':
        R(B.neck, 0.05, Math.sin(t * 0.6) * 0.8, 0, w * 0.9); break;
      case 'talk':
        R(B.shR, -0.35 + Math.sin(t * 2.7) * 0.25, 0, 0.12); R(B.elR, -1.0 + Math.sin(t * 2.1) * 0.45);
        R(B.shL, -0.2 + Math.sin(t * 1.9 + 1) * 0.15, 0, -0.12); R(B.elL, -0.7 + Math.sin(t * 1.6) * 0.3);
        R(B.neck, Math.sin(t * 2.4) * 0.08, Math.sin(t * 0.9) * 0.15, 0, w * 0.8); break;
      case 'shout':
        R(B.shR, -0.9, 0, 0.5); R(B.elR, -1.9); R(B.neck, -0.2 + Math.sin(t * 6) * 0.05); break;
      case 'wave':
        R(B.shR, 0, 0, 2.5); R(B.elR, 0, 0, Math.sin(t * 9) * 0.5); break;
      case 'handsUp':
        R(B.shL, 0, 0, -2.7); R(B.shR, 0, 0, 2.7); R(B.elL, -0.4); R(B.elR, -0.4); break;
      case 'cower':
        R(B.thL, -1.3); R(B.thR, -1.1); R(B.knL, 2.1); R(B.knR, 2.0); R(B.ftL, -0.6); R(B.ftR, -0.6);
        R(B.spine, 0.6); R(B.shL, -2.4, 0, -0.4); R(B.shR, -2.4, 0, 0.4); R(B.elL, -1.7); R(B.elR, -1.7);
        b[B.hips].position.y += (0.5 - b[B.hips].position.y) * w; break;
      case 'sit':
        R(B.thL, -1.5, 0, -0.08); R(B.thR, -1.5, 0, 0.08); R(B.knL, 1.45); R(B.knR, 1.45); R(B.ftL, 0.05); R(B.ftR, 0.05);
        R(B.shL, -0.35, 0, -0.1); R(B.shR, -0.35, 0, 0.1); R(B.elL, -0.9); R(B.elR, -0.9); R(B.spine, -0.08);
        b[B.hips].position.y += (0.5 - b[B.hips].position.y) * w; break;
      case 'drink': {
        const c = (t % 6) / 6, up = c < 0.3 ? Math.sin((c / 0.3) * Math.PI) : 0;
        R(B.shR, -0.5 - 0.5 * up, 0, 0.15); R(B.elR, -1.4 - 0.9 * up); R(B.neck, -0.25 * up, 0, 0, w * up); break;
      }
      case 'guitar':
        R(B.shL, -0.95, 0.45, 0.15); R(B.elL, -1.5); R(B.shR, -0.45, -0.2, -0.1); R(B.elR, -1.25 + Math.sin(t * 10) * 0.18);
        R(B.neck, 0.25 + Math.sin(t * 1.2) * 0.05, -0.2, 0, w * 0.7); break;
      case 'sweep':
        R(B.shL, -0.8, 0.3, 0.3); R(B.shR, -0.6, -0.1, -0.1); R(B.elL, -0.5); R(B.elR, -0.6);
        R(B.chest, 0.15, Math.sin(t * 2.4) * 0.45); R(B.spine, 0.2); break;
      case 'dance': {
        const k = Math.sin(t * 7.5);
        R(B.shL, -0.6 + k * 0.4, 0, -0.5 - Math.abs(k) * 0.6); R(B.shR, -0.6 - k * 0.4, 0, 0.5 + Math.abs(k) * 0.6);
        R(B.elL, -1.4); R(B.elR, -1.4); R(B.chest, 0, k * 0.25); R(B.hips, 0, -k * 0.2, k * 0.05);
        R(B.knL, 0.2 + Math.max(0, k) * 0.4); R(B.knR, 0.2 + Math.max(0, -k) * 0.4);
        b[B.hips].position.y += (0.9 - Math.abs(k) * 0.05 - b[B.hips].position.y) * w; break;
      }
      case 'lean':
        R(B.spine, -0.1, 0, 0.06); R(B.thR, -0.2, 0, 0.12); R(B.knR, 0.3); R(B.shL, 0.1); R(B.shR, 0.1); break;
      case 'guard':
        R(B.shL, -0.95, 0.35, 0.2); R(B.elL, -2.0); R(B.shR, -0.75, -0.3, -0.15); R(B.elR, -2.15); R(B.chest, 0, 0.25); break;
      case 'holdBat':
        R(B.shR, -0.25, 0, 0.12); R(B.elR, -0.35); R(B.haR, 0.4); break;
      case 'aimPistol':
        R(B.chest, p * 0.4, 0.15); R(B.shR, -1.55 + p * 0.6, 0, 0.05); R(B.elR, -0.05); R(B.haR, 0);
        R(B.shL, -1.45 + p * 0.6, 0, 0.5); R(B.elL, -0.3); R(B.neck, p * 0.5); break;
      case 'aimRifle':
        R(B.chest, p * 0.4, 0.35); R(B.shR, -1.05 + p * 0.6, 0.3, 0.25); R(B.elR, -1.2); R(B.haR, 0.1);
        R(B.shL, -1.4 + p * 0.6, 0.0, 0.45); R(B.elL, -0.3); R(B.neck, p * 0.5, -0.25); break;
    }
    // recarga: el arma baja y gira, la mano izquierda va al cinturón a por el cargador y vuelve
    if (this.reloadLen > 0 && this.reloadT < this.reloadLen) {
      this.reloadT += dt;
      const u = Math.min(1, this.reloadT / this.reloadLen);
      const env = Math.min(1, u * 6, (1 - u) * 6); // entrada y salida suaves
      if (this.reloadKind === 'shotgun') {
        // cartuchos uno a uno: la mano izquierda va y viene; al final, golpe de corredera
        const c = (u * 4) % 1, pump = u > 0.85 ? Math.sin(((u - 0.85) / 0.15) * Math.PI) : 0;
        R(B.shR, -0.8, 0.2, 0.15, env); R(B.elR, -1.3, 0, 0, env); R(B.haR, 0.5, 0, 0, env);
        R(B.shL, -0.6 + Math.sin(c * Math.PI) * 0.55, 0.3, 0.35, env); R(B.elL, -1.3 + Math.sin(c * Math.PI) * 0.6 + pump * 0.5, 0, 0, env);
        R(B.neck, 0.35, -0.2, 0, env);
      } else {
        const out = u < 0.35 ? Math.sin((u / 0.35) * Math.PI) : 0; // baja al cinturón
        const insert = u >= 0.35 && u < 0.75 ? Math.sin(((u - 0.35) / 0.4) * Math.PI) : 0; // mete el cargador
        const rack = u >= 0.75 ? Math.sin(((u - 0.75) / 0.25) * Math.PI) : 0; // tira de la corredera
        R(B.shR, -0.95, 0.15, 0.1, env); R(B.elR, -1.15, 0, 0, env); R(B.haR, 0.35 + insert * 0.3, 0, -0.4, env);
        R(B.shL, -0.2 * (1 - out) - 0.9 * insert - 1.0 * rack + 0.25 * out, 0.25, 0.3 * (insert + rack) - 0.15 * out, env);
        R(B.elL, -0.4 - 1.2 * insert - 1.5 * rack, 0, 0, env);
        R(B.neck, 0.35, -0.15, 0, env);
      }
    }
    // golpes y retrocesos puntuales
    if (this.shot) {
      this.shotT += dt;
      const L = ONESHOT_LEN[this.shot];
      const k = Math.sin(Math.min(1, this.shotT / L) * Math.PI); // 0 → 1 → 0
      switch (this.shot) {
        case 'punchR': R(B.shR, -1.55, 0.1, -0.1, k); R(B.elR, -0.1, 0, 0, k); R(B.chest, 0, -0.45, 0, k); break;
        case 'punchL': R(B.shL, -1.55, -0.1, 0.1, k); R(B.elL, -0.1, 0, 0, k); R(B.chest, 0, 0.45, 0, k); break;
        case 'stab': R(B.shR, -1.3, 0, 0, k); R(B.elR, -0.3, 0, 0, k); break;
        case 'swing': {
          const u = Math.min(1, this.shotT / L);
          R(B.chest, 0, -1.1 + u * 2.2, 0, Math.min(1, k * 1.5));
          R(B.shR, -1.3, 0, 0.2, Math.min(1, k * 1.5)); R(B.shL, -1.2, 0.5, 0.4, Math.min(1, k * 1.5));
          R(B.elR, -0.4, 0, 0, k); R(B.elL, -0.6, 0, 0, k); break;
        }
        case 'kick': R(B.thR, -1.4, 0, 0, k); R(B.knR, 0.2 + (1 - k) * 0.8, 0, 0, k); R(B.spine, -0.25, 0, 0, k); R(B.shL, -0.6, 0, -0.4, k); break;
        case 'hit': R(B.spine, -0.35, 0, 0, k); R(B.neck, -0.4, 0, 0, k); R(B.shL, 0.4, 0, -0.5, k); R(B.shR, 0.4, 0, 0.5, k); break;
        case 'recoil': b[B.shR].rotation.x -= 0.18 * k; b[B.shL].rotation.x -= 0.12 * k; b[B.elR].rotation.x -= 0.1 * k; break;
        case 'recoilBig': b[B.shR].rotation.x -= 0.45 * k; b[B.shL].rotation.x -= 0.35 * k; b[B.chest].rotation.x -= 0.15 * k; break;
      }
      if (this.shotT >= L) this.shot = null;
    }
  }

  /** Tumbado en el suelo (atropellado / derribado). t de 0 a 1. */
  setDown(t: number) {
    this.body.rotation.x = -Math.PI / 2 * t;
    this.body.position.y = 0.12 * t;
    const b = this.b;
    b[B.shL].rotation.x = b[B.shR].rotation.x = -2.6 * t;
    b[B.elL].rotation.x = b[B.elR].rotation.x = -0.3 * t;
    b[B.thL].rotation.x = 0.1 * t; b[B.thR].rotation.x = -0.25 * t;
    b[B.knL].rotation.x = 0.2 * t; b[B.knR].rotation.x = 0.5 * t;
  }

  reset() {
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
  }

  /** Postura sentada (conductores): muslos al frente, rodillas dobladas, manos al volante. */
  sit() {
    const b = this.b;
    for (const s of [-1, 1]) {
      (s < 0 ? b[B.thL] : b[B.thR]).rotation.set(-1.45, 0, s * 0.08);
      (s < 0 ? b[B.knL] : b[B.knR]).rotation.x = 1.35;
      (s < 0 ? b[B.ftL] : b[B.ftR]).rotation.x = 0.1;
      (s < 0 ? b[B.shL] : b[B.shR]).rotation.set(-0.95, 0, s * 0.12);
      (s < 0 ? b[B.elL] : b[B.elR]).rotation.x = -0.55;
    }
    b[B.spine].rotation.x = -0.12;
    b[B.neck].rotation.x = 0.1;
  }
}

