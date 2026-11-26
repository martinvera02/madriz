import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ViaductInfo } from './roads';
import { Terrain } from './terrain';
import { CollisionWorld } from './collision';

/*
 * Viaducto de Segovia (F. J. Ferrero, arq.; J. Juan Aracil y L. Aldaz, ings.; 1934–1942).
 * Datos del proyecto (revista Arquitectura nº 170, 1933, y documentación de la rehabilitación):
 *   - tres vanos principales de 36,50 m entre ejes, bóvedas de 35 m de luz y 17,50 m de flecha
 *   - cada bóveda son 4 nervios de 2 m de ancho separados 4 m (20 m de ancho total)
 *   - montantes cada 4,20 m en sentido longitudinal
 *   - pilas de 4 fustes dobles en los arranques de los arcos, revestidas de granito hasta la cota de arranque
 *   - estribos aligerados con dos huecos de 9 m de luz
 *   - tablero de 20 m: calzada de 12 m y dos aceras de 4 m; hormigón armado pulido
 *   - longitud total ≈ 135 m, unos 23–25 m sobre la calle de Segovia
 *   - mamparas de protección transparentes en los pretiles (1998)
 */

const SPAN_AXIS = 36.5;
const ARCH_SPAN = 35;
const ARCH_RISE = 17.5;
const RIB_W = 2;
const RIBS = [-9, -3, 3, 9];
const POST_STEP = 4.2;
const DECK_T = 1.3;

