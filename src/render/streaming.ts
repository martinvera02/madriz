import * as THREE from 'three';

/**
 * Rendimiento a escala de ciudad:
 *  - `splitByGrid` trocea las mallas fusionadas gigantes (suelo, calles, edificios…) en celdas, para que
 *    la cámara y la sombra del sol descarten lo que no ven en vez de dibujar barrios enteros.
 *  - `DrawDistance` apaga por distancia cada trozo según su categoría (los árboles y el mobiliario
 *    desaparecen antes que los edificios) y según la niebla del momento, con un ajuste de calidad.
 */

/** Trocea una malla estática en celdas cuadradas de `cell` metros según el centro de cada triángulo. */
export function splitByGrid(mesh: THREE.Mesh, cell: number): THREE.Mesh[] {
  const g = mesh.geometry as THREE.BufferGeometry;
  if (g.groups.length > 1 || Array.isArray(mesh.material)) return [mesh];
  mesh.updateMatrixWorld(true);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const index = g.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  if (triCount < 2000) return [mesh];
  const vi = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  const m = mesh.matrixWorld;
  const v = new THREE.Vector3();
  // triángulos por celda
  const cells = new Map<string, number[]>();
  for (let t = 0; t < triCount; t++) {
    let cx = 0, cz = 0;
    for (let k = 0; k < 3; k++) { v.fromBufferAttribute(pos, vi(t, k)).applyMatrix4(m); cx += v.x; cz += v.z; }
    const key = `${Math.floor(cx / 3 / cell)},${Math.floor(cz / 3 / cell)}`;
    let arr = cells.get(key);
    if (!arr) cells.set(key, (arr = []));
    arr.push(t);
  }
  if (cells.size < 2) return [mesh];
  const names = Object.keys(g.attributes);
  const out: THREE.Mesh[] = [];
  // renumeración de vértices con arrays tipados (un Map por celda costaba cientos de MB con el mapa grande)
  const remap = new Int32Array(pos.count).fill(-1);
  for (const tris of cells.values()) {
    const idx = new Uint32Array(tris.length * 3);
    const used = new Uint32Array(tris.length * 3);
    let n = 0;
    for (let i = 0; i < tris.length; i++) {
      for (let k = 0; k < 3; k++) {
        const o = vi(tris[i], k);
        let r = remap[o];
        if (r < 0) { r = n++; remap[o] = r; used[r] = o; }
        idx[i * 3 + k] = r;
      }
    }
    const ng = new THREE.BufferGeometry();
    for (const name of names) {
      const a = g.attributes[name] as THREE.BufferAttribute;
      const Arr = (a.array as unknown as { constructor: new (n: number) => THREE.TypedArray }).constructor;
      const sz = a.itemSize, src = a.array;
      const arr = new Arr(n * sz);
      for (let r = 0; r < n; r++) { const o = used[r]; for (let c = 0; c < sz; c++) arr[r * sz + c] = src[o * sz + c]; }
      ng.setAttribute(name, new THREE.BufferAttribute(arr, sz, a.normalized));
    }
    for (let r = 0; r < n; r++) remap[used[r]] = -1;
    ng.setIndex(new THREE.BufferAttribute(n > 65535 ? idx : new Uint16Array(idx), 1));
    ng.computeBoundingSphere();
    ng.computeBoundingBox();
    const part = new THREE.Mesh(ng, mesh.material);
    part.position.copy(mesh.position); part.quaternion.copy(mesh.quaternion); part.scale.copy(mesh.scale);
    part.castShadow = mesh.castShadow; part.receiveShadow = mesh.receiveShadow;
    part.renderOrder = mesh.renderOrder;
    part.userData = { ...mesh.userData };
    part.onBeforeRender = mesh.onBeforeRender;
    out.push(part);
  }
  g.dispose();
  return out;
}

/** Sustituye en el grupo cada malla grande por sus trozos (solo mallas normales, no instanciadas ni con esqueleto). */
export function splitGroup(group: THREE.Object3D, cell: number) {
  const targets: THREE.Mesh[] = [];
  group.traverse((o) => {
    const me = o as THREE.Mesh;
    if (me.isMesh && !(o as THREE.InstancedMesh).isInstancedMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh && o.parent) targets.push(me);
  });
  for (const me of targets) {
    const parts = splitByGrid(me, cell);
    if (parts.length === 1 && parts[0] === me) continue;
    const parent = me.parent!;
    parent.remove(me);
    for (const p of parts) parent.add(p);
    // soltar ya los arrays de la malla original (si no, siguen vivos hasta acabar todo el grupo)
    me.geometry = new THREE.BufferGeometry();
  }
}

