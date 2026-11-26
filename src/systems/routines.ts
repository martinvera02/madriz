import * as THREE from 'three';
import { angleDiff } from '../config';
import { Character, randomLook, type Action, type Look, type Prop } from '../entities/character';
import type { CollisionWorld } from '../world/collision';
import type { Ground } from '../world/roads';
import type { CarwayIndex } from '../world/spatial';

/*
 * Vecinos con rutina (personajes con nombre que viven en el centro y siguen un horario):
 *   Paco, el quiosquero · Lucía, música callejera · Don Manuel, vendedor de cupones ·
 *   Toni, barrendero del turno de noche · Agente Ruiz, Policía Municipal · el abuelo Julián, en su banco.
 * Cada uno tiene franjas horarias con un sitio, una actividad (animación y objeto) o una ruta.
 * Si el jugador está cerca, caminan de un sitio a otro; si no, aparecen directamente.
 * La policía reacciona a los tiros: da el alto, apunta y, si sigues disparando, dispara.
 */

interface Slot { from: number; to: number; spot?: number; route?: number[]; action: Action; prop: Prop; speed?: number }
export interface RoutineNpc {
  name: string; role: string; look: Look; ch: Character; pos: THREE.Vector3; heading: number;
  slots: Slot[]; lines: string[]; shout?: string[]; spots: THREE.Vector3[]; headings: number[];
  visible: boolean; routeIdx: number; stuck: number; health: number; alive: boolean;
  talkT: number; shoutT: number; police?: { state: 'calm' | 'alert' | 'hostile'; t: number; fireT: number };
  blip: string;
}

const inHours = (h: number, a: number, b: number) => (a <= b ? h >= a && h < b : h >= a || h < b);

export class Routines {
  readonly npcs: RoutineNpc[] = [];
  /** Frase dicha en voz alta por un PNJ (para el bocadillo del HUD). */
  onSay: ((npc: RoutineNpc, text: string, loud: boolean) => void) | null = null;
  /** Disparo de la policía al jugador: devuelve si acierta. */
  onPoliceShot: ((from: THREE.Vector3, to: THREE.Vector3) => void) | null = null;

