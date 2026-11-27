import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/*
 * Modelos de vehículos generados a partir de su perfil lateral real (cotas en metros):
 * carrocería extruida con biseles, pasos de rueda, planta redondeada en morro y zaga,
 * habitáculo con caída de los laterales, lunas, interior, faros, matrículas españolas y rotulación
 * (taxi de Madrid y autobús de la EMT).
 *
 * Ejes locales: +Z hacia delante, +Y arriba, +X = lado izquierdo (conductor).
 */

type P2 = [number, number]; // [z, y]

export interface BodySpec {
  L: number; W: number; R: number; wheelW: number;
  wf: number; wr: number; // z de los ejes delantero y trasero
  gb: number; // altura de los bajos
  /** Cadena del perfil desde abajo-delante, por el morro, capó, línea de cintura y zaga, hasta abajo-detrás. */
  body: P2[];
  /** Habitáculo (polígono): base sobre la cintura, montantes y techo. */
  cabin: P2[];
  cabBase: number; tumble: number; // ancho del habitáculo (fracción) y caída de los laterales
  planFront: [number, number]; planRear: [number, number]; // redondeo en planta [radio m, fracción]
  windshield: [P2, P2]; rearGlass: [P2, P2];
  sideWin: [number, number][]; // tramos de ventanillas laterales (z)
  lamps: { headY: number; tailY: number; headW: number };
  sill?: number; // altura del faldón plástico
  cladding?: number; // altura de las molduras plásticas (SUV)
  roofRails?: boolean;
  spoiler?: boolean;
}

export const BODIES: Record<string, BodySpec> = {
  // Utilitario tipo Ibiza/Corsa (4,06 m)
  utilitario: {
    L: 4.06, W: 1.76, R: 0.31, wheelW: 0.2, wf: 1.23, wr: -1.33, gb: 0.17,
    body: [[2.03, 0.33], [2.02, 0.6], [1.88, 0.77], [0.8, 0.93], [-1.82, 0.98], [-2.0, 0.93], [-2.03, 0.55], [-2.0, 0.3]],
    cabin: [[-1.86, 0.95], [0.82, 0.91], [0.04, 1.4], [-0.6, 1.44], [-1.45, 1.42], [-1.88, 1.18]],
    cabBase: 0.9, tumble: 0.16, planFront: [0.55, 0.16], planRear: [0.4, 0.1],
    windshield: [[0.78, 0.94], [0.07, 1.38]], rearGlass: [[-1.86, 1.0], [-1.47, 1.39]],
    sideWin: [[-0.28, 0.72], [-1.42, -0.36]],
    lamps: { headY: 0.72, tailY: 0.86, headW: 0.42 }, sill: 0.3,
  },
  // Compacto tipo Golf/León (4,28 m)
  compacto: {
    L: 4.28, W: 1.79, R: 0.32, wheelW: 0.21, wf: 1.29, wr: -1.34, gb: 0.16,
    body: [[2.14, 0.34], [2.13, 0.6], [1.98, 0.78], [0.82, 0.95], [-1.9, 1.0], [-2.1, 0.95], [-2.14, 0.56], [-2.1, 0.3]],
    cabin: [[-1.95, 0.97], [0.84, 0.93], [0.02, 1.43], [-0.8, 1.47], [-1.6, 1.44], [-1.98, 1.15]],
    cabBase: 0.9, tumble: 0.17, planFront: [0.55, 0.15], planRear: [0.45, 0.1],
    windshield: [[0.8, 0.96], [0.05, 1.41]], rearGlass: [[-1.95, 1.02], [-1.62, 1.41]],
    sideWin: [[-0.3, 0.74], [-1.5, -0.38]],
    lamps: { headY: 0.74, tailY: 0.88, headW: 0.44 }, sill: 0.3, spoiler: true,
  },
  // Berlina de 3 volúmenes tipo Corolla/Octavia (4,65 m): también la base del taxi
  berlina: {
    L: 4.65, W: 1.81, R: 0.33, wheelW: 0.22, wf: 1.395, wr: -1.305, gb: 0.15,
    body: [[2.325, 0.34], [2.32, 0.6], [2.15, 0.76], [0.98, 0.92], [-1.55, 0.98], [-2.2, 0.97], [-2.32, 0.88], [-2.325, 0.55], [-2.29, 0.3]],
    cabin: [[-1.6, 0.96], [1.0, 0.9], [0.18, 1.4], [-0.5, 1.45], [-1.0, 1.42], [-1.62, 1.0]],
    cabBase: 0.9, tumble: 0.17, planFront: [0.6, 0.15], planRear: [0.5, 0.1],
    windshield: [[0.96, 0.93], [0.2, 1.38]], rearGlass: [[-1.58, 1.01], [-1.04, 1.4]],
    sideWin: [[-0.2, 0.88], [-1.2, -0.28]],
    lamps: { headY: 0.72, tailY: 0.86, headW: 0.46 }, sill: 0.3,
  },
  // SUV compacto tipo Qashqai/Ateca (4,42 m)
  suv: {
    L: 4.42, W: 1.84, R: 0.36, wheelW: 0.23, wf: 1.37, wr: -1.3, gb: 0.22,
    body: [[2.21, 0.42], [2.2, 0.75], [2.03, 0.93], [0.88, 1.07], [-1.95, 1.12], [-2.17, 1.06], [-2.21, 0.62], [-2.17, 0.36]],
    cabin: [[-2.02, 1.09], [0.9, 1.05], [0.12, 1.55], [-0.8, 1.6], [-1.75, 1.58], [-2.06, 1.32]],
    cabBase: 0.9, tumble: 0.15, planFront: [0.55, 0.14], planRear: [0.45, 0.1],
    windshield: [[0.86, 1.08], [0.15, 1.53]], rearGlass: [[-2.02, 1.14], [-1.78, 1.55]],
    sideWin: [[-0.32, 0.8], [-1.62, -0.4]],
    lamps: { headY: 0.88, tailY: 1.0, headW: 0.46 }, sill: 0.4, cladding: 0.5, roofRails: true, spoiler: true,
  },
  // Furgoneta pequeña tipo Kangoo/Berlingo (4,49 m)
  furgoneta: {
    L: 4.49, W: 1.86, R: 0.33, wheelW: 0.21, wf: 1.42, wr: -1.3, gb: 0.19,
    body: [[2.245, 0.38], [2.24, 0.68], [2.08, 0.9], [1.25, 1.04], [-2.2, 1.06], [-2.245, 1.0], [-2.245, 0.4]],
    cabin: [[-2.22, 1.04], [1.27, 1.02], [0.55, 1.68], [0.2, 1.8], [-2.2, 1.82], [-2.24, 1.7]],
    cabBase: 0.95, tumble: 0.06, planFront: [0.5, 0.14], planRear: [0.2, 0.04],
    windshield: [[1.23, 1.05], [0.58, 1.66]], rearGlass: [[-2.235, 1.15], [-2.235, 1.7]],
    sideWin: [[0.05, 1.08]],
    lamps: { headY: 0.82, tailY: 1.0, headW: 0.42 }, sill: 0.35,
  },
  // Furgón de reparto tipo Sprinter/Transit (5,93 m)
  furgon: {
    L: 5.93, W: 2.02, R: 0.37, wheelW: 0.22, wf: 2.0, wr: -1.66, gb: 0.24,
    body: [[2.965, 0.45], [2.95, 0.82], [2.72, 1.02], [2.0, 1.14], [-2.92, 1.14], [-2.965, 1.1], [-2.965, 0.45]],
    cabin: [[-2.95, 1.12], [2.02, 1.12], [1.35, 1.9], [0.9, 2.55], [-2.9, 2.58], [-2.96, 2.5]],
    cabBase: 0.97, tumble: 0.05, planFront: [0.5, 0.12], planRear: [0.15, 0.03],
    windshield: [[1.98, 1.16], [1.38, 1.86]], rearGlass: [[-2.97, 1.6], [-2.97, 1.6]],
    sideWin: [[1.0, 1.85]],
    lamps: { headY: 0.95, tailY: 0.9, headW: 0.4 }, sill: 0.42,
  },
  // Deportivo tipo coupé (4,38 m)
  deportivo: {
    L: 4.38, W: 1.9, R: 0.35, wheelW: 0.26, wf: 1.32, wr: -1.13, gb: 0.12,
    body: [[2.19, 0.28], [2.18, 0.48], [1.9, 0.66], [0.6, 0.82], [-1.5, 0.88], [-2.08, 0.86], [-2.19, 0.76], [-2.19, 0.42], [-2.12, 0.24]],
    cabin: [[-1.55, 0.86], [0.62, 0.81], [-0.3, 1.23], [-0.75, 1.26], [-1.2, 1.18], [-1.58, 0.9]],
    cabBase: 0.86, tumble: 0.2, planFront: [0.7, 0.2], planRear: [0.55, 0.14],
    windshield: [[0.58, 0.83], [-0.26, 1.22]], rearGlass: [[-1.53, 0.9], [-1.2, 1.16]],
    sideWin: [[-1.25, 0.42]],
    lamps: { headY: 0.6, tailY: 0.78, headW: 0.5 }, sill: 0.22, spoiler: true,
  },
};

