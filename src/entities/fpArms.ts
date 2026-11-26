import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Prop } from './character';

/**
 * Brazos en primera persona enganchados a la cámara: antebrazo cónico con la manga,
 * mano con palma, cuatro dedos y pulgar. A pie se mecen al ritmo de los pasos y se retrasan
 * un poco al girar la cámara; al volante agarran el aro y giran con la dirección.
 */

function colored(src: THREE.BufferGeometry, color: number) {
  const g = src.index ? src.toNonIndexed() : src;
  g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Brazo a lo largo de +Z (manga en z≈0, nudillos hacia z≈0.45). side −1 = izquierdo (espejo). */
function armGeometry(skin: number, sleeve: number, side: 1 | -1) {
  const parts: THREE.BufferGeometry[] = [];
  const cyl = (r0: number, r1: number, len: number, z: number, col: number, seg = 8) => {
    const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1).rotateX(Math.PI / 2).translate(0, 0, z + len / 2);
    g.scale(1, 0.85, 1);
    parts.push(colored(g, col));
  };
  cyl(0.052, 0.048, 0.16, -0.02, sleeve); // manga
  cyl(0.054, 0.054, 0.03, 0.13, new THREE.Color(sleeve).multiplyScalar(0.8).getHex()); // puño
  cyl(0.04, 0.031, 0.17, 0.15, skin); // antebrazo y muñeca
  parts.push(colored(new THREE.BoxGeometry(0.075, 0.03, 0.085).translate(0, 0, 0.36), skin)); // palma
  for (let k = 0; k < 4; k++) {
    const x = -0.027 + k * 0.018;
    const len = k === 0 || k === 3 ? 0.045 : 0.055;
    const f1 = new THREE.BoxGeometry(0.016, 0.018, len).translate(0, 0, len / 2).rotateX(0.5).translate(x, -0.004, 0.4);
    const f2 = new THREE.BoxGeometry(0.015, 0.016, 0.03).translate(0, 0, 0.015).rotateX(1.1).translate(x, -0.004 - Math.sin(0.5) * len, 0.4 + Math.cos(0.5) * len);
    parts.push(colored(f1, skin), colored(f2, skin));
  }
  // pulgar: se construye siempre para la mano derecha (el espejo lo pasa al otro lado en la izquierda)
  parts.push(colored(new THREE.BoxGeometry(0.02, 0.02, 0.05).translate(0, 0, 0.025).rotateY(0.5).translate(0.04, -0.004, 0.33), skin));
  const g = mergeGeometries(parts)!;
  if (side < 0) {
    g.scale(-1, 1, 1);
    // el espejo invierte la orientación de los triángulos: se restaura
    const p = g.attributes.position.array as Float32Array, c = g.attributes.color.array as Float32Array;
    for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) {
      [p[i + 3 + k], p[i + 6 + k]] = [p[i + 6 + k], p[i + 3 + k]];
      [c[i + 3 + k], c[i + 6 + k]] = [c[i + 6 + k], c[i + 3 + k]];
    }
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Armas de la vista en primera persona, más detalladas que las del muñeco.
 * Espacio del arma: la mano derecha agarra en el origen, el cañón mira a −Z y +Y es arriba.
 */
interface ViewGun { geo: THREE.BufferGeometry; muzzle: THREE.Vector3; sightY: number; support: THREE.Vector3; long: boolean }

function viewGun(kind: Prop): ViewGun | null {
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, l: number, x: number, y: number, z: number, col: number, rx = 0) =>
    parts.push(colored(new THREE.BoxGeometry(w, h, l).rotateX(rx).translate(x, y, z), col));
  const tube = (r: number, z0: number, z1: number, y: number, col: number, seg = 8) =>
    parts.push(colored(new THREE.CylinderGeometry(r, r, z1 - z0, seg).rotateX(Math.PI / 2).translate(0, y, (z0 + z1) / 2), col));
  const slide = 0x2c2e33, frame = 0x1a1b1e, steel = 0x3c3f45, wood = 0x6e4526, woodD = 0x4f311b, sight = 0xd9d4c4;
  let out: Omit<ViewGun, 'geo'>;
  switch (kind) {
    case 'pistol':
      box(0.03, 0.03, 0.19, 0, 0.047, -0.07, slide); // corredera
      box(0.031, 0.008, 0.05, 0, 0.058, 0.0, steel); // estrías traseras
      box(0.012, 0.012, 0.004, 0, 0.047, -0.166, 0x050505); // boca del cañón
      box(0.027, 0.02, 0.15, 0, 0.022, -0.06, frame); // armazón
      box(0.028, 0.115, 0.047, 0, -0.035, 0.008, frame, -0.28); // empuñadura inclinada
      box(0.03, 0.012, 0.05, 0, -0.092, 0.025, steel, -0.28); // base del cargador
      box(0.006, 0.006, 0.05, 0, -0.004, -0.045, frame); // guardamonte
      box(0.006, 0.022, 0.006, 0, 0.004, -0.07, frame);
      box(0.004, 0.016, 0.004, 0, 0.007, -0.035, steel); // gatillo
      box(0.006, 0.01, 0.006, 0, 0.066, -0.155, sight); // punto de mira
      box(0.006, 0.01, 0.008, -0.008, 0.066, 0.012, frame); // alza
      box(0.006, 0.01, 0.008, 0.008, 0.066, 0.012, frame);
      out = { muzzle: new THREE.Vector3(0, 0.047, -0.17), sightY: 0.068, support: new THREE.Vector3(-0.02, -0.045, 0.0), long: false };
      break;
    case 'smg':
      box(0.04, 0.052, 0.26, 0, 0.042, -0.09, slide); // cajón de mecanismos
      box(0.046, 0.046, 0.13, 0, 0.028, -0.215, frame); // guardamanos
      tube(0.011, -0.28, -0.35, 0.044, steel);
      tube(0.016, -0.35, -0.37, 0.044, frame); // bocacha
      box(0.024, 0.13, 0.036, 0, -0.05, -0.115, frame, 0.25); // cargador curvo
      box(0.03, 0.095, 0.042, 0, -0.03, 0.005, frame, -0.3); // pistolete
      box(0.006, 0.006, 0.05, 0, 0.006, -0.04, frame); // guardamonte
      box(0.012, 0.012, 0.12, -0.016, 0.04, 0.09, steel); // culata plegable (dos varillas)
      box(0.012, 0.012, 0.12, 0.016, 0.04, 0.09, steel);
      box(0.044, 0.05, 0.014, 0, 0.03, 0.15, frame);
      box(0.006, 0.018, 0.012, -0.009, 0.077, 0.02, steel); // alza (dos orejetas)
      box(0.006, 0.018, 0.012, 0.009, 0.077, 0.02, steel);
      box(0.005, 0.024, 0.005, 0, 0.079, -0.26, steel); // punto de mira
      box(0.02, 0.006, 0.02, 0, 0.069, -0.26, steel);
      out = { muzzle: new THREE.Vector3(0, 0.044, -0.375), sightY: 0.088, support: new THREE.Vector3(0, -0.005, -0.21), long: true };
      break;
    case 'shotgun':
      tube(0.013, -0.1, -0.62, 0.052, steel); // cañón
      tube(0.011, -0.1, -0.52, 0.026, frame); // depósito tubular
      box(0.05, 0.044, 0.17, 0, 0.026, -0.33, wood); // corredera de bombeo
      box(0.052, 0.006, 0.17, 0, 0.026, -0.33, woodD);
      box(0.042, 0.058, 0.17, 0, 0.042, -0.03, slide); // cajón
      box(0.006, 0.006, 0.05, 0, 0.004, -0.02, frame); // guardamonte
      box(0.036, 0.075, 0.07, 0, -0.008, 0.06, wood, -0.35); // garganta
      box(0.04, 0.065, 0.14, 0, 0.008, 0.15, wood, -0.12); // culata (el resto queda bajo el hombro)
      box(0.008, 0.008, 0.008, 0, 0.069, -0.61, sight); // punto
      out = { muzzle: new THREE.Vector3(0, 0.052, -0.63), sightY: 0.08, support: new THREE.Vector3(0, 0.0, -0.33), long: true };
      break;
    default:
      return null;
  }
  const geo = mergeGeometries(parts)!;
  geo.computeVertexNormals();
  return { geo, ...out };
}

