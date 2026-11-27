import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Ground } from './roads';
import type { CollisionWorld } from './collision';

/**
 * Kit de arquitectura para edificios con interior recorrible: muros con huecos (puertas, ventanas, arcos),
 * forjados por los que se anda, escaleras, columnas, bóvedas y mobiliario. Todo se dibuja en un sistema local
 * (x a lo largo de la fachada, z hacia dentro, y desde la cota del suelo) y se junta por material al final.
 * Cada pieza sólida registra su colisión (con altura: un muro del primer piso no bloquea la planta baja) y
 * cada suelo, su superficie para andar (también bajo la cota de la calle, para sótanos).
 */

export interface Opening { s0: number; s1: number; y0: number; y1: number; frame?: string; glass?: boolean; arch?: boolean }

export class Kit {
  readonly group = new THREE.Group();
  private readonly ux: number;
  private readonly uz: number;
  private readonly buckets = new Map<string, THREE.BufferGeometry[]>();
  readonly mats = new Map<string, THREE.Material>();

  /** `ox,oz`: origen en el mundo; `angle`: rumbo de la x local; `y0`: cota del suelo de la planta baja. */
  constructor(readonly ox: number, readonly oz: number, readonly angle: number, readonly y0: number,
    private ground: Ground, private collision: CollisionWorld) {
    this.ux = Math.cos(angle); this.uz = Math.sin(angle);
    this.group.position.set(ox, y0, oz);
    this.group.rotation.y = -angle;
  }

  /** Local → mundo (x, z). */
  w(lx: number, lz: number): [number, number] {
    return [this.ox + this.ux * lx - this.uz * lz, this.oz + this.uz * lx + this.ux * lz];
  }
  /** Mundo → local (x, z). */
  l(x: number, z: number): [number, number] {
    const dx = x - this.ox, dz = z - this.oz;
    return [dx * this.ux + dz * this.uz, -dx * this.uz + dz * this.ux];
  }