// ---------------------------------------------------------------- utilidades geométricas

class Mesher {
  pos: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  extra: number[] = []; // atributo libre (tipo de luz)
  private c = new THREE.Color();

  /** Triángulo orientado para que su normal apunte hacia `n`. */
  tri(a: number[], b: number[], c: number[], n: number[], color: number, k = 0, uvs?: number[][]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const pts = flip ? [a, c, b] : [a, b, c];
    const tuv = uvs ? (flip ? [uvs[0], uvs[2], uvs[1]] : uvs) : null;
    this.c.setHex(color);
    for (let i = 0; i < 3; i++) {
      this.pos.push(pts[i][0], pts[i][1], pts[i][2]);
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.extra.push(k);
      if (tuv) this.uv.push(tuv[i][0], tuv[i][1]); else this.uv.push(0, 0);
    }
  }
  quad(a: number[], b: number[], c: number[], d: number[], n: number[], color: number, k = 0, uvs?: number[][]) {
    this.tri(a, b, c, n, color, k, uvs ? [uvs[0], uvs[1], uvs[2]] : undefined);
    this.tri(a, c, d, n, color, k, uvs ? [uvs[0], uvs[2], uvs[3]] : undefined);
  }
  /** Caja alineada (centro y tamaño). */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: number, k = 0) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], color, k);
    this.quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [-1, 0, 0], color, k);
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], color, k);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], color, k);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], color, k);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], color, k);
  }
  /** Cilindro de eje X. */
  cylX(cx: number, cy: number, cz: number, r: number, len: number, seg: number, color: number, k = 0) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (a: number, x: number) => [x, cy + Math.cos(a) * r, cz + Math.sin(a) * r];
      const am = (a0 + a1) / 2;
      this.quad(p(a0, cx - len / 2), p(a1, cx - len / 2), p(a1, cx + len / 2), p(a0, cx + len / 2), [0, Math.cos(am), Math.sin(am)], color, k);
      this.tri([cx + len / 2, cy, cz], p(a0, cx + len / 2), p(a1, cx + len / 2), [1, 0, 0], color, k);
      this.tri([cx - len / 2, cy, cz], p(a0, cx - len / 2), p(a1, cx - len / 2), [-1, 0, 0], color, k);
    }
  }
  /** Calcomanía: rectángulo centrado en c con vector derecha r (unitario), en el plano vertical. */
  decal(c: number[], r: number[], hw: number, hh: number, uvr: number[]) {
    const n = [r[1] * 0 - r[2] * 1, r[2] * 0 - r[0] * 0, r[0] * 1 - r[1] * 0]; // r × up
    const p = (sx: number, sy: number) => [c[0] + r[0] * hw * sx, c[1] + hh * sy, c[2] + r[2] * hw * sx];
    const [u0, v0, u1, v1] = uvr;
    this.quad(p(-1, -1), p(1, -1), p(1, 1), p(-1, 1), n, 0xffffff, 0, [[u0, v1], [u1, v1], [u1, v0], [u0, v0]]);
  }
  geometry(creased = false, withUv = false, withExtra = false) {
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (withUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (withExtra) g.setAttribute('lk', new THREE.Float32BufferAttribute(this.extra, 1));
    if (creased) {
      g = toCreasedNormals(g, 0.55);
    } else g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

function signedArea(p: P2[]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return a / 2;
}
/** Desplaza el polígono (antihorario en z,y) hacia dentro una distancia d. */
function inset(p: P2[], d: number): P2[] {
  const n = p.length, out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
    const e1 = norm2(b[0] - a[0], b[1] - a[1]), e2 = norm2(c[0] - b[0], c[1] - b[1]);
    const n1: P2 = [-e1[1], e1[0]], n2: P2 = [-e2[1], e2[0]]; // hacia dentro (antihorario)
    const bis = norm2(n1[0] + n2[0], n1[1] + n2[1]);
    const k = d / Math.max(0.35, bis[0] * n1[0] + bis[1] * n1[1]);
    out.push([b[0] + bis[0] * k, b[1] + bis[1] * k]);
  }
  return out;
}
function norm2(x: number, y: number): P2 { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }

/** Recorta un polígono a la franja z0 ≤ z ≤ z1 (Sutherland–Hodgman). */
function clipZ(poly: P2[], z0: number, z1: number): P2[] {
  const clip = (pts: P2[], keep: (p: P2) => boolean, cut: (a: P2, b: P2) => P2) => {
    const out: P2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ka = keep(a), kb = keep(b);
      if (ka) out.push(a);
      if (ka !== kb) out.push(cut(a, b));
    }
    return out;
  };
  const at = (z: number) => (a: P2, b: P2): P2 => { const t = (z - a[0]) / (b[0] - a[0]); return [z, a[1] + (b[1] - a[1]) * t]; };
  return clip(clip(poly, (p) => p[0] >= z0, at(z0)), (p) => p[0] <= z1, at(z1));
}


/**
 * Sólido por extrusión de un perfil lateral a lo ancho, con bisel en las aristas.
 * hw(z,y) = semiancho; color(z,y,edgeNormal) permite pintar molduras, pasos de rueda, etc.
 */
function loft(m: Mesher, prof: P2[], hw: (z: number, y: number) => number, bevel: number, color: (z: number, y: number, nz: number, ny: number, cap?: boolean) => number) {
  if (signedArea(prof) < 0) prof = prof.slice().reverse();
  // densificar el contorno: la triangulación de las tapas queda en franjas cortas y sin pliegues
  const dense: P2[] = [];
  for (let i = 0; i < prof.length; i++) {
    const a = prof[i], b = prof[(i + 1) % prof.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(l / 0.2));
    for (let k = 0; k < n; k++) dense.push([a[0] + (b[0] - a[0]) * (k / n), a[1] + (b[1] - a[1]) * (k / n)]);
  }
  prof = dense;
  const pin = inset(prof, bevel);
  const n = prof.length;
  // anillos: tapa izquierda (+x, perfil reducido), bisel izquierdo, bisel derecho, tapa derecha
  const ring = (i: number, r: number): number[] => {
    const [z, y] = prof[i], h = hw(z, y);
    if (r === 0) return [h, pin[i][1], pin[i][0]];
    if (r === 1) return [h - bevel, y, z];
    if (r === 2) return [-(h - bevel), y, z];
    return [-h, pin[i][1], pin[i][0]];
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dz = prof[j][0] - prof[i][0], dy = prof[j][1] - prof[i][1], l = Math.hypot(dz, dy) || 1;
    const on: number[] = [0, -dz / l, dy / l]; // normal exterior (x, y, z)
    const mz = (prof[i][0] + prof[j][0]) / 2, my = (prof[i][1] + prof[j][1]) / 2;
    const c = color(mz, my, on[2], on[1]);
    m.quad(ring(i, 0), ring(j, 0), ring(j, 1), ring(i, 1), [0.7, on[1] * 0.7, on[2] * 0.7], c);
    m.quad(ring(i, 1), ring(j, 1), ring(j, 2), ring(i, 2), on, c);
    m.quad(ring(i, 2), ring(j, 2), ring(j, 3), ring(i, 3), [-0.7, on[1] * 0.7, on[2] * 0.7], c);
  }
  // tapas laterales
  const contour = pin.map((p) => new THREE.Vector2(p[0], p[1]));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const f of faces) {
    for (const s of [1, -1]) {
      const v = f.map((k) => [s * hw(prof[k][0], prof[k][1]), pin[k][1], pin[k][0]]);
      const my = (pin[f[0]][1] + pin[f[1]][1] + pin[f[2]][1]) / 3, mz = (pin[f[0]][0] + pin[f[1]][0] + pin[f[2]][0]) / 3;
      m.tri(v[0], v[1], v[2], [s, 0, 0], color(mz, my, 0, 0, true));
    }
  }
}