/** Reparte las instancias de una malla instanciada global en una malla instanciada por celda. */
export function splitInstancedByGrid(im: THREE.InstancedMesh, cell: number): THREE.InstancedMesh[] {
  if (im.count < 200) return [im];
  const cells = new Map<string, number[]>();
  const mtx = new THREE.Matrix4(), p = new THREE.Vector3();
  for (let i = 0; i < im.count; i++) {
    im.getMatrixAt(i, mtx);
    p.setFromMatrixPosition(mtx);
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
    let arr = cells.get(key);
    if (!arr) cells.set(key, (arr = []));
    arr.push(i);
  }
  if (cells.size < 2) return [im];
  const out: THREE.InstancedMesh[] = [];
  const col = new THREE.Color();
  for (const ids of cells.values()) {
    const part = new THREE.InstancedMesh(im.geometry, im.material, ids.length);
    ids.forEach((src, k) => {
      im.getMatrixAt(src, mtx); part.setMatrixAt(k, mtx);
      if (im.instanceColor) { im.getColorAt(src, col); part.setColorAt(k, col); }
    });
    part.instanceMatrix.needsUpdate = true;
    part.castShadow = im.castShadow; part.receiveShadow = im.receiveShadow;
    part.position.copy(im.position); part.quaternion.copy(im.quaternion); part.scale.copy(im.scale);
    part.renderOrder = im.renderOrder;
    part.computeBoundingSphere();
    out.push(part);
  }
  return out;
}

/** Igual que `splitGroup`, para las mallas instanciadas del grupo. */
export function splitInstancedGroup(group: THREE.Object3D, cell: number) {
  const targets: THREE.InstancedMesh[] = [];
  group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh && o.parent) targets.push(o as THREE.InstancedMesh); });
  for (const im of targets) {
    const parts = splitInstancedByGrid(im, cell);
    if (parts.length === 1 && parts[0] === im) continue;
    const parent = im.parent!;
    parent.remove(im);
    for (const q of parts) parent.add(q);
  }
}

/** Categorías de distancia de dibujado (metros con calidad «media»). `fog`: además, nunca más allá de la niebla. */
export const DRAW_DIST = {
  city: { d: 2600, fog: true },     // suelo, calles y edificios
  landmark: { d: 3200, fog: false }, // monumentos y edificios singulares (se ven por encima de la niebla)
  detail: { d: 420, fog: true },    // mobiliario urbano, detalles de fachada
  props: { d: 330, fog: true },     // árboles, farolas, semáforos
  roof: { d: 380, fog: true },      // antenas, aparatos de aire, chimeneas
} as const;
export type DrawCategory = keyof typeof DRAW_DIST;

interface Entry { obj: THREE.Object3D; center: THREE.Vector3; radius: number; cat: DrawCategory }

export class DrawDistance {
  private entries: Entry[] = [];
  /** Multiplicador de calidad (0,6 corta · 1 media · 1,6 larga). */
  scale = 1;
  private t = 0;
  visibleCount = 0;

  /** Registra todas las mallas (normales e instanciadas) que cuelgan de `root`. */
  add(root: THREE.Object3D, cat: DrawCategory) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const me = o as THREE.Mesh;
      if (!me.isMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) return;
      let sphere: THREE.Sphere | null;
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) { im.computeBoundingSphere(); sphere = im.boundingSphere; }
      else { if (!me.geometry.boundingSphere) me.geometry.computeBoundingSphere(); sphere = me.geometry.boundingSphere; }
      if (!sphere || !Number.isFinite(sphere.radius)) return;
      const s = sphere.clone().applyMatrix4(o.matrixWorld);
      this.entries.push({ obj: o, center: s.center, radius: s.radius, cat });
    });
  }

  /** Cada pocos frames: enciende o apaga cada trozo según la distancia a la cámara. */
  update(dt: number, cam: THREE.Vector3, fogFar: number, force = false) {
    this.t -= dt;
    if (this.t > 0 && !force) return;
    this.t = 0.2;
    let vis = 0;
    for (const e of this.entries) {
      const c = DRAW_DIST[e.cat];
      let max = c.d * this.scale;
      if (c.fog) max = Math.min(max, fogFar + 60);
      const d = Math.hypot(e.center.x - cam.x, e.center.z - cam.z) - e.radius;
      const on = d < max;
      if (e.obj.visible !== on) e.obj.visible = on;
      if (on) vis++;
    }
    this.visibleCount = vis;
  }

  get count() { return this.entries.length; }
}