  mat(name: string, m: THREE.Material) { this.mats.set(name, m); return name; }
  std(name: string, color: number, o: THREE.MeshStandardMaterialParameters = {}) {
    return this.mat(name, new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o }));
  }

  /** Añade una geometría (en coordenadas locales) al cubo de su material. */
  add(g: THREE.BufferGeometry, mat: string) {
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const gg = g.index ? g.toNonIndexed() : g;
    let arr = this.buckets.get(mat);
    if (!arr) this.buckets.set(mat, (arr = []));
    arr.push(gg);
  }

  // ---------------------------------------------------------------- colisión y suelos

  /** Segmento de colisión local entre alturas locales y0..y1. */
  segCol(ax: number, az: number, bx: number, bz: number, y0: number, y1: number) {
    const [x1, z1] = this.w(ax, az), [x2, z2] = this.w(bx, bz);
    this.collision.addSeg(x1, z1, x2, z2, this.y0 + y1, y0 > 0.4 ? this.y0 + y0 : undefined);
  }
  /** Rectángulo sólido (los cuatro lados). */
  rectCol(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number) {
    this.segCol(x0, z0, x1, z0, y0, y1); this.segCol(x1, z0, x1, z1, y0, y1);
    this.segCol(x1, z1, x0, z1, y0, y1); this.segCol(x0, z1, x0, z0, y0, y1);
  }
  /** Superficie para andar (rectángulo local a la altura local `y`; con `y2` es una rampa a lo largo de x). */
  walk(x0: number, z0: number, x1: number, z1: number, y: number, y2 = y, alongZ = false) {
    const lx = Math.abs(x1 - x0), lz = Math.abs(z1 - z0);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    // rampa: el sentido lo marca `alongZ` (de z0 a z1) o, si no, x (de x0 a x1); suelo plano: el eje más largo
    const useZ = y === y2 ? lz > lx : alongZ;
    if (useZ) {
      const [ax, az] = this.w(cx, z0), [bx, bz] = this.w(cx, z1);
      this.ground.addDeckSegment(ax, az, bx, bz, this.y0 + y, this.y0 + y2, lx / 2, true);
    } else {
      const [ax, az] = this.w(x0, cz), [bx, bz] = this.w(x1, cz);
      this.ground.addDeckSegment(ax, az, bx, bz, this.y0 + y, this.y0 + y2, lz / 2, true);
    }
  }

  // ---------------------------------------------------------------- primitivas

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: string, solid = false) {
    const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(g, mat);
    if (solid) this.rectCol(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), Math.min(y0, y1), Math.max(y0, y1));
  }
  /** Caja girada un ángulo `rot` alrededor de su centro (para muebles). */
  rbox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rot: number, mat: string) {
    const g = new THREE.BoxGeometry(sx, sy, sz).rotateY(rot).translate(cx, cy, cz);
    this.add(g, mat);
  }
  cyl(x: number, z: number, y0: number, y1: number, r0: number, mat: string, seg = 10, solid = false, r1 = r0) {
    const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, seg).translate(x, (y0 + y1) / 2, z);
    this.add(g, mat);
    if (solid) {
      const [wx, wz] = this.w(x, z);
      this.collision.addCircle(wx, wz, Math.max(r0, r1), this.y0 + y1, y0 > 0.4 ? this.y0 + y0 : undefined);
    }
  }
  sphere(x: number, y: number, z: number, r: number, mat: string, seg = 8) {
    this.add(new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)).translate(x, y, z), mat);
  }
  /** Geometría cualquiera ya colocada en local. */
  geo(g: THREE.BufferGeometry, mat: string) { this.add(g, mat); }

  /**
   * Muro recto de a→b (local), de y0 a y1, grosor t hacia la izquierda del sentido a→b, con huecos.
   * Los huecos se miden en metros desde a. `frame`: material del marco; `glass`: lleva vidrio; `arch`: remate en arco.
   */
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, t: number, mat: string, openings: Opening[] = [], collide = true) {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.01) return;
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    const nx = -dz, nz = dx; // izquierda
    const piece = (s0: number, s1: number, h0: number, h1: number) => {
      if (s1 - s0 < 0.005 || h1 - h0 < 0.005) return;
      const g = new THREE.BoxGeometry(s1 - s0, h1 - h0, t);
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(dx, 0, dz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz));
      g.applyMatrix4(m);
      const c = (s0 + s1) / 2;
      g.translate(ax + dx * c + nx * t / 2, (h0 + h1) / 2, az + dz * c + nz * t / 2);
      this.add(g, mat);
    };
    const ops = [...openings].sort((p, q) => p.s0 - q.s0);
    let s = 0;
    for (const o of ops) {
      piece(s, o.s0, y0, y1);
      piece(o.s0, o.s1, y0, o.y0);
      if (o.arch) {
        // arco de medio punto: dovelas escalonadas entre el arranque y la clave
        const r = (o.s1 - o.s0) / 2, spring = o.y1 - r, n = 8;
        for (let k = 0; k < n; k++) {
          const a0 = (k / n) * Math.PI, a1 = ((k + 1) / n) * Math.PI;
          const xa = o.s0 + r - Math.cos(a0) * r, xb = o.s0 + r - Math.cos(a1) * r;
          const yy = spring + Math.sin((a0 + a1) / 2) * r;
          piece(Math.min(xa, xb), Math.max(xa, xb), yy, y1);
        }
        piece(o.s0, o.s1, o.y1, y1);
      } else piece(o.s0, o.s1, o.y1, y1);
      if (o.frame) {
        const ft = 0.08, fd = t + 0.06;
        const fp = (s0: number, s1: number, h0: number, h1: number) => {
          const g = new THREE.BoxGeometry(s1 - s0, h1 - h0, fd);
          g.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(dx, 0, dz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz)));
          const c = (s0 + s1) / 2;
          g.translate(ax + dx * c + nx * t / 2, (h0 + h1) / 2, az + dz * c + nz * t / 2);
          this.add(g, o.frame!);
        };
        fp(o.s0 - ft, o.s0, o.y0, o.y1); fp(o.s1, o.s1 + ft, o.y0, o.y1);
        if (!o.arch) fp(o.s0 - ft, o.s1 + ft, o.y1, o.y1 + ft);
        if (o.y0 > 0.3) fp(o.s0 - ft, o.s1 + ft, o.y0 - ft, o.y0);
      }
      if (o.glass) {
        const g = new THREE.PlaneGeometry(o.s1 - o.s0, o.y1 - o.y0);
        g.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(dx, 0, dz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz)));
        const c = (o.s0 + o.s1) / 2;
        g.translate(ax + dx * c + nx * t / 2, (o.y0 + o.y1) / 2, az + dz * c + nz * t / 2);
        this.add(g, 'glass');
      }
      s = o.s1;
    }
    piece(s, L, y0, y1);
    if (!collide) return;
    // colisión: tramos macizos de suelo a techo, y por encima/debajo de los huecos
    const cs = (s0: number, s1: number, h0: number, h1: number) => {
      if (s1 - s0 < 0.05 || h1 - h0 < 0.05) return;
      this.segCol(ax + dx * s0 + nx * t / 2, az + dz * s0 + nz * t / 2, ax + dx * s1 + nx * t / 2, az + dz * s1 + nz * t / 2, h0, h1);
    };
    s = 0;
    for (const o of ops) {
      cs(s, o.s0, y0, y1);
      // ventana (hueco que no llega al suelo) o acristalado: no se puede atravesar
      if (o.y0 > y0 + 0.3 || o.glass) cs(o.s0, o.s1, y0, y1);
      else if (o.y1 < y1 - 0.05) cs(o.s0, o.s1, o.y1, y1);
      s = o.s1;
    }
    cs(s, L, y0, y1);
  }

  /** Forjado: losa de x0..x1, z0..z1 con la cara superior a `y` y grosor t; se anda por encima y no se ve a través. */
  slab(x0: number, z0: number, x1: number, z1: number, y: number, t: number, mat: string, walkable = true, ceilingMat?: string) {
    this.box(x0, y - t, z0, x1, y, z1, mat);
    if (ceilingMat) this.box(x0, y - t - 0.01, z0, x1, y - t, z1, ceilingMat);
    if (walkable) this.walk(x0, z0, x1, z1, y);
    // techo para la cámara de la planta de abajo
    const c = [this.w(x0, z0), this.w(x1, z0), this.w(x1, z1), this.w(x0, z1)];
    this.collision.add({ kind: 'quad', p: c.flat(), h: this.y0 + y + 0.05, y0: this.y0 + y - t - 0.3 });
  }

  /** Suelo ajedrezado (o de baldosas) en un rectángulo, con dos materiales. */
  checker(x0: number, z0: number, x1: number, z1: number, y: number, size: number, matA: string, matB: string) {
    const nx = Math.max(1, Math.round((x1 - x0) / size)), nz = Math.max(1, Math.round((z1 - z0) / size));
    const sx = (x1 - x0) / nx, sz = (z1 - z0) / nz;
    const a: THREE.BufferGeometry[] = [], b: THREE.BufferGeometry[] = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const g = new THREE.PlaneGeometry(sx, sz).rotateX(-Math.PI / 2).translate(x0 + (i + 0.5) * sx, y, z0 + (j + 0.5) * sz);
      ((i + j) % 2 ? b : a).push(g);
    }
    if (a.length) this.add(mergeGeometries(a)!, matA);
    if (b.length) this.add(mergeGeometries(b)!, matB);
  }

  /** Tramo de escalera de x0..x1 (a lo ancho z0..z1) subiendo de yA a yB, con peldaños y rampa invisible para andar. */
  stairs(x0: number, z0: number, x1: number, z1: number, yA: number, yB: number, mat: string, alongZ = false) {
    const run = alongZ ? z1 - z0 : x1 - x0;
    const n = Math.max(2, Math.round(Math.abs(yB - yA) / 0.18));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const top = yA + (yB - yA) * t1;
      const lo = Math.min(yA, yB) - 0.25;
      if (alongZ) this.box(x0, lo, z0 + run * t0, x1, top, z0 + run * t1, mat);
      else this.box(x0 + run * t0, lo, z0, x0 + run * t1, top, z1, mat);
    }
    if (alongZ) this.walk(x0, z0, x1, z1, yA + 0.05, yB + 0.05, true);
    else this.walk(x0, z0, x1, z1, yA + 0.05, yB + 0.05);
  }

  /** Bóveda de cañón a lo largo de x (de x0 a x1), de anchura z0..z1, arrancando a `ys`. */
  vault(x0: number, x1: number, z0: number, z1: number, ys: number, mat: string, seg = 10) {
    const r = (z1 - z0) / 2, cz = (z0 + z1) / 2;
    const pos: number[] = [];
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI, a1 = ((k + 1) / seg) * Math.PI;
      const za = cz - Math.cos(a0) * r, ya = ys + Math.sin(a0) * r;
      const zb = cz - Math.cos(a1) * r, yb = ys + Math.sin(a1) * r;
      pos.push(x0, ya, za, x1, ya, za, x1, yb, zb, x0, ya, za, x1, yb, zb, x0, yb, zb);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    this.add(g, mat);
  }

  // ---------------------------------------------------------------- mobiliario

  /** Mesa redonda de velador (pie de hierro, tablero de mármol). */
  roundTable(x: number, z: number, y: number, top: string, iron: string, r = 0.35) {
    this.cyl(x, z, y, y + 0.04, 0.22, iron, 8);
    this.cyl(x, z, y, y + 0.72, 0.035, iron, 6);
    this.cyl(x, z, y + 0.72, y + 0.76, r, top, 14, true);
  }
  /** Silla de café (madera curvada). */
  chair(x: number, z: number, y: number, rot: number, wood: string) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const P = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
    for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) { const [px, pz] = P(lx, lz); this.cyl(px, pz, y, y + 0.45, 0.02, wood, 5); }
    this.rbox(x, y + 0.46, z, 0.42, 0.04, 0.42, rot, wood);
    const [bx, bz] = P(0, 0.2);
    this.rbox(bx, y + 0.72, bz, 0.4, 0.5, 0.03, rot, wood);
  }
  /** Taburete alto. */
  stool(x: number, z: number, y: number, seat: string, iron: string) {
    this.cyl(x, z, y, y + 0.74, 0.03, iron, 6);
    this.cyl(x, z, y + 0.74, y + 0.8, 0.18, seat, 10);
    this.cyl(x, z, y + 0.28, y + 0.3, 0.16, iron, 10);
  }
  /** Lámpara colgante (globo luminoso) con su cable. */
  pendant(x: number, z: number, ceil: number, drop: number, glow: string, iron: string, r = 0.22) {
    this.cyl(x, z, ceil - drop, ceil, 0.01, iron, 4);
    this.sphere(x, ceil - drop - r * 0.8, z, r, glow, 10);
  }

  /** Junta las geometrías por material y deja el grupo listo para añadir a la escena. */
  finish() {
    for (const [mat, gs] of this.buckets) {
      const g = mergeGeometries(gs.map((x) => { for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k); return x; }));
      if (!g) continue;
      const m = new THREE.Mesh(g, this.mats.get(mat) ?? new THREE.MeshStandardMaterial({ color: 0xff00ff }));
      m.castShadow = mat !== 'glass' && !mat.startsWith('glow');
      m.receiveShadow = true;
      if (mat === 'glass') m.renderOrder = 2;
      this.group.add(m);
    }
    this.buckets.clear();
    return this.group;
  }
}