/** Inserta los pasos de rueda en el borde inferior del perfil. */
function withArches(spec: BodySpec): P2[] {
  const { L, gb, R, wf, wr } = spec;
  const ra = R + 0.07, cy = R;
  const arch = (zw: number): P2[] => {
    const s = (gb - cy) / ra;
    const a1 = Math.asin(s), a2 = Math.PI - Math.asin(s);
    const out: P2[] = [];
    const N = 10;
    for (let k = 0; k <= N; k++) {
      const a = a2 + (a1 - a2) * (k / N);
      out.push([zw + Math.cos(a) * ra, cy + Math.sin(a) * ra]);
    }
    return out;
  };
  return [[-L / 2 + 0.12, gb], ...arch(wr), ...arch(wf), [L / 2 - 0.12, gb], ...spec.body];
}

// ---------------------------------------------------------------- atlas de rótulos

const ATLAS = 1024;
let atlasTex: THREE.Texture | null = null, atlasGlow: THREE.Texture | null = null;
const PLATES = ['4271 LKB', '2958 KXD', '0614 MPF', '7735 HJN', '1189 NBC', '5502 GZR', '8043 JTL', '3376 MDW'];
const DEST = ['27  EMBAJADORES · PZA. CASTILLA', '5  SOL/SEVILLA · CHAMARTÍN', '3  PTA. TOLEDO · SAN AMARO', '2  MANUEL BECERRA · REINA VICTORIA'];
/** Rectángulos UV [u0,v0,u1,v1] (v hacia abajo, como en el canvas). */
const R_ = (x: number, y: number, w: number, h: number) => [x / ATLAS, 1 - y / ATLAS, (x + w) / ATLAS, 1 - (y + h) / ATLAS];
export const UV = {
  plate: (i: number) => R_((i % 4) * 256, Math.floor(i / 4) * 64, 250, 54),
  crest: R_(0, 128, 96, 120),
  taxiNum: (i: number) => R_(100 + (i % 4) * 160, 128 + 0, 150, 56),
  taxiSign: R_(100, 190, 300, 60),
  emt: R_(0, 256, 512, 140),
  dest: (i: number) => R_(0, 400 + i * 64, 1024, 60),
  emtFront: R_(520, 256, 300, 140),
  police: R_(0, 670, 1024, 84),
  police092: R_(0, 760, 256, 84),
};