  constructor(private scene: THREE.Scene, private world: CollisionWorld, private ground: Ground, private carway: CarwayIndex,
    center: { x: number; z: number }, kiosk: { x: number; z: number } | null, bench: { x: number; z: number } | null) {
    const free = (x: number, z: number) => this.freeSpot(x, z);
    const C = (dx: number, dz: number) => free(center.x + dx, center.z + dz);
    const ks = kiosk ? free(kiosk.x, kiosk.z + 2.2) : C(20, 12);
    const bs = bench ? new THREE.Vector3(bench.x, this.ground.heightAt(bench.x, bench.z), bench.z) : C(-25, 30);

    this.add('Paco', 'quiosquero', { ...randomLook(), female: false, top: 'jacket', shirt: 0x3a4250, inner: 0xe9e6df, hairStyle: 'bald', beard: true, build: 1.15 },
      [ks], [{ from: 7, to: 21, spot: 0, action: 'arms', prop: 'none' }],
      ['¡Buenas! ¿El Marca o el As?', 'Hoy los titulares vienen calentitos.', 'Llevo treinta años en este quiosco, chaval.', '¿Un plano de Madrid? Tengo de los buenos.', 'Si buscas algo por el barrio, pregúntame a mí.'], '#d4c29a');
    this.add('Lucía', 'música callejera', { ...randomLook(), female: true, top: 'jacket', shirt: 0x5a3a24, inner: 0x2b2d31, hairStyle: 'long', hair: 0x3a1f14 },
      [C(-30, -38), C(-60, -10)], [{ from: 11, to: 14, spot: 0, action: 'guitar', prop: 'guitar' }, { from: 17, to: 22.5, spot: 0, action: 'guitar', prop: 'guitar' }, { from: 14, to: 17, spot: 1, action: 'drink', prop: 'coffee' }],
      ['Si te gusta, échame algo en la funda.', 'Toco aquí todas las tardes, vente.', 'Esta la compuse en el metro de Tribunal.', 'Madrid suena mejor con guitarra, ¿a que sí?'], '#b75b32');
    this.add('Don Manuel', 'vendedor de cupones', { ...randomLook(), female: false, top: 'long', shirt: 0x1d2e6b, hairStyle: 'cap', capColor: 0x1d2e6b, hair: 0x9a9a9a, height: 0.95 },
      [C(14, 8)], [{ from: 9, to: 20, spot: 0, action: 'look', prop: 'none' }],
      ['¡Pa’ hoy! ¡Que me lo quitan de las manos!', 'El treinta y cuatro, el treinta y cuatro... ¿te lo llevas?', 'La suerte está en la calle, hijo.'], '#f2d14a',
      ['¡Pa’ hoy, pa’ hoy!', '¡Que toca, que toca!', '¡El cupón de hoy!']);
    this.add('Toni', 'barrendero', { ...randomLook(), female: false, top: 'long', shirt: 0xe07a20, pants: 0x2b3a55, hairStyle: 'beanie', capColor: 0x2b3a55 },
      [C(-40, 0), C(0, -40), C(40, 0), C(0, 40)], [{ from: 21.5, to: 6, route: [0, 1, 2, 3], action: 'sweep', prop: 'broom', speed: 0.55 }],
      ['Cuidado, que acabo de pasar la escoba.', 'Las noches del sábado son lo peor.', 'A las seis acabo y a dormir.', 'Lo que tira la gente al suelo, no te lo crees.'], '#e07a20');
    this.add('Agente Ruiz', 'Policía Municipal', { ...randomLook(), female: false, top: 'jacket', shirt: 0x1d2a44, inner: 0xe9e6df, pants: 0x1d2a44, hairStyle: 'cap', capColor: 0x1d2a44, stripe: true },
      [C(-55, -30), C(35, -45), C(55, 25), C(-30, 50)], [{ from: 8, to: 23, route: [0, 1, 2, 3], action: 'none', prop: 'none', speed: 1.25 }],
      ['Buenas. Circule, circule.', 'Todo tranquilo por Sol, ¿no?', '¿Necesita algo?', 'Ojo con la cartera por aquí, que hay mucho listo.'], '#5f8fd8',
      ['¡Alto! ¡Policía Municipal!', '¡Suelte el arma!', '¡Al suelo, ya!']);
    this.add('Julián', 'jubilado', { ...randomLook(), female: false, top: 'jacket', shirt: 0x5a4a36, inner: 0xcfcfcf, hairStyle: 'cap', capColor: 0x4a3c2a, hair: 0xbdbdbd, height: 0.93 },
      [bs], [{ from: 10, to: 13.5, spot: 0, action: 'sit', prop: 'none' }, { from: 17, to: 20.5, spot: 0, action: 'sit', prop: 'none' }],
      ['Las palomas ya me conocen, ¿ves?', 'En mis tiempos esto era otra cosa...', 'Siéntate un rato, que no muerdo.', '¿Tú de quién eres, chaval?'], '#9aa7b0');
    // el abuelo mira a la calle desde el banco
    const jul = this.npcs[this.npcs.length - 1];
    const near = this.carway.nearest(bs.x, bs.z);
    if (near) jul.headings[0] = Math.atan2(near.px - bs.x, near.pz - bs.z);
    const police = this.npcs.find((n) => n.role === 'Policía Municipal');
    if (police) { police.police = { state: 'calm', t: 0, fireT: 0 }; police.health = 160; police.ch.setProp('none'); }
  }

