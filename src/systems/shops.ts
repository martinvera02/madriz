import * as THREE from 'three';
import { Marker, ARMERIA_AT, TALLER_AT, type MissionCtx } from './missions';
import { WEAPONS, type Combat } from './combat';
import type { MapIcon } from '../ui/mapIcons';

/**
 * Tiendas: la armería de la calle de la Montera (armas, munición y botiquín) y el taller de Embajadores
 * (repara el coche y le cambia la matrícula: la policía te pierde). Se usan con E dentro del marcador;
 * el menú de la armería se maneja con W/S (o flechas), E para comprar y Q para salir.
 */

interface Item { name: string; price: number; can(): string | null; buy(): void }

export class Shops {
  /** ¿Menú de la armería abierto? (el jugador se queda quieto). */
  open = false;
  private sel = 0;
  private items: Item[];
  private readonly armeria: { marker: Marker; pos: THREE.Vector3 };
  private readonly taller: { marker: Marker; pos: THREE.Vector3 };
  private readonly panel = document.getElementById('shop')!;

  constructor(private ctx: MissionCtx, combat: Combat, private money: { get(): number; pay(eur: number): boolean }) {
    const mk = (at: [number, number], color: number, car: boolean, r: number) => {
      const pos = car ? ctx.snapCar(at[0], at[1]) : ctx.snapWalk(at[0], at[1]);
      const marker = new Marker(color, r, car ? 1.4 : 1.1);
      marker.group.position.copy(pos);
      ctx.scene.add(marker.group);
      return { marker, pos };
    };
    this.armeria = mk(ARMERIA_AT, 0x5f8fd8, false, 1.3);
    this.taller = mk(TALLER_AT, 0x6fbf73, true, 3.2);
    const idx = (id: string) => WEAPONS.findIndex((w) => w.id === id);
    const weapon = (id: string, price: number): Item => ({
      name: WEAPONS[idx(id)].name, price,
      can: () => (combat.owned[idx(id)] ? 'Ya la tienes' : null),
      buy: () => { combat.give(idx(id)); combat.select(idx(id)); },
    });
    const ammo = (id: string, n: number, price: number, label: string): Item => ({
      name: `${label} ×${n}`, price,
      can: () => (combat.owned[idx(id)] ? null : 'Primero necesitas el arma'),
      buy: () => { combat.reserve[idx(id)] += n; },
    });
    this.items = [
      weapon('bate', 25),
      weapon('subfusil', 450),
      weapon('escopeta', 600),
      ammo('pistola', 24, 30, 'Balas de pistola'),
      ammo('subfusil', 60, 60, 'Balas de subfusil'),
      ammo('escopeta', 12, 45, 'Cartuchos'),
      { name: 'Botiquín (vida al 100 %)', price: 25, can: () => (ctx.player.health >= 99 ? 'Estás perfectamente' : null), buy: () => { ctx.player.health = 100; } },
    ];
  }

  icons(): MapIcon[] {
    return [
      { x: this.armeria.pos.x, z: this.armeria.pos.z, kind: 'armeria', label: 'Armería Montera' },
      { x: this.taller.pos.x, z: this.taller.pos.z, kind: 'taller', label: 'Taller de Embajadores · reparar y despistar a la policía' },
    ];
  }

  blips() {
    return [
      { x: this.armeria.pos.x, z: this.armeria.pos.z, color: '#5f8fd8', size: 3.5 },
      { x: this.taller.pos.x, z: this.taller.pos.z, color: '#6fbf73', size: 3.5 },
    ];
  }

  private inArmeria() {
    const p = this.ctx.player;
    return !p.vehicle && p.pos.distanceTo(this.armeria.pos) < 1.8;
  }

  /** Acción con E (armería a pie, taller en coche). */
  action(): { text: string; run: () => void } | null {
    const p = this.ctx.player;
    if (this.inArmeria() && !this.open) return { text: 'Entrar en la armería', run: () => this.show(true) };
    const v = p.vehicle;
    if (v && v.pos.distanceTo(this.taller.pos) < 4 && v.speed < 2) {
      const price = 120;
      return {
        text: `Taller: reparar y cambiar matrícula (${price} €)`,
        run: () => {
          if (v.health >= 99 && !v.flats && v.headOk === 1 && this.ctx.police.stars === 0) { this.ctx.hud.say('Mecánico', 'Este coche está nuevo, chaval.', v.pos); return; }
          if (!this.money.pay(price)) { this.ctx.hud.say('Mecánico', 'Sin pasta no hay chapa.', v.pos); return; }
          v.repair();
          this.ctx.police.clear();
          this.ctx.hud.toast('Coche reparado y matrícula nueva');
          this.ctx.hud.say('Mecánico', 'Como nuevo. Y aquí no has estado.', v.pos);
        },
      };
    }
    return null;
  }

  private show(on: boolean) {
    this.open = on;
    this.panel.classList.toggle('on', on);
    if (on) this.render();
  }

  private render(msg = '') {
    const m = this.money.get();
    this.panel.innerHTML = `<b>ARMERÍA MONTERA</b>` +
      this.items.map((it, i) => {
        const why = it.can();
        const cls = [i === this.sel ? 'sel' : '', why || m < it.price ? 'off' : ''].join(' ');
        return `<div class="${cls}"><span>${it.name}</span><em>${why ?? it.price.toLocaleString('es-ES') + ' €'}</em></div>`;
      }).join('') +
      `<p>${msg || 'W/S elegir · E comprar · Q salir'}</p>`;
  }

  /** Teclas del menú: up/down/buy/close (pulsadas en este frame). */
  update(dt: number, keys: { up: boolean; down: boolean; buy: boolean; close: boolean }) {
    const me = this.ctx.player.vehicle ? this.ctx.player.vehicle.pos : this.ctx.player.pos;
    this.armeria.marker.update(dt, me);
    this.taller.marker.update(dt, me);
    if (!this.open) return;
    if (keys.close || !this.inArmeria()) { this.show(false); return; }
    if (keys.up) { this.sel = (this.sel + this.items.length - 1) % this.items.length; this.render(); }
    if (keys.down) { this.sel = (this.sel + 1) % this.items.length; this.render(); }
    if (keys.buy) {
      const it = this.items[this.sel];
      const why = it.can();
      if (why) { this.render(why); return; }
      if (!this.money.pay(it.price)) { this.render('No te llega el dinero'); return; }
      it.buy();
      this.render(`Comprado: ${it.name}`);
    }
  }
}