function buildAtlas() {
  const c = document.createElement('canvas');
  c.width = c.height = ATLAS;
  const g = c.getContext('2d')!;
  const glow = document.createElement('canvas');
  glow.width = glow.height = ATLAS;
  const gg = glow.getContext('2d')!;
  gg.fillStyle = '#000'; gg.fillRect(0, 0, ATLAS, ATLAS);
  g.clearRect(0, 0, ATLAS, ATLAS);
  // Matrículas españolas (formato 0000 BBB con banda azul UE)
  PLATES.forEach((txt, i) => {
    const x = (i % 4) * 256, y = Math.floor(i / 4) * 64, w = 250, h = 54;
    g.fillStyle = '#111'; g.fillRect(x, y, w, h);
    g.fillStyle = '#f4f4f0'; g.fillRect(x + 2, y + 2, w - 4, h - 4);
    g.fillStyle = '#1d3f9b'; g.fillRect(x + 2, y + 2, 30, h - 4);
    g.fillStyle = '#f2c500';
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; g.fillRect(x + 16 + Math.cos(a) * 9, y + 18 + Math.sin(a) * 9, 2, 2); }
    g.fillStyle = '#fff'; g.font = 'bold 14px sans-serif'; g.textAlign = 'center'; g.fillText('E', x + 17, y + 46);
    g.fillStyle = '#111'; g.font = 'bold 40px "DIN Alternate", "Arial Narrow", sans-serif'; g.fillText(txt, x + 140, y + 43);
  });
  // Escudo de Madrid simplificado: corona, oso y madroño sobre campo de plata con bordura azul y estrellas
  {
    const x = 0, y = 128;
    g.fillStyle = '#d4a531'; g.fillRect(x + 22, y + 4, 52, 16); for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(x + 26 + k * 11, y + 4, 4, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#2a52a8';
    g.beginPath(); g.moveTo(x + 8, y + 22); g.lineTo(x + 88, y + 22); g.lineTo(x + 88, y + 80); g.quadraticCurveTo(x + 88, y + 116, x + 48, y + 118); g.quadraticCurveTo(x + 8, y + 116, x + 8, y + 80); g.closePath(); g.fill();
    g.fillStyle = '#eceae2';
    g.beginPath(); g.moveTo(x + 16, y + 30); g.lineTo(x + 80, y + 30); g.lineTo(x + 80, y + 80); g.quadraticCurveTo(x + 80, y + 108, x + 48, y + 110); g.quadraticCurveTo(x + 16, y + 108, x + 16, y + 80); g.closePath(); g.fill();
    g.fillStyle = '#2f7a36'; g.beginPath(); g.arc(x + 54, y + 52, 18, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c62828'; for (let k = 0; k < 9; k++) { g.beginPath(); g.arc(x + 44 + (k % 3) * 9, y + 44 + Math.floor(k / 3) * 8, 2.4, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#6b4123'; g.fillRect(x + 52, y + 66, 5, 30);
    g.beginPath(); g.ellipse(x + 40, y + 82, 16, 10, -0.5, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(x + 51, y + 70, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; for (let k = 0; k < 7; k++) { const a = Math.PI * (0.15 + 0.7 * (k / 6)); g.fillRect(x + 48 + Math.cos(a + Math.PI) * 36, y + 70 + Math.sin(a) * 40, 3, 3); }
  }
  // Números de licencia del taxi
  ['1824', '7305', '15532', '4096'].forEach((num, i) => {
    g.fillStyle = '#111'; g.font = 'bold 46px "Arial Narrow", sans-serif'; g.textAlign = 'center';
    g.fillText(num, 100 + i * 160 + 75, 128 + 48);
  });
  // Cartel de TAXI del techo
  g.fillStyle = '#f7f7f4'; g.fillRect(100, 190, 300, 60);
  g.fillStyle = '#111'; g.font = 'bold 52px sans-serif'; g.textAlign = 'center'; g.fillText('TAXI', 250, 240);
  // Rótulo EMT Madrid (blanco sobre transparente, para el lateral azul)
  const emt = (x: number, w: number) => {
    g.fillStyle = '#ffffff'; g.font = `italic bold ${Math.round(w * 0.36)}px "Arial Black", sans-serif`; g.textAlign = 'left';
    g.fillText('EMT', x + 10, 256 + 92);
    g.font = `bold ${Math.round(w * 0.11)}px sans-serif`; g.fillText('Madrid', x + 14 + w * 0.02, 256 + 130);
  };
  emt(0, 512);
  emt(520, 300);
  // Rotulación de la Policía Municipal (azul sobre transparente) y teléfono 092
  g.fillStyle = '#1d3f9b'; g.font = 'bold 70px "Arial Narrow", sans-serif'; g.textAlign = 'center';
  g.fillText('POLICÍA MUNICIPAL', 512, 670 + 66);
  g.fillStyle = '#1d3f9b'; g.font = 'bold 76px sans-serif'; g.fillText('092', 128, 760 + 70);
  // Indicadores de destino LED (ámbar sobre negro): brillan solos
  DEST.forEach((d, i) => {
    const y = 400 + i * 64;
    g.fillStyle = '#0b0b0b'; g.fillRect(0, y, 1024, 60);
    for (const ctx of [g, gg]) {
      ctx.fillStyle = '#ffae1a'; ctx.font = 'bold 44px "Courier New", monospace'; ctx.textAlign = 'center';
      ctx.fillText(d, 512, y + 45);
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const tg = new THREE.CanvasTexture(glow);
  tg.colorSpace = THREE.SRGBColorSpace;
  atlasTex = t; atlasGlow = tg;
}

// ---------------------------------------------------------------- materiales compartidos

export const vehicleUniforms = { night: { value: 0 }, time: { value: 0 } };
let mats: { paint: THREE.Material; glass: THREE.Material; decal: THREE.Material; wheel: THREE.Material; driver: THREE.Material } | null = null;
function materials() {
  if (mats) return mats;
  if (!atlasTex) buildAtlas();
  mats = {
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.35 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x3d5566, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.62, emissive: 0x0c1218 }),
    decal: new THREE.MeshStandardMaterial({ map: atlasTex, emissiveMap: atlasGlow, emissive: 0xffffff, emissiveIntensity: 1.2, alphaTest: 0.35, roughness: 0.5,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide }),
    driver: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
  };
  return mats;
}

/** Material de luces: cada vehículo tiene el suyo con su estado (freno, marcha atrás, intermitentes). */
export function lightMaterial() {
  const u = { uBrake: { value: 0 }, uRev: { value: 0 }, uBlinkL: { value: 0 }, uBlinkR: { value: 0 }, uSiren: { value: 0 }, uNight: vehicleUniforms.night, uTime: vehicleUniforms.time };
  const m = new THREE.MeshBasicMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float lk;\nvarying float vLk;\nvarying float vSide;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLk = lk;\nvSide = position.x;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBrake, uRev, uBlinkL, uBlinkR, uNight, uSiren, uTime;\nvarying float vLk;\nvarying float vSide;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float k = 1.0;
        if (vLk < 0.5) k = mix(0.55, 1.6, uNight);                         // faros
        else if (vLk < 1.5) k = max(mix(0.28, 0.75, uNight), uBrake * 1.5); // pilotos / freno
        else if (vLk < 2.5) k = 0.15 + uRev * 1.4;                         // marcha atrás
        else if (vLk < 3.5) k = 0.2 + 1.3 * (vSide > 0.0 ? uBlinkL : uBlinkR); // intermitentes
        else if (vLk < 4.5) k = 1.4;                                        // luz verde de taxi libre
        else if (vLk < 5.5) k = mix(0.9, 1.3, uNight);                     // luces de día / tercera luz
        else k = 0.15 + uSiren * 3.0 * step(0.5, fract(uTime * 2.6 + (vSide > 0.0 ? 0.5 : 0.0))); // rotativos azules
        diffuseColor.rgb *= k;`);
  };
  m.customProgramCacheKey = () => 'vehicle-lights';
  return { material: m, uniforms: u };
}

// ---------------------------------------------------------------- ruedas

const wheelCache = new Map<string, THREE.BufferGeometry>();
/** Rueda de radio 1 y anchura 1 (eje X): neumático con flanco y llanta. */
export function wheelGeometry(style: 'alloy' | 'sport' | 'steel' | 'bus') {
  const hit = wheelCache.get(style);
  if (hit) return hit;
  const m = new Mesher();
  const seg = 18;
  const tire = 0x161616, side = 0x232323;
  const rimC = style === 'steel' ? 0x3a3d42 : style === 'bus' ? 0xb9bcc0 : style === 'sport' ? 0x2a2a2c : 0xc4c8cc;
  const rr = style === 'bus' ? 0.62 : style === 'sport' ? 0.74 : 0.66; // radio de llanta
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
    const p = (a: number, r: number, x: number) => [x, Math.cos(a) * r, Math.sin(a) * r];
    // banda de rodadura y hombros redondeados
    m.quad(p(a0, 1, -0.4), p(a1, 1, -0.4), p(a1, 1, 0.4), p(a0, 1, 0.4), [0, Math.cos(am), Math.sin(am)], tire);
    for (const s of [1, -1]) {
      m.quad(p(a0, 1, 0.4 * s), p(a1, 1, 0.4 * s), p(a1, 0.95, 0.5 * s), p(a0, 0.95, 0.5 * s), [s * 0.6, Math.cos(am), Math.sin(am)], tire);
      m.quad(p(a0, 0.95, 0.5 * s), p(a1, 0.95, 0.5 * s), p(a1, rr, 0.47 * s), p(a0, rr, 0.47 * s), [s, 0, 0], side);
      // llanta: aro y cubo
      m.quad(p(a0, rr, 0.47 * s), p(a1, rr, 0.47 * s), p(a1, rr * 0.92, 0.42 * s), p(a0, rr * 0.92, 0.42 * s), [s, 0, 0], rimC);
      m.quad(p(a0, rr * 0.92, 0.3 * s), p(a1, rr * 0.92, 0.3 * s), p(a1, rr * 0.92, 0.42 * s), p(a0, rr * 0.92, 0.42 * s), [0, -Math.cos(am), -Math.sin(am)], 0x202224);
      m.tri([0.3 * s, 0, 0], p(a0, rr * 0.92, 0.3 * s), p(a1, rr * 0.92, 0.3 * s), [s, 0, 0], 0x141516);
    }
  }
  // radios de la llanta (5 dobles en aleación, 6 en deportiva, agujeros en la de chapa) y tuercas
  for (const s of [1, -1]) {
    const nSp = style === 'sport' ? 10 : style === 'alloy' ? 5 : 0;
    for (let k = 0; k < nSp; k++) {
      const a = (k / nSp) * Math.PI * 2;
      const w = style === 'sport' ? 0.07 : 0.14;
      const ca = Math.cos(a), sa = Math.sin(a);
      const pa = (r: number, o: number) => [0.36 * s + (r > 0.3 ? 0.05 * s : 0), ca * r - sa * o, sa * r + ca * o];
      m.quad(pa(0.16, -w / 2), pa(rr * 0.92, -w / 2), pa(rr * 0.92, w / 2), pa(0.16, w / 2), [s, 0, 0], rimC);
    }
    if (style === 'steel' || style === 'bus') {
      // disco de chapa con taladros
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const q = (a: number, r: number) => [0.36 * s, Math.cos(a) * r, Math.sin(a) * r];
        m.quad(q(a0, 0.16), q(a1, 0.16), q(a1, rr * 0.9), q(a0, rr * 0.9), [s, 0, 0], i % 3 === 0 && style === 'steel' ? 0x18191a : rimC);
      }
    }
    // buje y tuercas
    for (let i = 0; i < 10; i++) {
      const a0 = (i / 10) * Math.PI * 2, a1 = ((i + 1) / 10) * Math.PI * 2;
      m.tri([0.4 * s, 0, 0], [0.4 * s, Math.cos(a0) * 0.17, Math.sin(a0) * 0.17], [0.4 * s, Math.cos(a1) * 0.17, Math.sin(a1) * 0.17], [s, 0, 0], style === 'bus' ? 0x8a1c1c : 0x9a9ea3);
    }
    const nuts = style === 'bus' ? 10 : 5;
    for (let k = 0; k < nuts; k++) {
      const a = (k / nuts) * Math.PI * 2;
      m.box(0.42 * s, Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0.05, 0.05, 0.05, 0x6d7075);
    }
  }
  const g = m.geometry(true);
  wheelCache.set(style, g);
  return g;
}

// ---------------------------------------------------------------- conductor

let driverGeo: THREE.BufferGeometry | null = null;
export function driverGeometry() {
  if (driverGeo) return driverGeo;
  const m = new Mesher();
  m.box(0, 0.32, 0, 0.42, 0.55, 0.26, 0x3b4a66); // torso
  m.box(0, 0.7, 0.02, 0.2, 0.24, 0.22, 0xd9a47f); // cabeza
  m.box(0, 0.81, -0.01, 0.21, 0.07, 0.23, 0x2a1d14); // pelo
  m.box(0.16, 0.38, 0.22, 0.09, 0.09, 0.34, 0x3b4a66); // brazos al volante
  m.box(-0.16, 0.38, 0.22, 0.09, 0.09, 0.34, 0x3b4a66);
  driverGeo = m.geometry();
  return driverGeo;
}

// ---------------------------------------------------------------- modelo completo

export interface VehicleModel {
  body: THREE.BufferGeometry; // carrocería + interior (pintura, plásticos, cromados)
  glass: THREE.BufferGeometry;
  lights: THREE.BufferGeometry;
  decals: THREE.BufferGeometry | null;
  /** Pilares A y marco del techo vistos desde el asiento (solo en primera persona). */
  cockpit: THREE.BufferGeometry;
  /** Altura de los ojos del conductor. */
  eyeY: number;
  wheelStyle: 'alloy' | 'sport' | 'steel' | 'bus';
  wheels: { x: number; z: number; r: number; w: number; front: boolean }[];
  driverSeat: [number, number, number];
  materials: ReturnType<typeof materials>;
  /** Puntos característicos para efectos (escape, capó). */
  exhaust: [number, number, number];
  hood: [number, number, number];
}

export interface Livery { kind: 'plain' | 'taxi' | 'emt' | 'policia'; paint: number; plate: number; variant: number }

const DARK = 0x18191b, TRIM = 0x232425, CHROME = 0xb5b9be, GRILL = 0x0e0f10, INTERIOR = 0x262626, SEAT = 0x333335, ARCH = 0x0f0f10;

export function buildModel(typeId: string, liv: Livery): VehicleModel {
  // el furgón de la UIP es una furgoneta con la librea de la policía
  const id = typeId === 'uip' ? 'furgoneta' : typeId;
  if (id === 'autobus') return buildBus(liv);
  const spec = BODIES[id === 'taxi' || id === 'policia' ? 'berlina' : id];
  const { L, W, gb, wf, wr } = spec;
  const mats = materials();
  const body = new Mesher(), glass = new Mesher(), lights = new Mesher(), decals = new Mesher();
  const paint = liv.paint;
  const plan = (z: number) => {
    const df = L / 2 - z, dr = z + L / 2;
    const f = 1 - spec.planFront[1] * (1 - Math.min(1, df / spec.planFront[0])) ** 2;
    const r = 1 - spec.planRear[1] * (1 - Math.min(1, dr / spec.planRear[0])) ** 2;
    return Math.min(f, r);
  };
  const beltAt = (z: number) => {
    // altura de la línea de cintura (borde superior del perfil inferior) en z
    let best = 0;
    for (let i = 1; i < spec.body.length; i++) {
      const a = spec.body[i - 1], b = spec.body[i];
      if ((z - a[0]) * (z - b[0]) <= 0 && a[0] !== b[0]) best = Math.max(best, a[1] + (b[1] - a[1]) * (z - a[0]) / (b[0] - a[0]));
    }
    return best;
  };
  const topBelt = Math.max(...spec.body.map((p) => p[1]));
  const bodyHW = (z: number, _y: number) => (W / 2) * plan(z);
  const cabY0 = Math.min(...spec.cabin.map((p) => p[1])), cabY1 = Math.max(...spec.cabin.map((p) => p[1]));
  const cabHW = (y: number) => (W / 2) * spec.cabBase * (1 - spec.tumble * Math.max(0, Math.min(1, (y - cabY0) / (cabY1 - cabY0))));
  const profile = withArches(spec);
  const sill = spec.sill ?? 0.28, clad = spec.cladding ?? 0;
  loft(body, profile, bodyHW, 0.1, (z, y, nz, ny, cap) => {
    // pasos de rueda en negro; faldones y molduras de plástico
    const inArch = !cap && (Math.hypot(z - wf, y - spec.R) < spec.R + 0.12 || Math.hypot(z - wr, y - spec.R) < spec.R + 0.12) && ny < 0.2 && y < spec.R * 2 + 0.05 && Math.abs(nz) < 0.95;
    if (inArch) return ARCH;
    if (ny < -0.6) return DARK; // bajos
    if (y < sill && !cap) return TRIM;
    if (cap && y < sill - 0.06) return TRIM;
    if (clad && y < clad && Math.abs(nz) < 0.6) return TRIM;
    return paint;
  });
  loft(body, spec.cabin.map(([z, y]) => [z, y - 0.015] as P2), (_z, y) => cabHW(y), 0.05, () => paint);

  // ---- lunas
  const glassUp = 0.012;
  const sideGlass = (z0: number, z1: number) => {
    const poly = clipZ(inset(spec.cabin, 0.075), z0, z1);
    if (poly.length < 3) return;
    const faces = THREE.ShapeUtils.triangulateShape(poly.map((p) => new THREE.Vector2(p[0], p[1])), []);
    for (const s of [1, -1]) for (const f of faces) {
      const v = f.map((k) => [s * (cabHW(poly[k][1]) + glassUp), poly[k][1], poly[k][0]]);
      glass.tri(v[0], v[1], v[2], [s, 0, 0], 0xffffff);
    }
  };
  for (const [z0, z1] of spec.sideWin) sideGlass(z0, z1);
  const slantGlass = (e: [P2, P2], front: boolean) => {
    const [b, t] = e;
    if (Math.abs(b[1] - t[1]) < 0.05) return;
    const dz = t[0] - b[0], dy = t[1] - b[1], l = Math.hypot(dz, dy);
    const nz = front ? Math.abs(dy) / l : -Math.abs(dy) / l, ny = Math.abs(dz) / l;
    const off = (p: P2): P2 => [p[0] + nz * glassUp, p[1] + ny * glassUp];
    const bb = off([b[0] + dz / l * 0.04, b[1] + dy / l * 0.04]), tt = off([t[0] - dz / l * 0.06, t[1] - dy / l * 0.06]);
    const hb = cabHW(bb[1]) - 0.07, ht = cabHW(tt[1]) - 0.09;
    glass.quad([hb, bb[1], bb[0]], [-hb, bb[1], bb[0]], [-ht, tt[1], tt[0]], [ht, tt[1], tt[0]], [0, ny, nz], 0xffffff);
    // escobillas del limpiaparabrisas
    if (front) for (const s of [0.35, -0.15]) body.box(s, bb[1] + 0.02, bb[0] + 0.02, 0.55, 0.02, 0.025, DARK);
  };
  slantGlass(spec.windshield, true);
  slantGlass(spec.rearGlass, false);
  if (id === 'furgoneta' || id === 'furgon') {
    // portón trasero acristalado (dos hojas en el furgón no llevan cristal)
    if (id === 'furgoneta') {
      const z = -L / 2 - 0.004, hwr = W / 2 * plan(-L / 2 + 0.05) - 0.18;
      glass.quad([hwr, 1.16, z], [-hwr, 1.16, z], [-hwr, 1.66, z], [hwr, 1.66, z], [0, 0, -1], 0xffffff);
    } else {
      body.box(0, 1.5, -L / 2 - 0.005, 0.02, 2.2, 0.01, DARK); // junta de las puertas traseras
    }
  }

  // ---- morro: parrilla, faros, paragolpes, matrícula
  const zF = L / 2, zR = -L / 2;
  const hwF = (W / 2) * plan(zF - 0.06);
  const hl = spec.lamps;
  const grillW = id === 'deportivo' ? 0.9 : id === 'suv' ? 1.0 : 0.75;
  body.box(0, hl.headY - 0.06, zF - 0.02, grillW, 0.17, 0.05, GRILL); // parrilla superior
  body.box(0, 0.4 + (gb - 0.15), zF - 0.03, W * 0.62, 0.16, 0.05, GRILL); // toma inferior
  body.box(0, hl.headY - 0.06, zF + 0.002, grillW + 0.04, 0.02, 0.04, CHROME); // moldura cromada
  for (const s of [1, -1]) {
    const x = s * (hwF - hl.headW / 2 - 0.02);
    lights.box(x, hl.headY, zF - 0.03, hl.headW, 0.11, 0.06, 0xfff4dc, 0); // faro
    lights.box(x - s * hl.headW * 0.1, hl.headY - 0.065, zF - 0.025, hl.headW * 0.8, 0.018, 0.06, 0xdff0ff, 5); // luz diurna LED
    lights.box(s * (hwF - 0.06), hl.headY, zF - 0.06, 0.06, 0.08, 0.06, 0xff9a1a, 3); // intermitente
    body.box(s * (hwF - 0.25), 0.42 + (gb - 0.15), zF - 0.02, 0.18, 0.07, 0.05, 0x2b2b2b); // antiniebla
  }
  decals.decal([0, 0.5 + (gb - 0.15) + 0.04, zF + 0.006], [1, 0, 0], 0.26, 0.055, UV.plate(liv.plate));
  body.box(0, 0.55 + (gb - 0.15), zF - 0.01, 0.54, 0.13, 0.03, DARK);

  // ---- zaga: pilotos, matrícula, escape
  const hwR = (W / 2) * plan(zR + 0.06);
  for (const s of [1, -1]) {
    const x = s * (hwR - 0.2);
    lights.box(x, hl.tailY, zR + 0.03, 0.36, 0.13, 0.06, 0xc2141a, 1);
    lights.box(x - s * 0.05, hl.tailY - 0.11, zR + 0.03, 0.18, 0.05, 0.06, 0xf4f4f4, 2); // marcha atrás
    lights.box(x + s * 0.12, hl.tailY - 0.11, zR + 0.03, 0.1, 0.05, 0.06, 0xff9a1a, 3);
    body.box(s * (W / 2 - 0.03) * plan(zR + 0.4), sill + 0.06, zR + 0.4, 0.02, 0.05, 0.12, 0x9a2020); // catadióptrico
  }
  if (id !== 'furgon') lights.box(0, Math.max(...spec.cabin.map((p) => (p[0] < 0 ? p[1] : 0))) - 0.03, Math.min(...spec.cabin.map((p) => p[0])) + 0.08, 0.3, 0.03, 0.03, 0xd01418, 1); // tercera luz de freno
  const plateY = id === 'berlina' || id === 'taxi' ? hl.tailY - 0.02 : 0.58 + (gb - 0.15);
  decals.decal([0, plateY, zR - 0.006], [-1, 0, 0], 0.26, 0.055, UV.plate((liv.plate + 3) % 8));
  body.box(0, 0.36 + (gb - 0.15), zR + 0.02, W * 0.7, 0.12, 0.06, DARK); // difusor
  const exX = id === 'deportivo' ? 0.45 : 0.5;
  const ex: [number, number, number] = [exX, gb + 0.1, zR + 0.02];
  for (const s of id === 'deportivo' ? [1, -1] : [1]) {
    for (let k = 0; k < 8; k++) {
      const a0 = (k / 8) * Math.PI * 2, a1 = ((k + 1) / 8) * Math.PI * 2;
      const p = (a: number, z: number) => [s * exX + Math.cos(a) * 0.04, gb + 0.1 + Math.sin(a) * 0.04, z];
      body.quad(p(a0, zR - 0.04), p(a1, zR - 0.04), p(a1, zR + 0.15), p(a0, zR + 0.15), [Math.cos(a0), Math.sin(a0), 0], CHROME);
      body.tri([s * exX, gb + 0.1, zR - 0.035], p(a0, zR - 0.035), p(a1, zR - 0.035), [0, 0, -1], 0x050505);
    }
  }

  // ---- laterales: retrovisores, manillas, junta de puertas, antena, techo
  const wsBase = spec.windshield[0];
  for (const s of [1, -1]) {
    const mx = s * (cabHW(wsBase[1] + 0.12) + 0.1), my = wsBase[1] + 0.12, mz = wsBase[0] - 0.18;
    body.box(mx, my, mz, 0.2, 0.12, 0.08, paint); // carcasa del retrovisor
    body.box(mx - s * 0.08, my - 0.02, mz + 0.02, 0.1, 0.03, 0.05, DARK); // brazo
    glass.quad([mx + s * 0.08, my - 0.04, mz - 0.042], [mx - s * 0.08, my - 0.04, mz - 0.042], [mx - s * 0.08, my + 0.04, mz - 0.042], [mx + s * 0.08, my + 0.04, mz - 0.042], [0, 0, -1], 0xffffff);
    lights.box(mx + s * 0.06, my - 0.03, mz + 0.035, 0.06, 0.015, 0.02, 0xff9a1a, 3);
    const xs = s * (bodyHW(0, topBelt - 0.12) + 0.008);
    for (const [z0, z1] of spec.sideWin) {
      const zH = z1 - 0.25;
      body.box(xs, beltAt(zH) - 0.1, zH, 0.03, 0.035, 0.16, CHROME); // manilla
      // junta vertical delantera de la puerta (por delante de la ventanilla)
      body.box(xs - s * 0.004, (beltAt(z1 + 0.05) + sill) / 2, z1 + 0.05, 0.012, beltAt(z1 + 0.05) - sill - 0.04, 0.012, 0x101010);
      void z0;
    }
    if (id !== 'furgon' && id !== 'furgoneta' && spec.sideWin.length > 1) {
      const zb = spec.sideWin[spec.sideWin.length - 1][0] - 0.05;
      body.box(xs - s * 0.004, (beltAt(zb) + sill) / 2, zb, 0.012, beltAt(zb) - sill - 0.04, 0.012, 0x101010);
    }
    if (id === 'furgoneta' || id === 'furgon') {
      // puerta corredera lateral
      const z0 = id === 'furgon' ? 0.9 : 0.0, z1 = id === 'furgon' ? -0.6 : -1.0, top = id === 'furgon' ? 2.3 : 1.7;
      const xx = s * (W / 2 * 0.97 + 0.005);
      body.box(xx, (top + sill) / 2, z0, 0.012, top - sill, 0.015, 0x101010);
      body.box(xx, (top + sill) / 2, z1, 0.012, top - sill, 0.015, 0x101010);
      body.box(xx, top - 0.1, (z0 + z1) / 2, 0.012, 0.02, Math.abs(z0 - z1), 0x101010); // carril
    }
  }
  // techo: barras, antena de aleta
  const roofY = cabY1 - 0.015;
  const roofPts = spec.cabin.filter((p) => p[1] > roofY - 0.08);
  const rz0 = Math.min(...roofPts.map((p) => p[0])), rz1 = Math.max(...roofPts.map((p) => p[0]));
  if (spec.roofRails) for (const s of [1, -1]) body.box(s * (cabHW(roofY) - 0.12), roofY + 0.05, (rz0 + rz1) / 2, 0.05, 0.05, (rz1 - rz0) * 0.95, CHROME);
  body.box(0, roofY + 0.04, rz0 + 0.1, 0.05, 0.07, 0.16, id === 'taxi' ? 0xf7f7f2 : paint); // antena
  if (spec.spoiler) {
    const zs = Math.min(...spec.cabin.map((p) => p[0]));
    const ys = spec.cabin.find((p) => p[0] === zs)?.[1] ?? roofY;
    if (id === 'deportivo') body.box(0, (spec.body.find((p) => p[0] < -1.9)?.[1] ?? 0.86) + 0.08, -L / 2 + 0.25, W * 0.8, 0.03, 0.22, DARK);
    else body.box(0, ys + 0.03 + (roofY - ys) * 0.75, zs + 0.18, cabHW(roofY) * 1.7, 0.03, 0.2, paint);
  }

  // ---- interior (visible a través de las lunas)
  const flo = spec.gb + 0.2;
  const dashZ = wsBase[0] - 0.25, dashY = wsBase[1] - 0.02;
  // salpicadero con la parte superior inclinada hacia el parabrisas, consola central y guarnecidos
  const dw = cabHW(dashY) * 1.9;
  body.box(0, dashY - 0.06, dashZ + 0.02, dw, 0.16, 0.44, 0x2c2d30);
  body.quad([dw / 2, dashY + 0.02, dashZ - 0.2], [-dw / 2, dashY + 0.02, dashZ - 0.2], [-dw / 2, wsBase[1] + 0.01, wsBase[0] - 0.02], [dw / 2, wsBase[1] + 0.01, wsBase[0] - 0.02], [0, 1, 0.3], 0x242528);
  body.box(0, dashY - 0.25, dashZ - 0.45, 0.22, 0.3, 0.6, 0x26272a); // consola central
  // tapizado interior a la altura de la cintura (tapa la chapa vista desde dentro)
  {
    const zr = Math.min(...spec.cabin.map((p) => p[0])) + 0.12, zf = wsBase[0] - 0.05;
    const y = Math.max(beltAt(zf), beltAt((zr + zf) / 2)) + 0.01;
    const hw = cabHW(y) - 0.03;
    body.quad([hw, y, zr], [-hw, y, zr], [-hw, y, zf], [hw, y, zf], [0, 1, 0], 0x34353a);
  }
  const seatX = cabHW(dashY) * 0.48;
  const bz = spec.sideWin.length > 1 ? (spec.sideWin[0][0] + spec.sideWin[0][1]) / 2 - 0.2 : wsBase[0] - 0.95;
  for (const s of [1, -1]) {
    body.box(s * seatX, flo + 0.25, bz, 0.48, 0.12, 0.5, SEAT);
    body.box(s * seatX, flo + 0.6, bz - 0.26, 0.46, 0.62, 0.1, SEAT);
    body.box(s * seatX, flo + 0.98, bz - 0.24, 0.24, 0.16, 0.08, SEAT); // reposacabezas
  }
  if (spec.sideWin.length > 1 && id !== 'deportivo') {
    const rz = bz - 0.95;
    body.box(0, flo + 0.25, rz, seatX * 2 + 0.45, 0.12, 0.5, SEAT);
    body.box(0, flo + 0.58, rz - 0.26, seatX * 2 + 0.45, 0.58, 0.1, SEAT);
  }
  // cuadro de instrumentos iluminado (se ve desde la cámara del conductor)
  lights.box(seatX, dashY + 0.065, dashZ - 0.18, 0.22, 0.05, 0.01, 0xffa24a, 5);
  lights.box(-seatX * 0.1, dashY + 0.06, dashZ - 0.19, 0.14, 0.07, 0.01, 0x3d7fae, 5); // pantalla central
  // volante a la izquierda
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    body.box(seatX + Math.cos(a) * 0.15, dashY - 0.02 + Math.sin(a) * 0.15 * 0.8, dashZ - 0.26 - Math.sin(a) * 0.05, 0.04, 0.04, 0.04, 0x111111);
  }

  // ---- rotulación del taxi de Madrid
  if (liv.kind === 'policia') {
    // Policía Municipal de Madrid: blanco con banda azul, damero azul y blanco y rotulación; puente de luces azules
    const zA = spec.L / 2 - 0.35, zB = -spec.L / 2 + 0.35;
    for (const s of [1, -1]) {
      const yb0 = sill + 0.02, yb1 = beltAt(0) - 0.18;
      const xb = (z: number, y: number) => s * (bodyHW(z, y) + 0.005);
      body.quad([xb(zA, yb0), yb0, zA], [xb(zB, yb0), yb0, zB], [xb(zB, yb1), yb1, zB], [xb(zA, yb1), yb1, zA], [s, 0, 0], 0x1d3f9b);
      // damero (dos filas de cuadros)
      const sq = 0.09, y0 = yb1 + 0.01;
      for (let k = 0; zA - k * sq > zB; k++) for (let r = 0; r < 2; r++) {
        const z0 = zA - k * sq, z1 = z0 - sq, ya = y0 + r * sq, yc = ya + sq;
        body.quad([xb(z0, ya), ya, z0], [xb(z1, ya), ya, z1], [xb(z1, yc), yc, z1], [xb(z0, yc), yc, z0], [s, 0, 0], (k + r) % 2 ? 0x1d3f9b : 0xf4f4f2);
      }
      decals.decal([xb(0, 0.7) + s * 0.006, (yb0 + yb1) / 2, 0.1], [0, 0, -s], 1.25, 0.1, UV.police);
    }
    decals.decal([0, hl.headY + 0.17, spec.L / 2 - 0.12], [1, 0, 0], 0.15, 0.05, UV.police092);
    const ry = roofY + 0.02, rz = (rz0 + rz1) / 2 + 0.1;
    body.box(0, ry + 0.04, rz, cabHW(roofY) * 1.6, 0.06, 0.3, 0x202226);
    for (const s of [1, -1]) {
      lights.box(s * cabHW(roofY) * 0.42, ry + 0.11, rz, cabHW(roofY) * 0.7, 0.09, 0.26, 0x2a6bff, 6);
    }
    for (const s of [1, -1]) lights.box(s * 0.3, hl.headY - 0.12, spec.L / 2 - 0.02, 0.12, 0.04, 0.04, 0x2a6bff, 6); // destellos en la parrilla
  }
  if (liv.kind === 'taxi') {
    const zd0 = wf - spec.R - 0.12, zd1 = spec.sideWin[0][0] + 0.02; // puerta delantera (del paso de rueda al pilar B)
    const yTop = beltAt((zd0 + zd1) / 2) - 0.06, yBot = sill + 0.06;
    for (const s of [1, -1]) {
      const x = s * (bodyHW((zd0 + zd1) / 2, (yTop + yBot) / 2) + 0.006);
      // franja roja diagonal: de la esquina del retrovisor (arriba-delante) a la esquina opuesta (abajo-detrás)
      const t = 0.13;
      body.quad([x, yTop, zd0], [x, yTop - t, zd0], [x, yBot, zd1], [x, yBot + t, zd1], [s, 0, 0], 0xc8102e);
      // escudo por encima de la franja y número de licencia por debajo
      const r: number[] = [0, 0, -s];
      decals.decal([x + s * 0.002, yTop - 0.1, zd1 + 0.22], r, 0.075, 0.095, UV.crest);
      decals.decal([x + s * 0.002, yBot + 0.12, zd0 - 0.28], r, 0.14, 0.05, UV.taxiNum(liv.variant));
    }
    // módulo de techo: cartel TAXI con la luz verde de libre en la parte delantera del techo
    const ry = roofY + 0.02, rz = rz1 - 0.25;
    body.box(0, ry + 0.07, rz, 0.5, 0.13, 0.17, 0xf7f7f2);
    body.box(0, ry + 0.01, rz, 0.56, 0.03, 0.22, 0x202020);
    decals.decal([0, ry + 0.07, rz + 0.087], [1, 0, 0], 0.2, 0.045, UV.taxiSign);
    decals.decal([0, ry + 0.07, rz - 0.087], [-1, 0, 0], 0.2, 0.045, UV.taxiSign);
    lights.box(0.17, ry + 0.17, rz + 0.02, 0.09, 0.06, 0.09, 0x22e05a, 4);
    lights.box(-0.14, ry + 0.15, rz + 0.02, 0.14, 0.03, 0.06, 0xf0c040, 5); // indicador de tarifa
  }

  // ---- cabina vista desde dentro: pilares A, travesaño superior y techo
  const cock = new Mesher();
  {
    const [b0, t0] = spec.windshield;
    const yRoof = cabY1 - 0.03;
    for (const sgn of [1, -1]) {
      const xb = sgn * (cabHW(b0[1]) - 0.06), xt = sgn * (cabHW(t0[1]) - 0.08);
      cock.quad([xb, b0[1], b0[0]], [xb - sgn * 0.09, b0[1], b0[0]], [xt - sgn * 0.09, t0[1], t0[0]], [xt, t0[1], t0[0]], [0, 0, -1], 0x2f3034);
    }
    const ht = cabHW(t0[1]) - 0.08;
    cock.quad([ht, t0[1] - 0.09, t0[0] - 0.02], [-ht, t0[1] - 0.09, t0[0] - 0.02], [-ht, t0[1], t0[0]], [ht, t0[1], t0[0]], [0, 0, -1], 0x2f3034);
    const zr = Math.min(...spec.cabin.map((p) => p[0])) + 0.25;
    cock.quad([ht, yRoof, t0[0] - 0.02], [-ht, yRoof, t0[0] - 0.02], [-ht, yRoof, zr], [ht, yRoof, zr], [0, -1, 0], 0x3a3b40);
    cock.box(0, yRoof - 0.04, t0[0] - 0.12, 0.22, 0.05, 0.03, 0x1b1c1e); // retrovisor interior
  }

  const wheels = [] as VehicleModel['wheels'];
  const wx = W / 2 - spec.wheelW / 2 - 0.03;
  for (const [sx, z] of [[1, wf], [-1, wf], [1, wr], [-1, wr]]) wheels.push({ x: sx * wx, z, r: spec.R, w: spec.wheelW, front: z > 0 });
  return {
    body: body.geometry(true), glass: glass.geometry(), lights: lights.geometry(false, false, true),
    decals: decals.pos.length ? decals.geometry(false, true) : null,
    cockpit: cock.geometry(),
    eyeY: Math.min(flo + 0.05 + 0.86, cabY1 - 0.24),
    wheelStyle: id === 'deportivo' ? 'sport' : id === 'furgon' || id === 'furgoneta' ? 'steel' : 'alloy',
    wheels, driverSeat: [seatX, flo + 0.05, bz], materials: mats,
    exhaust: ex, hood: [0, topBelt + 0.05, wf],
  };
}

/** Autobús urbano de 12 m de piso bajo con la librea azul de la EMT de Madrid. */
function buildBus(liv: Livery): VehicleModel {
  const mats = materials();
  const body = new Mesher(), glass = new Mesher(), lights = new Mesher(), decals = new Mesher();
  const L = 12, W = 2.55, R = 0.5, wf = 3.3, wr = -2.8, gb = 0.3, H = 3.0;
  const BLUE = liv.paint, ROOF = 0xe8eaec;
  const spec: BodySpec = {
    L, W, R, wheelW: 0.3, wf, wr, gb,
    body: [[6.0, 0.5], [6.0, H - 0.15], [5.86, H], [-5.86, H], [-6.0, H - 0.15], [-6.0, 0.5]],
    cabin: [], cabBase: 1, tumble: 0, planFront: [0.35, 0.05], planRear: [0.3, 0.04],
    windshield: [[0, 0], [0, 0]], rearGlass: [[0, 0], [0, 0]], sideWin: [], lamps: { headY: 0.6, tailY: 1.0, headW: 0.3 },
  };
  const plan = (z: number) => {
    const df = L / 2 - z, dr = z + L / 2;
    return Math.min(1 - 0.05 * (1 - Math.min(1, df / 0.35)) ** 2, 1 - 0.04 * (1 - Math.min(1, dr / 0.3)) ** 2);
  };
  const hw = (z: number, _y: number) => (W / 2) * plan(z);
  loft(body, withArches(spec), hw, 0.1, (z, y, _nz, ny, cap) => {
    if (!cap && (Math.hypot(z - wf, y - R) < R + 0.14 || Math.hypot(z - wr, y - R) < R + 0.14) && ny < 0.2 && y < 1.1) return ARCH;
    if (ny < -0.6) return DARK;
    if (y < 0.5) return 0x1a1a1c; // faldón
    if (y > H - 0.12) return ROOF;
    return BLUE;
  });
  // Techo: carenado de los depósitos de gas natural y equipo de climatización
  body.box(0, H + 0.2, 1.8, W * 0.86, 0.4, 5.2, ROOF);
  body.box(0, H + 0.42, 1.8, W * 0.8, 0.05, 5.0, 0xd5d8db);
  body.box(0, H + 0.16, -3.6, W * 0.7, 0.32, 1.8, 0xcfd2d5);
  // Ventanas: banda continua a ambos lados con montantes negros (la librea azul por debajo y por encima)
  const winY0 = 1.28, winY1 = 2.72;
  const xs = (s: number, z: number) => s * (hw(z, 2) + 0.012);
  const pillars = [5.0, 3.6, 2.15, 0.6, -0.9, -2.0, -3.4, -4.7, -5.75];
  for (const s of [1, -1]) {
    // marco negro corrido
    body.quad([xs(s, 5.6) - s * 0.004, winY0 - 0.06, 5.6], [xs(s, -5.8) - s * 0.004, winY0 - 0.06, -5.8], [xs(s, -5.8) - s * 0.004, winY1 + 0.08, -5.8], [xs(s, 5.6) - s * 0.004, winY1 + 0.08, 5.6], [s, 0, 0], 0x0c0d0f);
    for (let k = 0; k < pillars.length - 1; k++) {
      const z0 = pillars[k] - 0.06, z1 = pillars[k + 1] + 0.06;
      const doorRight = s < 0 && (k === 0 || k === 3 || k === 6);
      const y0 = doorRight ? 0.42 : winY0, y1 = winY1;
      glass.quad([xs(s, z0) + s * 0.004, y0, z0], [xs(s, z1) + s * 0.004, y0, z1], [xs(s, z1) + s * 0.004, y1, z1], [xs(s, z0) + s * 0.004, y1, z0], [s, 0, 0], 0xffffff);
      if (doorRight) {
        // puerta de dos hojas: marco, junta central, banda inferior
        const zc = (z0 + z1) / 2;
        body.box(xs(s, zc) + s * 0.01, (y0 + y1) / 2, zc, 0.02, y1 - y0, 0.06, 0x2a2b2d);
        body.box(xs(s, zc) + s * 0.01, 0.4, zc, 0.03, 0.08, z0 - z1, 0x2a2b2d);
        for (const zz of [z0, z1]) body.box(xs(s, zz) + s * 0.008, (y0 + y1) / 2, zz, 0.03, y1 - y0, 0.07, 0x2a2b2d);
        lights.box(xs(s, zc) + s * 0.02, y1 + 0.12, zc, 0.03, 0.05, 0.3, 0x22e05a, 4);
      }
    }
    // rótulo EMT Madrid en el costado y franja clara inferior
    decals.decal([xs(s, -3) + s * 0.006, 0.88, -3.0], [0, 0, -s], 0.95, 0.27, UV.emt);
    body.quad([xs(s, 5.7) + s * 0.004, 0.55, 5.7], [xs(s, -5.8) + s * 0.004, 0.55, -5.8], [xs(s, -5.8) + s * 0.004, 0.62, -5.8], [xs(s, 5.7) + s * 0.004, 0.62, 5.7], [s, 0, 0], 0x4fb0e6);
    // indicador lateral de línea (sobre la puerta delantera)
    decals.decal([xs(s, 4.3) + s * 0.006, 2.58, 4.3], [0, 0, -s], 0.6, 0.06, UV.dest(liv.variant));
    // espejos tipo "orejas de conejo"
    body.box(s * (W / 2 + 0.25), H - 0.25, 6.15, 0.5, 0.05, 0.05, DARK);
    body.box(s * (W / 2 + 0.45), H - 0.6, 6.3, 0.18, 0.45, 0.08, DARK);
    lights.box(s * (W / 2 + 0.01), 1.0, 5.9, 0.02, 0.06, 0.15, 0xff9a1a, 3);
  }
  // Frontal: gran parabrisas, indicador de destino LED, faros, matrícula, logo
  const zF = L / 2 + 0.008;
  glass.quad([1.18, 1.0, zF], [-1.18, 1.0, zF], [-1.18, 2.55, zF], [1.18, 2.55, zF], [0, 0, 1], 0xffffff);
  body.box(0, 2.8, zF - 0.01, 2.3, 0.32, 0.03, 0x0b0b0b);
  decals.decal([0, 2.8, zF + 0.012], [1, 0, 0], 1.12, 0.12, UV.dest(liv.variant));
  decals.decal([0, 0.78, zF + 0.01], [1, 0, 0], 0.24, 0.11, UV.emtFront);
  decals.decal([0, 0.42, zF + 0.012], [1, 0, 0], 0.26, 0.055, UV.plate(liv.plate));
  body.box(0, 0.38, zF - 0.02, W * 0.95, 0.22, 0.08, 0x1a1a1c); // paragolpes
  for (const s of [1, -1]) {
    lights.box(s * 0.95, 0.62, zF - 0.02, 0.38, 0.12, 0.05, 0xfff4dc, 0);
    lights.box(s * 0.95, 0.52, zF - 0.02, 0.38, 0.03, 0.05, 0xdff0ff, 5);
    lights.box(s * 1.2, 0.7, zF - 0.02, 0.1, 0.1, 0.05, 0xff9a1a, 3);
    body.box(s * 1.18, 1.8, zF - 0.005, 0.06, 1.6, 0.03, 0x0c0d0f); // montantes del parabrisas
  }
  body.box(0.55, 1.05, zF - 0.01, 0.9, 0.04, 0.02, DARK); // limpiaparabrisas
  body.box(-0.45, 1.05, zF - 0.01, 0.9, 0.04, 0.02, DARK);
  // Trasera: luneta, motor, pilotos, matrícula, indicador de línea
  const zR = -L / 2 - 0.008;
  glass.quad([-1.0, 2.0, zR], [1.0, 2.0, zR], [1.0, 2.65, zR], [-1.0, 2.65, zR], [0, 0, -1], 0xffffff);
  decals.decal([0, 2.8, zR - 0.004], [-1, 0, 0], 0.45, 0.1, UV.dest(liv.variant));
  body.box(0, 1.2, zR + 0.01, W * 0.8, 0.9, 0.02, 0x163f80); // tapa del motor
  for (let k = 0; k < 6; k++) body.box(0, 0.95 + k * 0.1, zR - 0.004, W * 0.6, 0.03, 0.01, 0x0f2c5c); // rejilla
  decals.decal([0, 0.62, zR - 0.012], [-1, 0, 0], 0.26, 0.055, UV.plate((liv.plate + 5) % 8));
  for (const s of [1, -1]) {
    lights.box(s * 1.12, 1.1, zR + 0.02, 0.18, 0.4, 0.05, 0xc2141a, 1);
    lights.box(s * 1.12, 0.82, zR + 0.02, 0.18, 0.1, 0.05, 0xff9a1a, 3);
    lights.box(s * 1.12, 0.7, zR + 0.02, 0.18, 0.08, 0.05, 0xf4f4f4, 2);
  }
  body.box(0, 0.38, zR + 0.02, W * 0.95, 0.22, 0.08, 0x1a1a1c);
  // Interior: asientos azules, barras amarillas y conductor
  for (let k = 0; k < 9; k++) {
    const z = -5.2 + k * 1.05;
    if (z > 0.2 && z < 1.8) continue; // plataforma de la puerta central (sillas de ruedas)
    for (const s of [1, -1]) {
      body.box(s * 0.75, 0.75, z, 0.85, 0.1, 0.45, 0x1f3c8a);
      body.box(s * 0.75, 1.05, z - 0.22, 0.85, 0.55, 0.08, 0x1f3c8a);
    }
    body.box(0.28, 1.55, z, 0.04, 2.0, 0.04, 0xf2c200);
  }
  body.box(0, 2.6, 0, 0.04, 0.04, 11, 0xf2c200);
  body.box(0, 1.0, 5.3, W * 0.9, 0.4, 0.7, INTERIOR); // salpicadero

  const wheels = [] as VehicleModel['wheels'];
  const wx = W / 2 - 0.2;
  for (const [sx, z] of [[1, wf], [-1, wf], [1, wr], [-1, wr]]) wheels.push({ x: sx * wx, z, r: R, w: 0.3, front: z > 0 });
  return {
    body: body.geometry(true), glass: glass.geometry(), lights: lights.geometry(false, false, true),
    decals: decals.geometry(false, true), eyeY: 2.05, cockpit: (() => { const c = new Mesher(); c.box(0, H - 0.08, 5.6, W - 0.2, 0.1, 0.9, 0x3a3b40); return c.geometry(); })(), wheelStyle: 'bus', wheels, driverSeat: [0.7, 0.75, 5.0], materials: mats,
    exhaust: [-1.0, 2.9, -5.5], hood: [0, 1.2, -5.6],
  };
}