/**
 * Material de «vista de arma»: con prueba de profundidad entre sus propias piezas (los dedos rodean
 * la empuñadura), pero aplastado contra el plano cercano para que nunca lo tape el escenario.
 */
function viewModel<M extends THREE.Material>(m: M): M {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace(/}\s*$/, '  gl_Position.z = -gl_Position.w + 0.03 * (gl_Position.z + gl_Position.w);\n}');
  };
  m.customProgramCacheKey = () => 'viewmodel';
  return m;
}

export class FirstPersonArms {
  readonly group = new THREE.Group();
  private readonly left: THREE.Mesh;
  private readonly right: THREE.Mesh;
  private t = 0;
  private sway = new THREE.Vector2();
  private readonly wheel = new THREE.Group();

  constructor(skin = 0xe0ac85, sleeve = 0xf2f2f2) {
    // se dibujan siempre por encima (como las armas/manos de los juegos en primera persona): no se meten en el salpicadero
    const mat = viewModel(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, emissive: 0x2a2018, emissiveIntensity: 0.6 }));
    this.left = new THREE.Mesh(armGeometry(skin, sleeve, -1), mat);
    this.right = new THREE.Mesh(armGeometry(skin, sleeve, 1), mat);
    this.group.add(this.left, this.right);
    this.group.visible = false;
    this.left.renderOrder = this.right.renderOrder = 20;
    // volante en primer plano (al conducir): aro, radios y centro
    const wm = viewModel(new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.6 }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.017, 6, 18), wm);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.03, 10).rotateX(Math.PI / 2), wm);
    const spokeL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.025, 0.012).translate(-0.09, -0.01, 0), wm);
    const spokeR = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.025, 0.012).translate(0.09, -0.01, 0), wm);
    this.wheel.add(ring, hub, spokeL, spokeR);
    this.wheel.traverse((o) => { o.renderOrder = 19; o.frustumCulled = false; });
    this.wheel.position.set(0, -0.36, -0.5);
    this.wheel.rotation.x = -0.45;
    this.group.add(this.wheel);
    // conjunto del arma
    this.vm.add(this.rPivot, this.lPivot, this.muzzleObj);
    const fm = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const fg = new THREE.BufferGeometry();
    const star: number[] = [];
    for (let k = 0; k < 8; k++) {
      const a0 = (k / 8) * Math.PI * 2, a1 = ((k + 0.5) / 8) * Math.PI * 2, a2 = ((k + 1) / 8) * Math.PI * 2;
      const r = k % 2 ? 0.035 : 0.06;
      star.push(0, 0, 0, Math.cos(a0) * 0.015, Math.sin(a0) * 0.015, 0, Math.cos(a1) * r, Math.sin(a1) * r, 0);
      star.push(0, 0, 0, Math.cos(a1) * r, Math.sin(a1) * r, 0, Math.cos(a2) * 0.015, Math.sin(a2) * 0.015, 0);
    }
    fg.setAttribute('position', new THREE.Float32BufferAttribute(star, 3));
    this.flash = new THREE.Mesh(fg, fm);
    this.flash.renderOrder = 22;
    this.flash.visible = false;
    this.muzzleObj.add(this.flash);
    this.vm.visible = false;
    this.group.add(this.vm);
    this.group.traverse((o) => { o.frustumCulled = false; });
  }

  private gun: THREE.Mesh | null = null;
  private gunDef: ViewGun | null = null;
  private gunKind: Prop = 'none';
  private aim = false;
  private aimK = 0;
  private kick = 0;
  /** Conjunto arma + manos, colocado en el espacio de la cámara. */
  private readonly vm = new THREE.Group();
  private readonly rPivot = new THREE.Group();
  private readonly lPivot = new THREE.Group();
  private readonly muzzleObj = new THREE.Object3D();
  private readonly flash: THREE.Mesh;
  private flashT = 0;
  private armedNow = false;

  /** Arma en la mano derecha (vista en primera persona). */
  setWeapon(kind: Prop, aiming: boolean) {
    this.aim = aiming;
    if (kind === this.gunKind) return;
    this.gunKind = kind;
    if (this.gun) { this.vm.remove(this.gun); this.gun.geometry.dispose(); this.gun = null; }
    this.gunDef = viewGun(kind);
    if (!this.gunDef) return;
    const m = new THREE.Mesh(this.gunDef.geo, viewModel(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.35, emissive: 0x1c1c20, emissiveIntensity: 1 })));
    m.renderOrder = 21;
    m.frustumCulled = false;
    this.vm.add(m);
    this.gun = m;
    this.muzzleObj.position.copy(this.gunDef.muzzle);
  }
  recoil(k = 1) {
    this.kick = Math.min(1.5, this.kick + k);
    this.flashT = 0.05;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.8 + Math.random() * 0.5);
  }
  /** Posición en el mundo de la boca del cañón (para trazadoras y fogonazo). */
  muzzleWorld(out: THREE.Vector3) {
    this.muzzleObj.updateWorldMatrix(true, false);
    return this.muzzleObj.getWorldPosition(out);
  }
  get armed() { return this.armedNow; }
  private relT = 0;
  private relLen = 0;
  private relShotgun = false;
  /** Recarga en primera persona: el arma baja y gira, la mano izquierda cambia el cargador. */
  reload(duration: number, shotgun: boolean) { this.relT = 0; this.relLen = duration; this.relShotgun = shotgun; }

  /** Engancha cada brazo a su pivote (empuñando) o al grupo (manos libres / volante). */
  private setArmed(on: boolean) {
    if (on === this.armedNow) return;
    this.armedNow = on;
    this.vm.visible = on;
    if (on) {
      this.rPivot.add(this.right); this.lPivot.add(this.left);
      // la palma (z≈0.37 del brazo) cae justo en el pivote; el brazo se extiende hacia atrás
      for (const m of [this.right, this.left]) { m.position.set(0, 0, 0.37); m.rotation.set(0, Math.PI, 0); }
    } else {
      this.group.add(this.right, this.left);
    }
  }

  /**
   * Mano derecha en la empuñadura: palma pegada al costado derecho mirando a la izquierda, dedos que
   * rodean el frente y pulgar arriba; el antebrazo sale hacia atrás, abajo y a la derecha.
   */
  private gripRight() {
    this.rPivot.position.set(0.024, -0.028, 0.022);
    this.rPivot.rotation.set(0.42, 0.28, -Math.PI / 2, 'YXZ');
  }

  private posePistol(out: number, ins: number) {
    this.gripRight();
    // la izquierda envuelve por el otro costado (agarre a dos manos); en la recarga baja a por el cargador
    this.lPivot.position.set(-0.024 - 0.05 * out, -0.05 - 0.2 * out + 0.03 * ins, 0.018 + 0.05 * out - 0.01 * ins);
    this.lPivot.rotation.set(0.5 + 0.5 * out, -0.42 - 0.3 * out, Math.PI / 2 - 0.25 - 0.6 * out, 'YXZ');
  }

  private poseLong(rel: number, out: number, ins: number) {
    const d = this.gunDef!;
    this.gripRight();
    // izquierda bajo el guardamanos / la corredera, palma arriba
    const sup = d.support;
    let x = -0.004, y = sup.y - 0.032, z = sup.z;
    let roll = Math.PI;
    if (this.relShotgun) {
      // escopeta: de la corredera a la ventana de carga, cartucho a cartucho
      const g = Math.min(1, rel * 1.5);
      z = THREE.MathUtils.lerp(sup.z, -0.06, g * (0.5 + 0.5 * ins));
      y -= 0.03 * ins * g;
      roll = Math.PI - 0.5 * g;
    } else {
      x -= 0.06 * out; y -= 0.24 * out; z += 0.1 * out;
      z = THREE.MathUtils.lerp(z, -0.115, ins * 0.85);
      y -= 0.05 * ins;
    }
    this.lPivot.position.set(x, y, z);
    this.lPivot.rotation.set(0.42 + 0.4 * out, -0.5 - 0.2 * out, roll, 'YXZ');
  }

  /** mouseDX/DY: inercia de los brazos al girar la cámara. */
  update(dt: number, mode: 'off' | 'foot' | 'car', walkSpeed: number, steer: number, mouseDX = 0, mouseDY = 0) {
    this.group.visible = mode !== 'off';
    if (mode === 'off') return;
    this.sway.x += (-mouseDX * 0.0005 - this.sway.x) * Math.min(1, dt * 8);
    this.sway.y += (mouseDY * 0.0005 - this.sway.y) * Math.min(1, dt * 8);
    this.group.position.set(this.sway.x, this.sway.y, 0);
    this.wheel.visible = mode === 'car';
    this.kick = Math.max(0, this.kick - dt * 8);
    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.visible = this.flashT > 0;
    const armed = mode === 'foot' && !!this.gunDef;
    this.setArmed(armed);
    if (armed) {
      const d = this.gunDef!;
      // apuntar: el arma sube al centro y las miras se alinean con el centro de la pantalla
      this.aimK += ((this.aim ? 1 : 0) - this.aimK) * Math.min(1, dt * 12);
      let rel = 0, out = 0, ins = 0;
      if (this.relLen > 0 && this.relT < this.relLen) {
        this.relT += dt;
        const u = this.relT / this.relLen;
        rel = Math.min(1, u * 5, (1 - u) * 5);
        if (this.relShotgun) ins = Math.abs(Math.sin(u * Math.PI * 4));
        else { out = u < 0.45 ? Math.sin((u / 0.45) * Math.PI) : 0; ins = u >= 0.4 && u < 0.85 ? Math.sin(((u - 0.4) / 0.45) * Math.PI) : 0; }
      }
      const a = this.aimK * (1 - rel);
      this.t += (dt * walkSpeed) / 0.85;
      const k = Math.min(1, walkSpeed / 4) * (1 - 0.7 * a);
      const bobX = Math.sin(this.t * Math.PI) * 0.008 * k, bobY = -Math.abs(Math.cos(this.t * Math.PI)) * 0.008 * k;
      const hip = d.long ? new THREE.Vector3(0.11, -0.105, -0.36) : new THREE.Vector3(0.11, -0.1, -0.43);
      const ads = new THREE.Vector3(0, -d.sightY, this.gunKind === 'shotgun' ? -0.4 : d.long ? -0.34 : -0.38);
      this.vm.position.lerpVectors(hip, ads, a);
      this.vm.position.x += bobX;
      this.vm.position.y += bobY - 0.05 * rel;
      this.vm.position.z += this.kick * (d.long ? 0.05 : 0.035);
      // de cadera, ligeramente girada hacia el centro y ladeada; en la recarga baja la boca y rota
      this.vm.rotation.set(
        this.kick * (d.long ? 0.06 : 0.14) - 0.45 * rel,
        (0.06 + 0.02 * Math.sin(this.t * Math.PI)) * (1 - a) + 0.15 * rel,
        -0.06 * (1 - a) + (d.long ? 0.35 : 0.6) * rel,
      );
      if (d.long) this.poseLong(rel, out, ins); else this.posePistol(out, ins);
      return;
    }
    if (mode === 'foot') {
      this.t += (dt * walkSpeed) / 0.85; // un ciclo por paso, como la cabeza
      const k = Math.min(1, walkSpeed / 4);
      const sw = Math.sin(this.t * Math.PI) * k;
      const up = Math.abs(Math.cos(this.t * Math.PI)) * 0.008 * k;
      this.right.position.set(0.2, -0.24 + up - sw * 0.012, -0.24 + sw * 0.03);
      this.left.position.set(-0.2, -0.24 + up + sw * 0.012, -0.24 - sw * 0.03);
      this.right.rotation.set(0.15, Math.PI + 0.22, 0.25);
      this.left.rotation.set(0.15, Math.PI - 0.22, -0.25);
    } else {
      // manos a las diez y diez del volante
      // el aro gira hacia el mismo lado que la dirección (a la derecha, en sentido horario)
      const a = Math.max(-1.25, Math.min(1.25, steer * 0.9));
      this.wheel.rotation.z = -a;
      const r = 0.12;
      // manos sobre el aro, que giran con él (sentido horario al girar a la derecha)
      const R = [r * Math.cos(0.55 - a), r * Math.sin(0.55 - a)];
      const L = [-r * Math.cos(0.55 + a), r * Math.sin(0.55 + a)];
      this.right.position.set(R[0] + 0.12, -0.36 + R[1], -0.1);
      this.left.position.set(L[0] - 0.12, -0.36 + L[1], -0.1);
      this.right.rotation.set(0.42, Math.PI + 0.3, 0.5 - a * 0.6);
      this.left.rotation.set(0.42, Math.PI - 0.3, -0.5 - a * 0.6);
    }
  }
}