export function buildViaduct(v: ViaductInfo, terrain: Terrain, collision: CollisionWorld): THREE.Group {
  const group = new THREE.Group();
  const ux = v.ux, uz = v.uz;
  const tx = -uz, tz = ux; // transversal
  const deckY = (s: number) => v.ha + ((v.hb - v.ha) * s) / v.len;
  const W = (s: number, t: number) => [v.ax + ux * s + tx * t, v.az + uz * s + tz * t] as const;
  const groundAt = (s: number, t: number) => { const [x, z] = W(s, t); return terrain.heightAt(x, z); };

  const parts = new Map<string, THREE.BufferGeometry[]>();
  const push = (mat: string, g: THREE.BufferGeometry) => {
    let arr = parts.get(mat);
    if (!arr) parts.set(mat, (arr = []));
    arr.push(g.index ? g.toNonIndexed() : g);
  };
  const basis = new THREE.Matrix4();
  const eT = new THREE.Vector3(tx, 0, tz), eY = new THREE.Vector3(0, 1, 0), eS = new THREE.Vector3(ux, 0, uz);
  /** Caja alineada con el viaducto: centro en (s, t, yc), tamaños (ds a lo largo, dt transversal, dy alto). */
  const box = (mat: string, s: number, t: number, y0: number, y1: number, ds: number, dt: number) => {
    if (y1 - y0 < 0.01) return;
    const g = new THREE.BoxGeometry(dt, y1 - y0, ds);
    const [x, z] = W(s, t);
    basis.makeBasis(eT, eY, eS).setPosition(x, (y0 + y1) / 2, z);
    g.applyMatrix4(basis);
    push(mat, g);
  };
  /** Pared rectangular girada como colisión (4 segmentos). */
  const rectCollider = (s0: number, s1: number, t0: number, t1: number, h: number, y0?: number) => {
    const c = [W(s0, t0), W(s1, t0), W(s1, t1), W(s0, t1)];
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4];
      collision.addSeg(a[0], a[1], b[0], b[1], h, y0);
    }
  };

  // ---- Disposición longitudinal: vano central centrado en la calle de Segovia
  const centers = [-1, 0, 1].map((k) => v.sCross + k * SPAN_AXIS);
  const piers = [v.sCross - 1.5 * SPAN_AXIS, v.sCross - 0.5 * SPAN_AXIS, v.sCross + 0.5 * SPAN_AXIS, v.sCross + 1.5 * SPAN_AXIS];
  const inside = (s: number) => s > 0.5 && s < v.len - 0.5;

  // ---- Tablero: losa con canto, voladizos de las aceras y pretiles con mampara
  for (let s = 0; s < v.len; s += POST_STEP) {
    const ds = Math.min(POST_STEP, v.len - s);
    const sm = s + ds / 2, y = deckY(sm);
    box('concrete', sm, 0, y - DECK_T, y - 0.02, ds + 0.02, v.width);
    // imposta (cornisa del tablero) a ambos lados
    for (const side of [-1, 1]) {
      box('concrete', sm, side * (v.width / 2 + 0.15), y - 1.0, y - 0.15, ds + 0.02, 0.5);
      // pretil macizo + mampara transparente
      box('concrete', sm, side * (v.width / 2 - 0.15), y, y + 0.95, ds + 0.02, 0.3);
      box('glass', sm, side * (v.width / 2 - 0.2), y + 0.95, y + 2.6, ds - 0.1, 0.04);
      box('metal', s + 0.05, side * (v.width / 2 - 0.2), y + 0.95, y + 2.65, 0.1, 0.12);
    }
  }
  for (const side of [-1, 1]) {
    const [a0, a1] = W(0, side * v.width / 2), [b0, b1] = W(v.len, side * v.width / 2);
    collision.addSeg(a0, a1, b0, b1, Math.max(v.ha, v.hb) + 2.6, Math.min(v.ha, v.hb) - 1.5);
  }
  // Farolas sobre el pretil
  for (let s = 6; s < v.len - 3; s += 12.6) {
    for (const side of [-1, 1]) {
      const y = deckY(s);
      box('metal', s, side * (v.width / 2 - 0.15), y + 0.95, y + 5.5, 0.18, 0.18);
      box('lamp', s, side * (v.width / 2 - 0.6), y + 5.3, y + 5.6, 0.35, 0.8);
    }
  }

  // ---- Bóvedas: 3 vanos × 4 nervios, con montantes cada 4,20 m
  for (const sc of centers) {
    const crown = deckY(sc) - DECK_T - 0.4;
    const spring = crown - ARCH_RISE;
    const R = ARCH_SPAN / 2;
    const SEG = 28;
    for (const t of RIBS) {
      // Nervio continuo: corona entre intradós (semielipse 17,5 × 17,5) y extradós
      // (canto 1,85 m en arranques → 0,80 m en clave), extruido 2 m en transversal
      const shape = new THREE.Shape();
      const aO = R + 1.85, bO = ARCH_RISE + 0.8;
      shape.moveTo(sc - aO, spring);
      shape.absellipse(sc, spring, aO, bO, Math.PI, 0, true, 0);
      shape.lineTo(sc + R, spring);
      shape.absellipse(sc, spring, R, ARCH_RISE, 0, Math.PI, false, 0);
      shape.lineTo(sc - aO, spring);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: RIB_W, bevelEnabled: false, curveSegments: SEG });
      geo.translate(0, 0, -RIB_W / 2);
      const m = new THREE.Matrix4().makeBasis(eS, eY, eT);
      const [ox, oz] = W(0, t);
      m.setPosition(ox, 0, oz);
      geo.applyMatrix4(m);
      push('concrete', geo);
      // Montantes entre el arco y el tablero
      for (let ds = -R + POST_STEP; ds < R - 0.5; ds += POST_STEP) {
        const s = sc + ds;
        if (!inside(s)) continue;
        const archTop = spring + ARCH_RISE * Math.sqrt(Math.max(0, 1 - (ds / R) ** 2)) + 0.8 + 1.05 * Math.abs(ds / R);
        const top = deckY(s) - DECK_T;
        if (top - archTop > 0.6) box('concrete', s, t, archTop - 0.2, top, 0.55, 0.9);
      }
    }
    // Arriostramiento transversal en clave
    if (inside(sc)) box('concrete', sc, 0, crown - 0.4, deckY(sc) - DECK_T, 1.2, v.width - 1);
  }

  // ---- Pilas: 4 fustes dobles; granito hasta la cota de arranque de los arcos
  for (const sp of piers) {
    if (!inside(sp)) continue;
    const top = deckY(sp) - DECK_T;
    const spring = deckY(sp) - DECK_T - 0.4 - ARCH_RISE;
    const gmin = Math.min(...RIBS.map((t) => groundAt(sp, t)), groundAt(sp, -10), groundAt(sp, 10));
    const granTop = Math.max(gmin + 2, spring + 0.6);
    box('granite', sp, 0, gmin - 2, granTop, 4.2, v.width + 0.6);
    box('granite', sp, 0, granTop, granTop + 0.5, 4.6, v.width + 1.0); // cornisa de la pila
    for (const t of RIBS) {
      for (const off of [-1.15, 1.15]) box('concrete', sp + off, t, granTop + 0.5, top, 1.0, 1.4);
    }
    box('concrete', sp, 0, top - 1.2, top, 3.6, v.width); // viga cargadero
    rectCollider(sp - 2.1, sp + 2.1, -v.width / 2 - 0.3, v.width / 2 + 0.3, granTop, undefined);
    for (const t of RIBS) rectCollider(sp - 1.9, sp + 1.9, t - 0.7, t + 0.7, top, granTop - 0.5);
  }

  // ---- Estribos: muros laterales con dos huecos de 9 m, entre el terreno y el tablero
  const abut = (s0: number, s1: number) => {
    if (s1 - s0 < 2) return;
    const gmin = Math.min(groundAt(s0, 0), groundAt(s1, 0), groundAt((s0 + s1) / 2, 0)) - 3;
    for (const side of [-1, 1]) {
      const shape = new THREE.Shape();
      const yA = deckY(s0) - 0.1, yB = deckY(s1) - 0.1;
      shape.moveTo(s0, gmin); shape.lineTo(s1, gmin); shape.lineTo(s1, yB); shape.lineTo(s0, yA); shape.lineTo(s0, gmin);
      // huecos de 9 m de luz, solo si cabe y si el terreno deja hueco por debajo
      const L = s1 - s0;
      const n = L > 24 ? 2 : L > 12 ? 1 : 0;
      for (let k = 0; k < n; k++) {
        const c = s0 + (L * (k + 0.5)) / n;
        const g0 = groundAt(c, side * v.width / 2);
        const top = deckY(c) - DECK_T - 1;
        const springY = top - 4.5;
        if (springY - g0 < 2) continue;
        const hole = new THREE.Path();
        hole.moveTo(c - 4.5, g0 - 0.5);
        hole.lineTo(c - 4.5, springY);
        hole.absarc(c, springY, 4.5, Math.PI, 0, true);
        hole.lineTo(c + 4.5, g0 - 0.5);
        hole.lineTo(c - 4.5, g0 - 0.5);
        shape.holes.push(hole);
      }
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.0, bevelEnabled: false, curveSegments: 14 });
      // forma en el plano (s, y) → mundo
      geo.translate(0, 0, -0.5);
      const m = new THREE.Matrix4().makeBasis(eS, eY, eT);
      const [ox, oz] = W(0, side * (v.width / 2 - 0.5));
      m.setPosition(ox, 0, oz);
      geo.applyMatrix4(m);
      push('concrete', geo);
      const [a0, a1] = W(s0, side * v.width / 2), [b0, b1] = W(s1, side * v.width / 2);
      collision.addSeg(a0, a1, b0, b1, Math.max(yA, yB), undefined);
    }
  };
  abut(0, piers[0]);
  abut(piers[3], v.len);

  const mats: Record<string, THREE.Material> = {
    concrete: new THREE.MeshStandardMaterial({ color: 0xd2cbbd, roughness: 0.55 }),
    granite: new THREE.MeshStandardMaterial({ color: 0xa8a297, roughness: 0.85 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.5, metalness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xcfe6ee, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    lamp: new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffd9a0, emissiveIntensity: 0.4 }),
  };
  for (const [name, geos] of parts) {
    const geo = mergeGeometries(geos, false);
    if (!geo) continue;
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mats[name]);
    mesh.castShadow = name !== 'glass';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
