import * as THREE from 'three';

/** Objetos que se recogen al pasar por encima: dinero (billetes) y munición. */
export interface Pickup { kind: 'money' | 'ammo'; amount: number; pos: THREE.Vector3; mesh: THREE.Object3D; life: number }

export class Pickups {
  readonly group = new THREE.Group();
  private list: Pickup[] = [];
  private moneyGeo = new THREE.BoxGeometry(0.16, 0.02, 0.08);
  private moneyMat = new THREE.MeshStandardMaterial({ color: 0x7fb069, emissive: 0x2a4020, emissiveIntensity: 0.8 });
  private ammoGeo = new THREE.BoxGeometry(0.18, 0.1, 0.12);
  private ammoMat = new THREE.MeshStandardMaterial({ color: 0x5a5a3a, emissive: 0x3a3420, emissiveIntensity: 0.6 });
  private t = 0;

  drop(kind: Pickup['kind'], amount: number, pos: THREE.Vector3) {
    const g = new THREE.Group();
    const n = kind === 'money' ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(kind === 'money' ? this.moneyGeo : this.ammoGeo, kind === 'money' ? this.moneyMat : this.ammoMat);
      m.position.set((Math.random() - 0.5) * 0.2, i * 0.025, (Math.random() - 0.5) * 0.2);
      m.rotation.y = Math.random() * 3;
      g.add(m);
    }
    g.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.05, (Math.random() - 0.5) * 0.8));
    this.group.add(g);
    this.list.push({ kind, amount, pos: g.position, mesh: g, life: 90 });
  }

  /** Devuelve lo recogido este frame. */
  update(dt: number, player: THREE.Vector3): Pickup[] {
    this.t += dt;
    const got: Pickup[] = [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      p.mesh.rotation.y += dt * 1.5;
      p.mesh.position.y = p.pos.y;
      const d = Math.hypot(p.pos.x - player.x, p.pos.z - player.z);
      if ((d < 1.1 && Math.abs(p.pos.y - player.y) < 1.5) || p.life <= 0) {
        if (p.life > 0) got.push(p);
        this.group.remove(p.mesh);
        this.list.splice(i, 1);
      }
    }
    return got;
  }
}