  private freeSpot(x: number, z: number) {
    for (let r = 0; r < 30; r += 1.5) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const y = this.ground.heightAt(px, pz);
        if (!this.world.pointBlocked(px, y + 1, pz) && !this.carway.on(px, pz, 1.2)) return new THREE.Vector3(px, y, pz);
      }
    }
    return new THREE.Vector3(x, this.ground.heightAt(x, z), z);
  }

  private add(name: string, role: string, look: Look, spots: THREE.Vector3[], slots: Slot[], lines: string[], blip: string, shout?: string[]) {
    const ch = new Character(look);
    ch.root.visible = false;
    this.scene.add(ch.root);
    this.npcs.push({
      name, role, look, ch, pos: spots[0].clone(), heading: 0, slots, lines, shout, spots, headings: spots.map(() => Math.random() * 6),
      visible: false, routeIdx: 0, stuck: 0, health: 100, alive: true, talkT: 0, shoutT: 5 + Math.random() * 10, blip,
    });
  }

  /** Para el combate. */
  targets() {
    return this.npcs.filter((n) => n.visible).map((n) => ({
      pos: n.pos, radius: 0.3, height: 1.75, alive: n.alive,
      hit: (dmg: number, dx: number, dz: number, _melee: boolean, from: THREE.Vector3) => {
        if (!n.alive) return;
        n.health -= dmg;
        n.ch.play('hit');
        if (n.police) { n.police.state = 'hostile'; n.police.t = 20; }
        else if (n.health > 0) this.onSay?.(n, '¡Ay! ¿Pero tú de qué vas?', true);
        if (n.health <= 0) {
          n.alive = false;
          n.ch.setAction('none'); n.ch.setProp('none');
          n.pos.x += dx * 0.5; n.pos.z += dz * 0.5;
          void from;
        }
      },
    }));
  }

  nearest(pos: THREE.Vector3, heading: number, maxD = 2.6) {
    const fx = Math.sin(heading), fz = Math.cos(heading);
    let best: RoutineNpc | null = null, bd = maxD;
    for (const n of this.npcs) {
      if (!n.visible || !n.alive) continue;
      const dx = n.pos.x - pos.x, dz = n.pos.z - pos.z, d = Math.hypot(dx, dz);
      if (d < bd && (dx * fx + dz * fz) / (d || 1) > 0.2) { bd = d; best = n; }
    }
    return best;
  }

  talk(n: RoutineNpc, from: THREE.Vector3, armed: boolean): string {
    if (n.police) return armed ? '¡Guarde eso ahora mismo!' : n.lines[Math.floor(Math.random() * n.lines.length)];
    if (armed) return '¡Eh, eh! ¡Baja eso, que no quiero líos!';
    n.talkT = 5;
    n.heading = Math.atan2(from.x - n.pos.x, from.z - n.pos.z);
    return n.lines[Math.floor(Math.random() * n.lines.length)];
  }

  /** Distancia a la música callejera tocando (para el volumen de la guitarra). */
  buskerDistance(p: THREE.Vector3) {
    const l = this.npcs.find((n) => n.name === 'Lucía');
    if (!l || !l.visible || !l.alive || l.ch.action !== 'guitar') return Infinity;
    return l.pos.distanceTo(p);
  }

  update(dt: number, hour: number, player: THREE.Vector3, sinceShot: number, armed: boolean, playerDead: boolean) {
    for (const n of this.npcs) {
      if (!n.alive) {
        // derribado: se queda en el suelo un rato y luego desaparece hasta el día siguiente
        n.ch.setDown(1);
        n.ch.root.position.copy(n.pos);
        if (n.pos.distanceTo(player) > 60) { n.ch.root.visible = false; n.visible = false; }
        continue;
      }
      const slot = n.slots.find((s) => inHours(hour, s.from, s.to)) ?? null;
      const dPlayer = n.pos.distanceTo(player);
      // ---- policía: alerta por disparos cerca
      if (n.police && slot) {
        const pol = n.police;
        if (sinceShot < 0.5 && dPlayer < 60 && pol.state === 'calm') { pol.state = 'alert'; pol.t = 12; this.onSay?.(n, n.shout![0], true); }
        if (pol.state !== 'calm') {
          pol.t -= dt;
          if (sinceShot < 0.5 && pol.state === 'alert' && dPlayer < 40) { pol.state = 'hostile'; pol.t = 15; this.onSay?.(n, n.shout![1 + Math.floor(Math.random() * 2)], true); }
          if (sinceShot < 0.5) pol.t = Math.max(pol.t, 10);
          if (pol.t <= 0 || playerDead || (!armed && pol.state === 'alert' && pol.t < 6)) { pol.state = 'calm'; n.ch.setProp('none'); }
          // ir hacia el jugador y apuntarle
          n.ch.setProp('pistol');
          const want = Math.atan2(player.x - n.pos.x, player.z - n.pos.z);
          n.heading += angleDiff(want, n.heading) * Math.min(1, dt * 6);
          let sp = 0;
          if (dPlayer > 11) sp = 4.2;
          n.ch.setAction(dPlayer < 25 ? 'aimPistol' : 'none');
          n.ch.aimPitch = -Math.atan2(player.y - n.pos.y, dPlayer) * 0.5;
          if (sp > 0) this.walk(n, sp, dt);
          if (pol.state === 'hostile' && dPlayer < 30 && !playerDead) {
            pol.fireT -= dt;
            if (pol.fireT <= 0) {
              pol.fireT = 0.8 + Math.random() * 0.5;
              n.ch.play('recoil');
              this.onPoliceShot?.(n.ch.muzzle(new THREE.Vector3()), player.clone().setY(player.y + 1.2));
            }
          }
          this.sync(n, sp, dt);
          continue;
        }
      }
      // ---- fuera de horario: se va (desaparece cuando no lo ves de cerca)
      if (!slot) {
        if (n.visible && dPlayer > 35) { n.visible = false; n.ch.root.visible = false; }
        if (n.visible) { n.ch.setAction('none'); this.walk(n, 1.3, dt); this.sync(n, 1.3, dt); }
        continue;
      }
      if (!n.visible) {
        // aparece en su sitio (si el jugador no está mirando de cerca)
        const sp = slot.route ? n.spots[slot.route[n.routeIdx % slot.route.length]] : n.spots[slot.spot ?? 0];
        n.pos.copy(sp);
        n.heading = slot.route ? n.heading : n.headings[slot.spot ?? 0];
        n.visible = true;
        n.ch.root.visible = true;
      }
      n.ch.setProp(slot.prop);
      // charla con el jugador
      if (n.talkT > 0) {
        n.talkT -= dt;
        n.ch.setAction(slot.action === 'sit' ? 'sit' : 'talk');
        this.sync(n, 0, dt);
        continue;
      }
      let speed = 0;
      if (slot.route) {
        const tgt = n.spots[slot.route[n.routeIdx % slot.route.length]];
        const d = Math.hypot(tgt.x - n.pos.x, tgt.z - n.pos.z);
        if (d < 1.2) n.routeIdx++;
        n.heading += angleDiff(Math.atan2(tgt.x - n.pos.x, tgt.z - n.pos.z), n.heading) * Math.min(1, dt * 3);
        speed = slot.speed ?? 1.2;
        n.ch.setAction(slot.action);
      } else {
        const tgt = n.spots[slot.spot ?? 0];
        const d = Math.hypot(tgt.x - n.pos.x, tgt.z - n.pos.z);
        if (d > 0.6) {
          if (dPlayer > 120) { n.pos.copy(tgt); }
          else {
            n.heading += angleDiff(Math.atan2(tgt.x - n.pos.x, tgt.z - n.pos.z), n.heading) * Math.min(1, dt * 5);
            speed = 1.35;
            n.ch.setAction(slot.prop === 'guitar' || slot.prop === 'coffee' ? 'none' : 'none');
          }
        } else {
          n.heading += angleDiff(n.headings[slot.spot ?? 0], n.heading) * Math.min(1, dt * 3);
          n.ch.setAction(slot.action);
          // pregones del vendedor
          if (n.shout && !n.police) {
            n.shoutT -= dt;
            if (n.shoutT <= 0) { n.shoutT = 12 + Math.random() * 15; if (dPlayer < 30) this.onSay?.(n, n.shout[Math.floor(Math.random() * n.shout.length)], true); }
          }
        }
      }
      if (speed > 0) this.walk(n, speed, dt);
      this.sync(n, speed, dt);
    }
  }

  private walk(n: RoutineNpc, speed: number, dt: number) {
    const ox = n.pos.x, oz = n.pos.z;
    n.pos.x += Math.sin(n.heading) * speed * dt;
    n.pos.z += Math.cos(n.heading) * speed * dt;
    this.world.resolveCircle(n.pos, 0.32, n.pos.y);
    const moved = Math.hypot(n.pos.x - ox, n.pos.z - oz);
    n.stuck = moved < speed * dt * 0.3 ? n.stuck + dt : 0;
    if (n.stuck > 3) { n.heading += 1.2; n.stuck = 0; }
    n.pos.y = this.ground.heightAt(n.pos.x, n.pos.z, n.pos.y);
  }

  private sync(n: RoutineNpc, speed: number, dt: number) {
    n.ch.root.position.copy(n.pos);
    n.ch.root.rotation.y = n.heading;
    n.ch.animate(dt, speed);
  }
}
