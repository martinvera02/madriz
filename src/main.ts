import * as THREE from 'three';
import { loadWorld } from './world/realData';
import { Terrain, buildGround } from './world/terrain';
import { Ground, buildRoads } from './world/roads';
import { buildViaduct } from './world/viaduct';
import { buildStreetFurniture } from './world/streetFurniture';
import { FacadeDetail, buildRoofProps } from './world/facadeDetail';
import { setShopNight } from './world/shopfronts';
import { CarwayIndex } from './world/spatial';
import { TrafficLights } from './systems/trafficLights';
import { buildBuildings, pointInRing } from './world/buildings';
import { makeFacadeOverride, buildIconic, buildFacadeDetails } from './world/iconic';
import { buildProps } from './world/props';
import { CollisionWorld } from './world/collision';
import { Sky } from './world/sky';
import { Input } from './systems/input';
import { CameraRig } from './systems/cameraRig';
import { RoadGraph } from './systems/roadGraph';
import { Traffic } from './systems/traffic';
import { Pedestrians } from './systems/pedestrians';
import { Player } from './entities/player';
import { Vehicle, VEHICLE_TYPES, resolveVehicleCollisions, vehicleUniforms } from './entities/vehicle';
import { VehicleEffects } from './systems/effects';
import { CityAudio } from './systems/audio';
import { Hud } from './ui/hud';
import { RetroRenderer } from './render/retroPost';
import { FirstPersonArms } from './entities/fpArms';
import { Combat, WEAPONS, type Target } from './systems/combat';
import { Routines } from './systems/routines';
import { Music } from './systems/music';
import { buildInterior, updateInterior, INTERIOR_Y, type Interior } from './world/interiors';
import { Police } from './systems/police';
import { Pickups } from './systems/pickups';
import { shopDoors, type ShopDoor } from './world/shopfronts';

const params = new URLSearchParams(location.search);
const ZONE = params.get('zona') ?? 'centro';
const loadingEl = document.getElementById('loading')!;
const say = (msg: string) => { loadingEl.textContent = msg; };
const frameYield = () => new Promise((r) => requestAnimationFrame(() => r(null)));

// ---------- Renderizador y escena ----------
const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // sombras duras y marcadas
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);
const retro = new RetroRenderer(renderer);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 4000);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  retro.resize();
});

async function main() {
  // ---------- Mundo real ----------
  const { data, heights } = await loadWorld(ZONE, say);
  const attribEl = document.getElementById('attrib');
  if (attribEl && data.attribution) attribEl.textContent = data.attribution + ' · Sonidos: V. Sevedge (CC BY 3.0), SpringySpringo (CC0)';
  say('Modelando el relieve…'); await frameYield();
  const terrain = new Terrain(data, heights);
  const ground = new Ground(terrain);
  const collision = new CollisionWorld();
  const groundRes = buildGround(data, terrain);
  scene.add(groundRes.group);

  say('Trazando calles…'); await frameYield();
  const roads = buildRoads(data, ground, collision);
  scene.add(roads.group);
  if (roads.viaduct) scene.add(buildViaduct(roads.viaduct, terrain, collision));

  say(`Levantando ${data.buildings.length.toLocaleString('es-ES')} edificios…`); await frameYield();
  const { group: bGroup, placed, specials, facades, roofSpots } = buildBuildings(data, terrain, collision, makeFacadeOverride(data), groundRes.minimap);
  scene.add(bGroup);
  scene.add(buildRoofProps(roofSpots));
  const facadeDetail = new FacadeDetail(facades);
  scene.add(facadeDetail.group);
  scene.add(buildIconic(data, placed, ground, collision));
  scene.add(buildFacadeDetails(data, placed));

  say('Plantando árboles y farolas…'); await frameYield();
  const props = buildProps(data, ground, collision);
  scene.add(props.group);
  const wind = (props.group.userData as { wind: { value: number } }).wind;
  say('Colocando bancos, quioscos y marquesinas…'); await frameYield();
  const carway = new CarwayIndex(data);
  scene.add(buildStreetFurniture(data, specials, ground, collision, carway));
  const sky = new Sky(scene, props.streetLightMat, props.lightPoolMat);
  if (params.has('lluvia')) sky.raining = true;
  // Texturas de resolución contenida: ampliación sin suavizar (píxel visible de cerca)
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const mt of Array.isArray(m) ? m : [m]) {
      for (const k of ['map', 'emissiveMap'] as const) {
        const t = (mt as THREE.MeshStandardMaterial)[k];
        if (t && t.magFilter !== THREE.NearestFilter) { t.magFilter = THREE.NearestFilter; t.needsUpdate = true; }
      }
    }
  });
  // Calzada mojada: más oscura y brillante cuando llueve
  const wetMats: THREE.MeshStandardMaterial[] = [];
  scene.traverse((o) => {
    if ((o.name === 'calzada' || o.name === 'aceras') && (o as THREE.Mesh).material) wetMats.push((o as THREE.Mesh).material as THREE.MeshStandardMaterial);
  });
  const baseRough = wetMats.map((m) => m.roughness);
  const baseCol = wetMats.map((m) => m.color.clone());
  if (params.has('hora')) sky.time = Number(params.get('hora')) % 24;
  sky.speed = 24 / (45 * 60); // un día completo en 45 minutos

  // Límites del mapa
  const B = data.bounds;
  collision.addBox(B.x0 - 50, B.z0 - 50, B.x0, B.z1 + 50, 1e4);
  collision.addBox(B.x1, B.z0 - 50, B.x1 + 50, B.z1 + 50, 1e4);
  collision.addBox(B.x0 - 50, B.z0 - 50, B.x1 + 50, B.z0, 1e4);
  collision.addBox(B.x0 - 50, B.z1, B.x1 + 50, B.z1 + 50, 1e4);

  // ---------- Sistemas ----------
  say('Llamando a los taxistas…'); await frameYield();
  const input = new Input(renderer.domElement);
  const rig = new CameraRig(camera, collision, (x, z, y) => ground.heightAt(x, z, y));
  const carGraph = new RoadGraph(data, 'cars');
  const walkGraph = new RoadGraph(data, 'walk');
  const traffic = new Traffic(carGraph, scene, collision, ground);
  const peds = new Pedestrians(walkGraph, scene, collision, ground);
  const lights = new TrafficLights(data, carGraph, ground, collision, carway);
  scene.add(lights.group);
  traffic.lights = lights;
  peds.lights = lights;
  peds.carway = carway;
  const hud = new Hud(groundRes.minimap);
  const fx = new VehicleEffects();
  scene.add(fx.group);
  Vehicle.fx = fx;
  const audio = new CityAudio();
  // Densidad de arbolado en celdas de 40 m (para pájaros y grillos)
  const treeCells = new Map<string, number>();
  for (let i = 0; i < data.trees.length; i += 2) {
    const k = Math.floor(data.trees[i] / 40) + ',' + Math.floor(data.trees[i + 1] / 40);
    treeCells.set(k, (treeCells.get(k) ?? 0) + 1);
  }
  const greenAt = (x: number, z: number) => {
    let n = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) n += treeCells.get((Math.floor(x / 40) + i) + ',' + (Math.floor(z / 40) + j)) ?? 0;
    return Math.min(1, n / 40);
  };
  let lightsMode: 'auto' | 'on' | 'off' = 'auto';
  const eye = new THREE.Vector3();
  const arms = new FirstPersonArms();
  camera.add(arms.group);
  scene.add(camera);

  // Inicio: Puerta del Sol, junto al Kilómetro Cero
  const km0 = data.pois.find((p) => p.name === 'Kilómetro Cero') ?? { x: 0, z: 0 };
  const player = new Player(scene);
  player.pos.set(km0.x + 3, terrain.heightAt(km0.x + 3, km0.z - 12), km0.z - 12);
  player.heading = Math.PI;
  rig.yaw = Math.PI;

  // Coche del jugador aparcado en la calle con tráfico más cercana a Sol
  const parked: Vehicle[] = [];
  const myCar = new Vehicle(VEHICLE_TYPES.deportivo, 0xb8202a);
  {
    const near = carGraph.nearestEdge(km0.x, km0.z, (e) => e.road.w >= 6 && e.len > 10 && e.road.hw !== 'living_street');
    if (near) {
      const e = near.e;
      const off = e.road.w / 2 - myCar.type.width / 2 - 0.3;
      const p = carGraph.pointOn(e, e.len / 2, off, { x: 0, z: 0 });
      myCar.place(p.x, p.z, Math.atan2(e.dx, e.dz), ground.heightAt(p.x, p.z));
    } else myCar.place(km0.x + 6, km0.z, 0, terrain.heightAt(km0.x + 6, km0.z));
  }
  scene.add(myCar.mesh);
  parked.push(myCar);
  traffic.spawnParked(player.pos, 30, parked);
  let lastCar: Vehicle | null = myCar;

  // ---------- Vecinos con rutina, combate, locales y música ----------
  let kiosk: { x: number; z: number } | null = null, bench: { x: number; z: number } | null = null;
  {
    let bd = 150 * 150;
    for (const sp of specials) {
      if (sp.kind !== 'kiosk') continue;
      const pts = sp.data.pts; let cx = 0, cz = 0;
      for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; cz += pts[i + 1]; }
      cx /= pts.length / 2; cz /= pts.length / 2;
      const d = (cx - km0.x) ** 2 + (cz - km0.z) ** 2;
      if (d < bd) { bd = d; kiosk = { x: cx, z: cz }; }
    }
    bd = 160 * 160;
    const F = data.furniture;
    for (let i = 0; i < F.length; i += 4) {
      if (F[i] !== 'b') continue;
      const x = F[i + 1] as number, z = F[i + 2] as number, d = (x - km0.x) ** 2 + (z - km0.z) ** 2;
      if (d < bd && d > 25 * 25) { bd = d; bench = { x, z }; }
    }
  }
  const routines = new Routines(scene, collision, ground, carway, km0, kiosk, bench);
  routines.onSay = (n, text, loud) => hud.say(n.name, text, n.pos, loud, loud ? 2.5 : 4.5);

  let inside: Interior | null = null;
  const interiors = new Map<string, Interior>();
  const roomLights = [new THREE.PointLight(0xffd9a0, 0, 16, 1.6), new THREE.PointLight(0xffe6c0, 0, 16, 1.6)];
  roomLights.forEach((l) => scene.add(l));
  const interiorTargets = (): Target[] => (inside ? inside.npcs.map((n) => ({
    pos: n.pos, radius: 0.3, height: 1.7, alive: n.alive,
    hit: (_d: number) => { if (!n.alive) return; n.alive = false; n.ch.setAction('none'); n.ch.setProp('none'); },
  })) : []);

  let lastHurt = 99;
  let deadT = 0;
  const damagePlayer = (n: number) => {
    if (deadT > 0) return;
    player.health -= n;
    lastHurt = 0;
    rig.addShake(Math.min(1, n / 30));
    if (player.health <= 0) {
      player.health = 0;
      deadT = 4.5;
      if (player.vehicle) player.exit(collision, ground);
      hud.showDead(true);
      money = Math.round(money * 0.6 * 100) / 100; // la factura del hospital
      police.clear();
    }
  };

  const explode = (v: Vehicle) => {
    if (v.burnt) return;
    v.burn();
    police.crime('explosion', v.pos);
    audio.weapon('explosion', null, v.pos);
    for (let k = 0; k < 40; k++) fx.smoke(v.pos.x + (Math.random() - 0.5) * 3, v.pos.y + Math.random() * 2, v.pos.z + (Math.random() - 0.5) * 3, Math.random() < 0.3 ? 0.1 : 0.95, 2 + Math.random() * 2);
    for (const t of [...peds.targets(), ...routines.targets()]) {
      const d = t.pos.distanceTo(v.pos);
      if (d < 7) t.hit(120 * (1 - d / 7) + 10, (t.pos.x - v.pos.x) / (d || 1), (t.pos.z - v.pos.z) / (d || 1), true, v.pos);
    }
    for (const o of [...parked, ...traffic.cars, ...police.vehicles()]) {
      if (o === v) continue;
      const d = o.pos.distanceTo(v.pos);
      if (d < 8) { o.vel.x += (o.pos.x - v.pos.x) / d * 6; o.vel.y += (o.pos.z - v.pos.z) / d * 6; o.health -= 40 * (1 - d / 8); }
    }
    peds.alarm(v.pos, 70);
    const pd = (player.vehicle === v) ? 0 : player.pos.distanceTo(v.pos);
    if (pd < 7) damagePlayer(70 * (1 - pd / 7) + (player.vehicle === v ? 40 : 0));
    if (player.vehicle === v) player.exit(collision, ground);
    rig.addShake(Math.max(0, 1 - pd / 40));
  };

  const combat: Combat = new Combat(collision, ground, {
    targets: (): Target[] => [...peds.targets(), ...routines.targets(), ...interiorTargets(), ...police.targets()],
    vehicles: (): Vehicle[] => (inside ? [] : [...parked, ...traffic.cars, ...police.vehicles()].filter((c) => c !== player.vehicle)),
    smoke: (x, y, z, d, sz) => fx.smoke(x, y, z, d, sz),
    sound: (k, w, pos) => audio.weapon(k, w, pos),
    alarm: (pos, r) => { if (!inside) peds.alarm(pos, r); },
    explode,
    onReload: (w, dur) => {
      audio.weapon('reload', w.id, player.pos);
      player.ch.reload(dur, w.prop);
      arms.reload(dur, w.id === 'escopeta');
    },
    crime: (kind, pos, t) => {
      if (inside) { if (kind !== 'shot') police.crime('hurt', pos); return; }
      police.crime(kind, pos);
      // quien cae suelta algo de dinero (los agentes, munición)
      if (t && !t.alive && kind === 'kill') {
        const isCop = police.targets().some((o: Target) => o.pos === t.pos);
        pickups.drop(isCop ? 'ammo' : 'money', isCop ? 24 : Math.round((3 + Math.random() * 25) * 100) / 100, t.pos);
      }
    },
  });
  scene.add(combat.group);
  routines.onPoliceShot = (from, to) => {
    combat.npcShot(from, to, 0.04);
    const d = from.distanceTo(to);
    if (Math.random() < THREE.MathUtils.clamp(0.75 - d / 40, 0.12, 0.6)) damagePlayer(player.vehicle ? 5 : 9);
  };
  // ---------- Policía, dinero y objetos ----------
  const police: Police = new Police(data, scene, collision, ground, (a: THREE.Vector3, b: THREE.Vector3): boolean => {
    const d = b.clone().sub(a);
    const len = d.length();
    return combat.traceWorld(a, d.normalize(), len).distanceTo(a) >= len - 0.6;
  });
  police.onShoot = (from, to) => {
    combat.npcShot(from, to, 0.05);
    const d = from.distanceTo(to);
    if (Math.random() < THREE.MathUtils.clamp(0.7 - d / 45, 0.1, 0.55)) damagePlayer(player.vehicle ? 4 : 8);
  };
  police.onSay = (pos, text) => hud.say('Policía', text, pos, true, 2.5);
  peds.onRunOver = (p, v) => {
    if (v !== player.vehicle) return;
    police.crime(p.dead ? 'kill' : 'hurt', p.pos);
    if (p.dead) pickups.drop('money', Math.round((3 + Math.random() * 20) * 100) / 100, p.pos);
  };
  const pickups = new Pickups();
  scene.add(pickups.group);
  let money = 40;
  const pay = (eur: number) => { if (money < eur) return false; money = Math.round((money - eur) * 100) / 100; return true; };
  let music: Music | null = null;
  let soundMode = 0; // 0 todo, 1 sin música, 2 silencio

  // Faros del coche del jugador
  const headlight = new THREE.SpotLight(0xfff1d6, 0, 80, 0.5, 0.55, 1.0);
  headlight.position.set(0, 1.0, 2.0);
  headlight.target.position.set(0, 0, 20);
  let headlightCar: Vehicle | null = null;

  // Nombres de lugares: plazas y parques con nombre, o la calle más cercana
  const named = data.areas.filter((a) => a.name && (a.kind === 'plaza' || a.kind === 'grass' || a.kind === 'wood')).map((a) => {
    let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < a.pts.length; i += 2) {
      xmin = Math.min(xmin, a.pts[i]); xmax = Math.max(xmax, a.pts[i]);
      zmin = Math.min(zmin, a.pts[i + 1]); zmax = Math.max(zmax, a.pts[i + 1]);
    }
    return { a, xmin, xmax, zmin, zmax, area: (xmax - xmin) * (zmax - zmin) };
  }).sort((p, q) => p.area - q.area);
  const placeName = (x: number, z: number): string => {
    for (const n of named) {
      if (x < n.xmin || x > n.xmax || z < n.zmin || z > n.zmax) continue;
      if (pointInRing(x, z, n.a.pts)) return n.a.name!;
    }
    const e = walkGraph.nearestEdgeFast(x, z, (ed) => !!ed.road.name);
    return e?.road.name ?? 'Madrid';
  };

  // ---------- Bucle ----------
  const clock = new THREE.Clock();
  let timeBoost = 1;
  let started = false;
  say('');
  loadingEl.classList.add('hidden');
  const playBtn = document.getElementById('play') as HTMLButtonElement;
  playBtn.disabled = false;
  playBtn.textContent = 'Jugar';
  playBtn.addEventListener('click', () => {
    document.getElementById('start')!.classList.add('hidden');
    started = true;
    input.lock();
    audio.start();
    if (!music && audio.context) { music = new Music(audio.context); music.start(); }
  });

  const nearestEnterable = (): Vehicle | null => {
    let best: Vehicle | null = null;
    let bd = 4.5 * 4.5;
    for (const v of [...parked, ...traffic.cars, ...police.vehicles().filter((c) => c.driver === 'none' || c.speed < 1)]) {
      if (v.burnt) continue;
      const d = v.pos.distanceToSquared(player.pos);
      if (d < bd && Math.abs(v.pos.y - player.pos.y) < 2) { bd = d; best = v; }
    }
    return best;
  };

  const handleInteract = () => {
    if (!input.wasPressed('KeyF') && !input.padPressed(3)) return;
    if (player.vehicle) {
      if (player.vehicle.speed < 6) player.exit(collision, ground);
      return;
    }
    const v = nearestEnterable();
    if (!v) return;
    if (v.type.id === 'policia') police.crime('stealCop', v.pos);
    if (v.driver === 'ai') {
      traffic.release(v);
      parked.push(v);
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      peds.spawnFleeing(v.pos.x + fz * 2, v.pos.z - fx * 2, player.pos);
    }
    player.enter(v);
    lastCar = v;
  };

  // ---------- Interacción (E): hablar, entrar y salir de locales, pedir ----------
  const doorNear = (): ShopDoor | null => {
    let best: ShopDoor | null = null, bd = 2.4 * 2.4;
    for (const d of shopDoors.values()) {
      const dd = (d.x - player.pos.x) ** 2 + (d.z - player.pos.z) ** 2;
      if (dd < bd && Math.abs(d.y - player.pos.y) < 2.5) { bd = dd; best = d; }
    }
    return best;
  };
  let transition = 0;
  const goInside = (door: ShopDoor) => {
    if (transition > 0) return;
    transition = 0.7;
    hud.fade(true);
    setTimeout(() => {
      let room = interiors.get(door.key);
      if (!room) { room = buildInterior(door, data.bounds.x1, data.bounds.z0, collision); interiors.set(door.key, room); scene.add(room.group); }
      inside = room;
      room.group.visible = true;
      player.pos.copy(room.spawn);
      player.floorOverride = INTERIOR_Y;
      player.heading = 0; rig.yaw = 0; rig.pitch = 0.12;
      roomLights.forEach((l, i) => { l.position.copy(room!.lights[i]); l.intensity = 26; });
      audio.setIndoor(1);
      hud.toast(door.name);
      setTimeout(() => hud.fade(false), 120);
    }, 350);
  };
  const goOutside = () => {
    if (!inside || transition > 0) return;
    transition = 0.7;
    const room = inside;
    hud.fade(true);
    setTimeout(() => {
      const d = room.door;
      inside = null;
      room.group.visible = false;
      player.floorOverride = null;
      player.pos.set(d.x + d.nx * 0.8, ground.heightAt(d.x + d.nx * 0.8, d.z + d.nz * 0.8), d.z + d.nz * 0.8);
      player.heading = Math.atan2(d.nx, d.nz); rig.yaw = player.heading;
      roomLights.forEach((l) => { l.intensity = 0; });
      audio.setIndoor(0);
      setTimeout(() => hud.fade(false), 120);
    }, 350);
  };
  type EAction = { text: string; run: () => void } | null;
  const eAction = (): EAction => {
    if (player.vehicle || deadT > 0) return null;
    const armed = !WEAPONS[combat.weapon].melee;
    if (inside) {
      const room = inside;
      if (player.pos.distanceTo(room.exit) < 1.5) return { text: 'Salir a la calle', run: goOutside };
      if (player.pos.distanceTo(room.counter) < 1.8) {
        const staff = room.npcs.find((n) => n.role === 'staff' && n.alive);
        const of = room.offer;
        if (staff) return {
          text: of.price > 0 ? `Pedir ${of.text} (${of.price.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €)` : `Pedir ${of.text}`,
          run: () => {
            if (!pay(of.price)) { hud.say(staff.name, 'Uy, no te llega, majo.', staff.pos); return; }
            hud.say(staff.name, of.replies[Math.floor(Math.random() * of.replies.length)], staff.pos);
            staff.ch.play('stab');
            if (of.heal > 0) player.health = Math.min(100, player.health + of.heal);
            if (of.prop !== 'none') { player.ch.setProp(of.prop); player.ch.setAction('drink'); drinkT = 4; }
            if (room.style === 'estanco' && Math.random() < 0.08) { money += 100; hud.toast('¡Premio! 100 € en el décimo'); }
          },
        };
      }
      let guest: (typeof room.npcs)[number] | null = null, gd = 2.2;
      for (const n of room.npcs) { const d = n.pos.distanceTo(player.pos); if (n.alive && n.role === 'guest' && d < gd) { gd = d; guest = n; } }
      if (guest) {
        const g = guest;
        return { text: 'Hablar', run: () => hud.say(g.name, ['¡Salud!', '¿Otra ronda o qué?', 'Este bar es de los de antes.', 'Mañana curro, pero bueno...', '¡Gol! Ah, no, que era repetición.'][Math.floor(Math.random() * 5)], g.pos) };
      }
      return null;
    }
    const rn = routines.nearest(player.pos, player.heading);
    if (rn && rn.name === 'Lucía' && rn.ch.action === 'guitar' && money >= 1)
      return { text: 'Echar 1 € en la funda de Lucía', run: () => { pay(1); hud.say(rn.name, ['¡Gracias, guapo!', 'Muchas gracias, ¡esta va por ti!', '¡Eres un sol!'][Math.floor(Math.random() * 3)], rn.pos); } };
    if (rn) return { text: `Hablar con ${rn.name}`, run: () => hud.say(rn.name, routines.talk(rn, player.pos, armed && aiming), rn.pos) };
    const pd = peds.nearest(player.pos, player.heading);
    if (pd) return { text: 'Hablar', run: () => { const t = peds.talkTo(pd, player.pos, sky.night > 0.5, armed && aiming, placeName(pd.pos.x + 80, pd.pos.z)); if (t) hud.say('Transeúnte', t, pd.pos); } };
    const door = doorNear();
    if (door) return { text: `Entrar en ${door.name.charAt(0) + door.name.slice(1).toLowerCase()}`, run: () => goInside(door) };
    return null;
  };
  let drinkT = 0;
  let aiming = false;

  const step = (dt: number) => {
    const focus = inside ? new THREE.Vector3(inside.door.x, inside.door.y, inside.door.z) : player.vehicle ? player.vehicle.pos : player.pos;
    if (player.vehicle) {
      const v = player.vehicle;
      const pad = input.pad;
      v.horn = input.isDown('KeyQ') || input.padDown(10) || input.padDown(1);
      v.update(dt, {
        throttle: THREE.MathUtils.clamp(input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) + pad.rt - pad.lt, -1, 1),
        steer: THREE.MathUtils.clamp(input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']) + pad.lx, -1, 1),
        handbrake: input.isDown('Space') || input.padDown(0) || input.padDown(5),
      }, collision, ground);
      player.pos.copy(v.pos);
    } else if (deadT <= 0) {
      player.aiming = aiming;
      player.updateOnFoot(dt, input, rig.yaw, collision, ground);
      // atropellos al jugador
      if (!inside) for (const c of [...parked, ...traffic.cars]) {
        if (c.speed < 6 || Math.abs(c.pos.y - player.pos.y) > 2) continue;
        const cc = c.circles();
        if ([[cc[0], cc[1]], [cc[2], cc[3]]].some(([x, z]) => (player.pos.x - x) ** 2 + (player.pos.z - z) ** 2 < (cc[4] + 0.4) ** 2)) {
          damagePlayer(c.speed * 2.2);
          player.pos.x += c.vel.x * 0.15; player.pos.z += c.vel.y * 0.15;
          c.vel.multiplyScalar(0.9);
          break;
        }
      }
    }
    for (const v of parked) if (v !== player.vehicle && (v.speed > 0.05 || v.airborne)) v.update(dt, { throttle: 0, steer: 0, handbrake: true }, collision, ground);
    const allCars = [...parked, ...traffic.cars, ...police.vehicles().filter((c) => c !== player.vehicle)];
    lights.update(dt);
    traffic.pedPositions = peds.peds.filter((p) => p.mode !== 'down').map((p) => p.pos);
    traffic.update(dt, focus, allCars, player.vehicle ? null : player.pos);
    resolveVehicleCollisions(allCars);
    const threat = player.vehicle && player.vehicle.speed > 8 ? player.vehicle.pos : null;
    peds.update(dt, focus, allCars, threat);
    routines.update(dt, sky.time, inside ? focus : player.pos, combat.sinceShot, !WEAPONS[combat.weapon].melee, deadT > 0);
    if (!inside) police.update(dt, player.pos, player.vehicle, !WEAPONS[combat.weapon].melee, deadT > 0, allCars);
    else police.unseen += dt;
    for (const p of pickups.update(dt, player.vehicle ? new THREE.Vector3(1e9, 0, 0) : player.pos)) {
      if (p.kind === 'money') { money = Math.round((money + p.amount) * 100) / 100; hud.toast(`+${p.amount.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €`); }
      else { combat.reserve[2] += p.amount; hud.toast(`+${p.amount} balas de pistola`); }
    }
    combat.update(dt);
    if (player.vehicle && player.vehicle.lastImpact > 5) rig.addShake(Math.min(1, player.vehicle.lastImpact / 20));
  };

  const manageParked = (focus: THREE.Vector3) => {
    for (let k = parked.length - 1; k >= 0; k--) {
      const v = parked[k];
      if (v === player.vehicle || v === lastCar) continue;
      if (v.pos.distanceTo(focus) > 450) { scene.remove(v.mesh); v.dispose(); parked.splice(k, 1); }
    }
    if (parked.length < 26) traffic.spawnParked(focus, 4, parked);
  };

  let parkedTimer = 0, nameTimer = 0;
  let padRtWas = false;
  const projV = new THREE.Vector3();
  const project = (x: number, y: number, z: number) => {
    projV.set(x, y, z).project(camera);
    return { x: (projV.x * 0.5 + 0.5) * window.innerWidth, y: (-projV.y * 0.5 + 0.5) * window.innerHeight, on: projV.z < 1 && Math.abs(projV.x) < 1.1 && Math.abs(projV.y) < 1.1 };
  };
  let debugCam: { p: THREE.Vector3; t: THREE.Vector3 } | null = null;
  const frame = () => {
    requestAnimationFrame(frame);
    const raw = Math.min(clock.getDelta(), 0.05);
    input.poll();
    if (input.wasPressed('KeyM')) {
      soundMode = (soundMode + 1) % 3;
      if (soundMode === 2) audio.toggleMute();
      if (soundMode === 0) audio.toggleMute();
      if (music) music.enabled = soundMode === 0;
      hud.toast(['Música y sonido', 'Sin música', 'Silencio'][soundMode]);
    }
    if (input.wasPressed('KeyL')) lightsMode = lightsMode === 'auto' ? 'on' : lightsMode === 'on' ? 'off' : 'auto';
    if (player.vehicle && (input.wasPressed('KeyR') || input.padPressed(8))) player.vehicle.reset(ground);
    if (input.wasPressed('KeyH')) hud.toggleHelp();
    if (input.wasPressed('KeyV') || input.padPressed(9)) { rig.firstPerson = !rig.firstPerson; hud.toast(rig.firstPerson ? 'Primera persona' : 'Tercera persona'); }
    if (input.wasPressed('KeyJ')) hud.toast(sky.toggleRain() ? 'Empieza a llover' : 'Deja de llover');
    if (input.wasPressed('KeyP')) hud.toast(`Imagen: ${retro.cycle()}`);
    if (input.wasPressed('KeyN')) timeBoost = timeBoost === 1 ? 20 : timeBoost === 20 ? 120 : 1;
    transition = Math.max(0, transition - raw);
    // ---- armas (a pie)
    const onFoot = !player.vehicle && deadT <= 0 && started;
    if (onFoot) {
      for (let k = 0; k < WEAPONS.length; k++) if (input.wasPressed('Digit' + (k + 1))) combat.select(k) && hud.toast(WEAPONS[k].name);
      if (input.wheel) combat.cycle(input.wheel) && hud.toast(combat.def.name);
      if (input.padPressed(5)) combat.cycle(1) && hud.toast(combat.def.name);
      if (input.padPressed(4)) combat.cycle(-1) && hud.toast(combat.def.name);
      if (input.wasPressed('KeyR') || input.padPressed(2)) combat.reload();
      const w = combat.def;
      aiming = (input.isDown('Mouse2') || input.pad.lt > 0.5) && drinkT <= 0;
      if (drinkT > 0) { drinkT -= raw; if (drinkT <= 0) player.ch.setAction('none'); }
      else {
        player.ch.setProp(w.prop);
        player.ch.setAction(aiming ? w.aim : w.ready);
      }
      player.ch.aimPitch = rig.pitch;
      const trigger = w.auto ? (input.isDown('Mouse0') || input.pad.rt > 0.5) : (input.wasPressed('Mouse0') || (input.pad.rt > 0.5 && !padRtWas));
      padRtWas = input.pad.rt > 0.5;
      if (trigger && drinkT <= 0) {
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const vmMuzzle = rig.firstPerson && arms.armed ? arms.muzzleWorld(new THREE.Vector3()) : undefined;
        if (combat.attack(player.ch, player.pos, player.heading, camera.position, dir, aiming || rig.firstPerson, vmMuzzle)) {
          if (!w.melee) { rig.pitch -= w.id === 'escopeta' ? 0.04 : 0.012; arms.recoil(w.id === 'escopeta' ? 1.4 : 0.6); }
        }
      }
      // apuntar a alguien con un arma: manos arriba
      if (aiming && !w.melee) {
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        for (const p of peds.peds) {
          const to = p.pos.clone().setY(p.pos.y + 1.2).sub(camera.position);
          const d = to.length();
          if (d < 25 && to.normalize().dot(dir) > 0.985) peds.surrender(p, player.pos);
        }
      }
    } else { aiming = false; padRtWas = false; }
    // ---- muerte y vuelta al hospital
    if (deadT > 0) {
      deadT -= raw;
      player.ch.setDown(Math.min(1, (4.5 - deadT) * 3));
      if (deadT <= 0) {
        hud.showDead(false);
        player.ch.reset();
        player.health = 100;
        if (inside) { inside.group.visible = false; inside = null; player.floorOverride = null; roomLights.forEach((l) => { l.intensity = 0; }); audio.setIndoor(0); }
        player.pos.set(km0.x - 6, ground.heightAt(km0.x - 6, km0.z - 20), km0.z - 20);
        hud.toast('Hospital · te han dado el alta');
      }
    } else if (lastHurt > 8 && player.health < 100) player.health = Math.min(100, player.health + raw * 2);
    lastHurt += raw;
    if (started && deadT <= 0) {
      const ea = eAction();
      if (ea && (input.wasPressed('KeyE') || input.padPressed(1) && !player.vehicle)) ea.run();
    }
    if (started) {
      handleInteract();
      const sub = raw > 1 / 50 ? 2 : 1;
      for (let k = 0; k < sub; k++) step(raw / sub);
    }
    const v = player.vehicle;
    const focus = v ? v.pos : player.pos;
    const wfocus = inside ? new THREE.Vector3(inside.door.x, inside.door.y, inside.door.z) : focus;
    if (v) v.eyeWorld(eye); else eye.set(player.pos.x, player.pos.y + 1.62, player.pos.z);
    rig.update(raw, input.mouseDX, input.mouseDY, focus, {
      inCar: !!v, carHeading: v ? v.heading : 0, speed: v ? Math.max(0, v.forwardSpeed()) : 0,
      lookBack: input.isDown('KeyC') || input.padDown(11), padX: input.pad.rx, padY: input.pad.ry,
      eye, walkSpeed: player.grounded ? player.footSpeed : 0, aiming: aiming && !player.vehicle,
    });
    const fp = rig.firstPerson;
    player.ch.root.visible = !(fp && !v);
    if (v) v.hideDriver = fp;
    if (lastCar && lastCar !== v) lastCar.hideDriver = false;
    hud.setCrosshair(fp && !v, aiming && !WEAPONS[combat.weapon].melee);
    hud.setHitmark(combat.hitMarker > 0);
    hud.setHealth(player.health);
    hud.setWanted(police.stars, police.unseen < 1);
    hud.setMoney(money);
    {
      let sp: THREE.Vector3 | null = null, sd = 220;
      if (!inside) for (const c of police.vehicles()) if (c.siren) { const d = c.pos.distanceTo(focus); if (d < sd) { sd = d; sp = c.pos; } }
      audio.siren(sp);
    }
    {
      const w = combat.def;
      hud.setWeapon(w.name, w.melee ? null : combat.ammo[combat.weapon], combat.reserve[combat.weapon], combat.reloading > 0, !v && (combat.weapon > 0 || aiming));
    }
    arms.setWeapon(v ? 'none' : combat.def.prop, aiming);
    arms.update(raw, fp ? (v ? "car" : "foot") : "off", player.grounded ? player.footSpeed : 0, v ? v.steerAngle / 0.6 : 0, input.mouseDX, input.mouseDY);
    const near = fp ? 0.08 : 0.3;
    if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
    vehicleUniforms.night.value = sky.night;
    vehicleUniforms.time.value += raw;
    if (inside) {
      updateInterior(inside, raw);
      const k = Math.floor(performance.now() / 220) % 3;
      inside.flicker.forEach((m, i) => m.color.setHSL(((k + i) * 0.13) % 1, 0.8, 0.55));
    }
    sky.indoor = !!inside;
    if (music) {
      const indoorBar = inside?.kind === 'bar';
      music.setLevel(indoorBar ? 0.3 : inside ? 0.16 : v ? 0.24 : 0.1 + sky.night * 0.04);
      const bd = inside ? Infinity : routines.buskerDistance(player.pos);
      music.busk = soundMode === 2 ? 0 : THREE.MathUtils.clamp(1 - bd / 30, 0, 1);
    }
    fx.update(raw);
    if (v) v.headlights = lightsMode === 'auto' ? sky.night > 0.3 : lightsMode === 'on';
    if (started) {
      let pc = 0;
      for (const pd of peds.peds) if (pd.pos.distanceToSquared(focus) < 1600) pc++;
      audio.update(raw, {
        camera, playerCar: v, playerPos: focus, footSpeed: player.footSpeed, grounded: player.grounded,
        cars: [...traffic.cars, ...parked], pedCount: pc, night: sky.night, hour: sky.time, green: greenAt(focus.x, focus.z),
        beep: v ? null : lights.crossingBeep(focus.x, focus.z), solDist: Math.hypot(focus.x - km0.x, focus.z - km0.z), rain: sky.rain,
      });
    }
    sky.update(raw * timeBoost, focus, raw, camera.position);
    wetMats.forEach((m, i) => {
      m.roughness = THREE.MathUtils.lerp(baseRough[i], 0.32, sky.wet);
      m.color.copy(baseCol[i]).multiplyScalar(1 - sky.wet * 0.38);
    });
    hud.setWeather(sky.rain > 0.5 ? 'Lluvia' : sky.wet > 0.3 ? 'Calles mojadas' : sky.night > 0.6 ? 'Noche' : sky.night > 0.15 ? 'Atardecer' : 'Nublado');
    wind.value += raw;
    facadeDetail.update(wfocus.x, wfocus.z);
    setShopNight(sky.night);
    if (debugCam) { camera.position.copy(debugCam.p); camera.lookAt(debugCam.t); }
    if (v !== headlightCar) {
      headlightCar?.mesh.remove(headlight, headlight.target);
      v?.mesh.add(headlight, headlight.target);
      headlightCar = v;
    }
    headlight.intensity = v && v.headlights ? Math.max(0.35, sky.night) * 600 : 0;
    if (v) hud.setCar({ name: v.type.name, gear: v.gear, rpm: v.rpm / v.type.mech.redline, health: v.health });

    parkedTimer += raw;
    if (parkedTimer > 2) { parkedTimer = 0; manageParked(wfocus); }
    nameTimer -= raw;
    if (nameTimer <= 0) {
      nameTimer = 0.5;
      if (inside) hud.setZone(inside.door.name, placeName(wfocus.x, wfocus.z));
      else hud.setZone(placeName(focus.x, focus.z), `Madrid · ${Math.round(terrain.altitude(focus.x, focus.z))} m`);
    }
    hud.update(raw, sky.clock() + (timeBoost > 1 ? ` x${timeBoost}` : ''), v ? v.speed * 3.6 : null);
    if (!v && started && deadT <= 0) {
      const ea = eAction();
      const near = inside ? null : nearestEnterable();
      if (ea) hud.setHint('E', ea.text);
      else if (near) hud.setHint('F', near.driver === 'ai' ? `Robar ${near.type.name.toLowerCase()}` : `Subir al ${near.type.name.toLowerCase()}`);
      else hud.setHint(null);
    } else hud.setHint(null);
    // nombres de los vecinos con rutina y bocadillos
    const tags = routines.npcs.filter((n) => n.visible && n.alive && n.pos.distanceTo(player.pos) < 14)
      .map((n) => ({ key: n.name, text: `${n.name} <i>· ${n.role}</i>`, x: n.pos.x, y: n.pos.y, z: n.pos.z }));
    hud.placeOverlays(raw, project, tags);
    const blips = lastCar && lastCar !== v ? [{ x: lastCar.pos.x, z: lastCar.pos.z, color: '#d4c29a', size: 4 }] : [];
    for (const n of routines.npcs) if (n.visible && n.alive) blips.push({ x: n.pos.x, z: n.pos.z, color: n.blip, size: 2.5 });
    for (const c of police.vehicles()) blips.push({ x: c.pos.x, z: c.pos.z, color: Math.floor(performance.now() / 250) % 2 ? '#2a6bff' : '#e9e6df', size: 3.5 });
    for (const d of shopDoors.values()) if (Math.abs(d.x - wfocus.x) + Math.abs(d.z - wfocus.z) < 160) blips.push({ x: d.x, z: d.z, color: d.kind === 'bar' ? '#b75b32' : '#5f8fd8', size: 1.8 });
    hud.drawMinimap(wfocus.x, wfocus.z, rig.yaw, v ? v.heading : player.heading, blips);
    hud.drawCompass(rig.yaw, focus.x, focus.z, lastCar && lastCar !== v ? [{ x: lastCar.pos.x, z: lastCar.pos.z, color: '#d4c29a' }] : []);

    retro.render(scene, camera, raw, sky.night);
    input.endFrame();
  };
  frame();

  // Depuración en consola
  (window as unknown as { __madriz: unknown }).__madriz = {
    player, sky, traffic, peds, scene, renderer, camera, rig, retro, hud, combat, police, pickups, getMoney: () => money, routines, interiors, shopDoors, goInside, goOutside, getInside: () => inside, music: () => music, eAction, myCar, terrain, ground, data, collision, THREE, facades, lights, Vehicle, VEHICLE_TYPES, fx, audio, parked,
    start: () => { document.getElementById('start')!.classList.add('hidden'); started = true; },
    /** Teletransporte a coordenadas del mapa (metros desde el Km 0). */
    tp: (x: number, z: number) => {
      const y = ground.heightAt(x, z);
      if (player.vehicle) player.vehicle.place(x, z, player.vehicle.heading, y);
      player.pos.set(x, y, z);
    },
    sim: (sec: number) => { for (let k = 0; k < sec * 60; k++) step(1 / 60); },
    cam: (p: number[] | null, t?: number[]) => {
      debugCam = p && t ? { p: new THREE.Vector3(...p), t: new THREE.Vector3(...t) } : null;
    },
  };
}

main().catch((err) => {
  console.error(err);
  say('Error cargando el mapa: ' + (err as Error).message);
});
