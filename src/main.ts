import * as THREE from 'three';
import { setShopNight } from './world/shopfronts';
import { TrafficLights } from './systems/trafficLights';
import { makeGreenAt, makePlaceNamer } from './world/places';
import { shielded } from './systems/cover';
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
import { Missions, type MissionCtx } from './systems/missions';
import { Shops } from './systems/shops';
import { Navigation, fmtDist, fmtEta } from './systems/navigation';
import { WorldMap } from './ui/worldMap';
import { bridgeLog } from './world/urban';
import type { Landmark } from './world/landmarks';
import { buildWorld } from './world/buildWorld';
import type { MapIcon } from './ui/mapIcons';
import { loadGame, saveGame, deleteGame, loadSettings, saveSettings, describeSaveTime, describePlayed, type SaveData } from './systems/save';
import { RETRO_PRESETS } from './render/retroPost';
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
  const {
    data, terrain, ground, collision, groundRes, landmarks, landmarkCars, specials, facades, facadeDetail, water,
    wind, carway, sky, wetMats, baseRough, baseCol, drawDist,
  } = await buildWorld(scene, ZONE, params, say, frameYield);

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

  let lodT = 0;
  let lmInside: Landmark | null = null;
  let liftRide = false;
  // contar las dos pasadas (escena + sombra) y el posproceso de cada imagen juntos
  renderer.info.autoReset = false;
  let fpsN = 0, fpsT = 0, fpsLast = 0;
  const fpsEl = document.getElementById('fps')!;
  drawDist.add(lights.group, 'props');
  traffic.lights = lights;
  peds.lights = lights;
  peds.carway = carway;
  const hud = new Hud(groundRes.minimap);
  const fx = new VehicleEffects();
  scene.add(fx.group);
  Vehicle.fx = fx;
  const audio = new CityAudio();
  // densidad de arbolado alrededor (para pájaros y grillos)
  const greenAt = makeGreenAt(data.trees);
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
  parked.push(...landmarkCars);
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
  // un coche que arde con el motor a cero acaba reventando
  Vehicle.onExplode = explode;
  /** Sólido para las coberturas: muros y cajas del mundo, y la carrocería de los coches (hasta 1,3 m). */
  const solidAt = (x: number, y: number, z: number) => {
    if (collision.pointBlocked(x, y, z)) return true;
    for (const v of [...parked, ...traffic.cars, ...police.vehicles()]) {
      if (v === player.vehicle || Math.abs(v.pos.x - x) > 4 || Math.abs(v.pos.z - z) > 4) continue;
      if (y < v.pos.y || y > v.pos.y + (v.type.id === 'autobus' ? 2.8 : 1.3)) continue;
      // caja orientada del coche (los dos círculos de las colisiones dejan un hueco en el centro)
      const dx = x - v.pos.x, dz = z - v.pos.z, c = Math.cos(v.heading), sn = Math.sin(v.heading);
      if (Math.abs(dx * c - dz * sn) < v.type.width / 2 && Math.abs(dx * sn + dz * c) < v.type.length / 2) return true;
    }
    return false;
  };

  const combat: Combat = new Combat(collision, ground, {
    targets: (): Target[] => [...peds.targets(), ...routines.targets(), ...interiorTargets(), ...police.targets(), ...(inside ? [] : missions.targets())],
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
  /** ¿Se ve b desde a? (rayo contra el escenario) */
  const lineOfSight = (a: THREE.Vector3, b: THREE.Vector3): boolean => {
    const d = b.clone().sub(a);
    const len = d.length();
    return combat.traceWorld(a, d.normalize(), len).distanceTo(a) >= len - 0.6;
  };
  const police: Police = new Police(data, scene, collision, ground, (a: THREE.Vector3, b: THREE.Vector3): boolean => {
    return lineOfSight(a, b);
  });
  police.onShoot = (from, to, heavy) => {
    combat.npcShot(from, to, 0.05);
    const d = from.distanceTo(to);
    if (Math.random() >= THREE.MathUtils.clamp(0.7 - d / 45, 0.1, 0.55)) return;
    const car = player.vehicle;
    if (!car) {
      // a cubierto y sin asomarte, casi todo se lo come la cobertura
      if (player.cover && shielded(player.cover, !player.aiming, from.x, from.z) && Math.random() < 0.85) {
        fx.smoke(player.cover.x, player.pos.y + 1.0, player.cover.z, 0.05, 0.3);
        return;
      }
      damagePlayer(heavy ? 11 : 8);
      return;
    }
    // en coche, la carrocería se lleva casi todo: chapa, cristales y, con suerte para ellos, una rueda
    const dir = to.clone().sub(from).normalize();
    const hw = car.type.width / 2, hl = car.type.length / 2;
    const p = car.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * hw * 2, 0.25 + Math.random() * 1.1, (Math.random() - 0.5) * hl * 2)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), car.heading)).addScaledVector(dir, -0.6);
    car.bulletHit(p, dir);
    car.health -= 2.5;
    if (Math.random() < 0.35) damagePlayer(4);
  };
  police.onSay = (pos, text) => hud.say('Policía', text, pos, true, 2.5);
  // helicóptero derribado: revienta donde cae
  police.onHeliDown = (pos) => {
    audio.weapon('explosion', null, pos);
    for (let k = 0; k < 60; k++) fx.smoke(pos.x + (Math.random() - 0.5) * 6, pos.y + Math.random() * 3, pos.z + (Math.random() - 0.5) * 6, Math.random() < 0.3 ? -1 : 0.95, 2 + Math.random() * 3);
    for (const t of [...peds.targets(), ...routines.targets()]) {
      const d = t.pos.distanceTo(pos);
      if (d < 10) t.hit(150 * (1 - d / 10) + 10, (t.pos.x - pos.x) / (d || 1), (t.pos.z - pos.z) / (d || 1), true, pos);
    }
    const pd = (player.vehicle ?? player).pos.distanceTo(pos);
    if (pd < 10) damagePlayer(80 * (1 - pd / 10));
    rig.addShake(Math.max(0, 1 - pd / 60));
    peds.alarm(pos, 90);
    hud.toast('¡Helicóptero derribado!');
  };
  peds.onRunOver = (p, v) => {
    if (v !== player.vehicle) return;
    police.crime(p.dead ? 'kill' : 'hurt', p.pos);
    if (p.dead) pickups.drop('money', Math.round((3 + Math.random() * 20) * 100) / 100, p.pos);
  };
  const pickups = new Pickups();
  scene.add(pickups.group);
  let money = 40;
  const pay = (eur: number) => { if (money < eur) return false; money = Math.round((money - eur) * 100) / 100; return true; };
  // ---------- Misiones y tiendas ----------
  const missionCtx: MissionCtx = {
    scene, world: collision, ground, player, police, hud,
    addMoney: (eur) => { money = Math.round((money + eur) * 100) / 100; },
    snapCar: (x, z) => {
      const n = carGraph.nearestEdge(x, z, (e) => e.road.w >= 5 && e.len > 6);
      if (!n) return new THREE.Vector3(x, ground.heightAt(x, z), z);
      const p = carGraph.pointOn(n.e, n.t * n.e.len, 0, { x: 0, z: 0 });
      return new THREE.Vector3(p.x, ground.heightAt(p.x, p.z), p.z);
    },
    snapWalk: (x, z) => {
      const n = walkGraph.nearestEdge(x, z);
      if (!n) return new THREE.Vector3(x, ground.heightAt(x, z), z);
      const p = walkGraph.pointOn(n.e, n.t * n.e.len, n.e.road.car ? walkGraph.laneOffset(n.e) : 0, { x: 0, z: 0 });
      return new THREE.Vector3(p.x, ground.heightAt(p.x, p.z), p.z);
    },
    parkCar: (type, color, x, z) => {
      const v = new Vehicle(VEHICLE_TYPES[type], color);
      const n = carGraph.nearestEdge(x, z, (e) => e.road.w >= 6 && e.len > 10);
      if (n) {
        const off = n.e.road.w / 2 - v.type.width / 2 - 0.3;
        const p = carGraph.pointOn(n.e, THREE.MathUtils.clamp(n.t * n.e.len, 5, n.e.len - 5), off, { x: 0, z: 0 });
        v.place(p.x, p.z, Math.atan2(n.e.dx, n.e.dz), ground.heightAt(p.x, p.z));
      } else v.place(x, z, 0, ground.heightAt(x, z));
      // quitar cualquier aparcado que esté justo ahí
      for (let k = parked.length - 1; k >= 0; k--) {
        const o = parked[k];
        if (o !== player.vehicle && o !== lastCar && o.pos.distanceTo(v.pos) < 6) { scene.remove(o.mesh); o.dispose(); parked.splice(k, 1); }
      }
      scene.add(v.mesh);
      parked.push(v);
      return v;
    },
    removeCar: (v) => {
      const i = parked.indexOf(v);
      if (i >= 0) parked.splice(i, 1);
      if (lastCar === v) lastCar = null;
      scene.remove(v.mesh);
      v.dispose();
    },
    exitVehicle: () => { if (player.vehicle) player.exit(collision, ground); },
    alarm: (pos, r) => peds.alarm(pos, r),
    los: (a, b) => lineOfSight(a, b),
    shootAtPlayer: (from, heavy) => {
      const to = (player.vehicle ? player.vehicle.pos : player.pos).clone();
      to.y += 1.1;
      police.onShoot?.(from, to, heavy);
    },
    landmark: (name) => landmarks.find((l) => l.name === name) ?? null,
  };
  const missions = new Missions(missionCtx);
  const shops = new Shops(missionCtx, combat, { get: () => money, pay: (eur) => pay(eur) });
  // ---------- GPS y mapa completo ----------
  const nav = new Navigation(carGraph, walkGraph);
  const worldMap = new WorldMap(data, hud.mapImage, {
    setWaypoint: (x, z) => nav.setWaypoint(x, z),
    clearWaypoint: () => nav.clearWaypoint(),
    waypoint: () => nav.waypoint,
    placeName: (x, z) => placeName(x, z),
  });
  let mapOpen = false;
  const cap = (t: string) => t.charAt(0) + t.slice(1).toLowerCase();
  /** Iconos del mapa. `nearX/Z` y `r`: solo bares y tiendas cercanos (minimapa). */
  const mapIcons = (nearX: number, nearZ: number, r: number): MapIcon[] => {
    const out: MapIcon[] = [];
    // un icono por local (cada fachada registra su puerta) y, en el minimapa, solo los más cercanos
    const seen = new Set<string>();
    const shopsNear: (MapIcon & { d: number })[] = [];
    for (const d of shopDoors.values()) {
      const dist = Math.hypot(d.x - nearX, d.z - nearZ);
      if (dist > r) continue;
      const key = `${d.kind}${d.name}${Math.round(d.x / 30)},${Math.round(d.z / 30)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      shopsNear.push({ x: d.x, z: d.z, kind: d.kind === 'bar' ? 'bar' : 'tienda', label: cap(d.name), d: dist });
    }
    shopsNear.sort((p, q) => p.d - q.d);
    if (r < 1e6) {
      // minimapa: los 8 más cercanos, separados entre sí
      const pick: MapIcon[] = [];
      for (const ic of shopsNear) {
        if (pick.length >= 8) break;
        if (pick.some((o) => Math.hypot(o.x - ic.x, o.z - ic.z) < 14)) continue;
        pick.push(ic);
      }
      out.push(...pick);
    } else out.push(...shopsNear);
    for (const n of routines.npcs) if (n.visible && n.alive) out.push({ x: n.pos.x, z: n.pos.z, kind: 'npc', color: n.blip, label: `${n.name} · ${n.role}` });
    for (const c of police.vehicles()) out.push({ x: c.pos.x, z: c.pos.z, kind: 'police', label: 'Policía Municipal' });
    if (lastCar && lastCar !== player.vehicle) out.push({ x: lastCar.pos.x, z: lastCar.pos.z, kind: 'car', label: `Tu coche · ${lastCar.type.name}` });
    out.push(...missions.icons(), ...shops.icons());
    if (nav.waypoint && !missions.currentTarget) out.push({ x: nav.waypoint.x, z: nav.waypoint.z, kind: 'waypoint', label: `Destino · ${placeName(nav.waypoint.x, nav.waypoint.z)}` });
    return out;
  };
  const routeText = () => {
    const r = nav.route;
    if (!r) return null;
    const to = missions.currentTarget ? 'Objetivo de la misión' : nav.waypoint ? placeName(nav.waypoint.x, nav.waypoint.z) : '';
    return { short: `${fmtDist(r.length)} · ${fmtEta(r.eta)}`, long: `${to} · ${fmtDist(r.length)} · ${fmtEta(r.eta)} ${r.car ? 'en coche' : 'a pie'}` };
  };
  const toggleMap = (on: boolean) => {
    if (on === mapOpen || !started || paused) return;
    mapOpen = on;
    const f = player.vehicle ? player.vehicle.pos : player.pos;
    worldMap.show(on, inside ? inside.door.x : f.x, inside ? inside.door.z : f.z);
    $('hud').style.visibility = on ? 'hidden' : '';
    audio.setPaused(on);
    if (on) document.exitPointerLock?.();
    else { clock.getDelta(); input.lock(); }
  };
  let music: Music | null = null;
  let soundMode = 0; // 0 todo, 1 sin música, 2 silencio

  // Faros del coche del jugador
  const headlight = new THREE.SpotLight(0xfff1d6, 0, 80, 0.5, 0.55, 1.0);
  headlight.position.set(0, 1.0, 2.0);
  headlight.target.position.set(0, 0, 20);
  let headlightCar: Vehicle | null = null;

  // nombres de lugares: plazas y parques con nombre, o la calle más cercana
  const placeName = makePlaceNamer(data.areas, (x, z) => walkGraph.nearestEdgeFast(x, z, (ed) => !!ed.road.name)?.road.name);

  // ---------- Bucle ----------
  const clock = new THREE.Clock();
  let timeBoost = 1;
  let started = false;
  say('');
  loadingEl.classList.add('hidden');
  const playBtn = document.getElementById('play') as HTMLButtonElement;
  playBtn.disabled = false;
  playBtn.textContent = 'Jugar';
  // ---------- Opciones, partida guardada y pausa ----------
  const settings = loadSettings();
  const applySettings = () => {
    audio.setVolume(settings.volume);
    rig.sens = settings.sens;
    rig.invertY = settings.invertY;
    if (retro.preset !== settings.image) retro.setPreset(settings.image);
    drawDist.scale = [0.6, 1, 1.6][settings.draw] ?? 1;
    sky.sun.castShadow = settings.shadows;
    document.getElementById('fps')!.classList.toggle('hidden', !settings.fps);
    drawDist.update(0, camera.position, (scene.fog as THREE.Fog).far, true);
    if (music) music.enabled = settings.music && soundMode === 0;
    saveSettings(settings);
  };
  applySettings();
  let played = 0;
  let paused = false;
  let autosaveT = 0;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

  /** Salir del local sin fundido (al cargar partida). */
  const leaveInteriorNow = () => {
    if (!inside) return;
    inside.group.visible = false;
    inside = null;
    player.floorOverride = null;
    roomLights.forEach((l) => { l.intensity = 0; });
    audio.setIndoor(0);
  };
  /** Motivo por el que no se puede guardar ahora, o null si se puede. */
  const cantSave = (): string | null => {
    if (!started) return 'La partida no ha empezado';
    if (deadT > 0) return 'No se puede guardar estando KO';
    if (police.stars > 0) return 'No se puede guardar con la policía detrás';
    if (transition > 0) return 'Espera un momento';
    if (missions.busy) return 'Termina antes la misión';
    return null;
  };
  const gather = (): SaveData => {
    // dentro de un local se guarda en la puerta, por fuera
    let p = player.pos.clone();
    if (inside) { const d = inside.door; p.set(d.x + d.nx * 0.8, d.y, d.z + d.nz * 0.8); }
    else if (player.vehicle) p = player.vehicle.pos.clone();
    return {
      v: 1, at: Date.now(), pos: [p.x, p.y, p.z], heading: player.vehicle ? player.vehicle.heading : player.heading,
      health: player.health, money, weapon: combat.weapon, ammo: [...combat.ammo], reserve: [...combat.reserve],
      time: sky.time, raining: sky.raining, played, progress: { missions: missions.serialize() }, owned: [...combat.owned],
    };
  };
  const doSave = (auto: boolean): string => {
    const why = cantSave();
    if (why) return why;
    if (!saveGame(gather())) return 'No se ha podido guardar (el navegador no deja usar el almacenamiento)';
    autosaveT = 0;
    if (!auto) hud.toast('Partida guardada');
    return 'Partida guardada';
  };
  const applySave = (d: SaveData) => {
    leaveInteriorNow();
    if (player.vehicle) player.exit(collision, ground);
    const [x, , z] = d.pos;
    player.pos.set(x, ground.heightAt(x, z, d.pos[1] + 1), z);
    player.heading = d.heading; rig.yaw = d.heading; rig.pitch = 0.12;
    player.health = THREE.MathUtils.clamp(d.health, 20, 100);
    money = d.money;
    d.ammo.forEach((n, i) => { if (i < combat.ammo.length) combat.ammo[i] = n; });
    d.reserve.forEach((n, i) => { if (i < combat.reserve.length) combat.reserve[i] = n; });
    // partidas de antes de la armería: se conservan todas las armas
    (d.owned ?? WEAPONS.map(() => true)).forEach((o, i) => { if (i < combat.owned.length) combat.owned[i] = o; });
    combat.select(Math.min(d.weapon, WEAPONS.length - 1));
    missions.restore((d.progress as { missions?: unknown })?.missions);
    sky.time = d.time;
    if (sky.raining !== d.raining) sky.toggleRain();
    played = d.played;
    police.clear();
    deadT = 0;
    hud.showDead(false);
  };

  const startGame = (save: SaveData | null) => {
    document.getElementById('start')!.classList.add('hidden');
    if (save) applySave(save);
    started = true;
    input.lock();
    audio.start();
    if (!music && audio.context) { music = new Music(audio.context); music.start(); }
    applySettings();
  };
  const startSave = loadGame();
  if (startSave) {
    playBtn.textContent = 'Continuar';
    $('newgame').classList.remove('hidden');
    const info = $('save-info');
    info.textContent = `Partida guardada ${describeSaveTime(startSave.at)} · ${describePlayed(startSave.played)} jugados · ${startSave.money.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €`;
    info.classList.remove('hidden');
  }
  playBtn.addEventListener('click', () => startGame(startSave));
  $('newgame').addEventListener('click', () => startGame(null));

  // menú de pausa
  const pauseEl = $('pause');
  const pauseMsg = $('pause-msg');
  let confirmNew = false;
  const refreshPause = () => {
    const sv = loadGame();
    $('pause-stats').innerHTML =
      `${describePlayed(played)} jugados · ${money.toLocaleString('es-ES', { minimumFractionDigits: 2 })} € · ${String(Math.floor(sky.time)).padStart(2, '0')}:${String(Math.floor((sky.time % 1) * 60)).padStart(2, '0')}<br>` +
      (sv ? `Último guardado: ${describeSaveTime(sv.at)}` : 'Sin partida guardada');
    ($('p-load') as HTMLButtonElement).disabled = !sv;
    ($('p-save') as HTMLButtonElement).disabled = !!cantSave();
    ($('p-save') as HTMLButtonElement).title = cantSave() ?? '';
    $('p-new').textContent = 'Nueva partida';
    confirmNew = false;
    ($('o-volume') as HTMLInputElement).value = String(Math.round(settings.volume * 100));
    $('o-volume-v').textContent = String(Math.round(settings.volume * 100));
    ($('o-sens') as HTMLInputElement).value = String(Math.round(settings.sens * 100));
    $('o-sens-v').textContent = settings.sens.toFixed(1);
    ($('o-invert') as HTMLInputElement).checked = settings.invertY;
    ($('o-music') as HTMLInputElement).checked = settings.music;
    ($('o-image') as HTMLSelectElement).value = String(retro.preset);
    ($('o-draw') as HTMLSelectElement).value = String(settings.draw);
    ($('o-shadows') as HTMLInputElement).checked = settings.shadows;
    ($('o-fps') as HTMLInputElement).checked = settings.fps;
  };
  ($('o-image') as HTMLSelectElement).innerHTML = RETRO_PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
  const openPause = () => {
    if (!started || paused || mapOpen) return;
    paused = true;
    audio.setPaused(true);
    // al pausar se guarda solo, si se puede
    pauseMsg.textContent = cantSave() ? '' : (doSave(true), 'Guardado automático');
    refreshPause();
    pauseEl.classList.remove('hidden');
    $('hud').style.visibility = 'hidden';
  };
  const resume = () => {
    if (!paused) return;
    paused = false;
    pauseEl.classList.add('hidden');
    $('hud').style.visibility = '';
    audio.setPaused(false);
    clock.getDelta();
    input.lock();
  };
  input.onUnlock = openPause;
  $('p-resume').addEventListener('click', resume);
  $('p-save').addEventListener('click', () => { pauseMsg.textContent = doSave(false); refreshPause(); });
  $('p-load').addEventListener('click', () => { const sv = loadGame(); if (sv) { applySave(sv); hud.toast('Partida cargada'); resume(); } });
  $('p-new').addEventListener('click', () => {
    if (!confirmNew) { confirmNew = true; $('p-new').textContent = '¿Seguro? Se borra lo guardado'; return; }
    deleteGame();
    location.reload();
  });
  $('o-volume').addEventListener('input', (e) => { settings.volume = +(e.target as HTMLInputElement).value / 100; $('o-volume-v').textContent = (e.target as HTMLInputElement).value; applySettings(); });
  $('o-sens').addEventListener('input', (e) => { settings.sens = +(e.target as HTMLInputElement).value / 100; $('o-sens-v').textContent = settings.sens.toFixed(1); applySettings(); });
  $('o-invert').addEventListener('change', (e) => { settings.invertY = (e.target as HTMLInputElement).checked; applySettings(); });
  $('o-music').addEventListener('change', (e) => { settings.music = (e.target as HTMLInputElement).checked; applySettings(); });
  $('o-draw').addEventListener('change', (e) => { settings.draw = +(e.target as HTMLSelectElement).value; applySettings(); });
  $('o-fps').addEventListener('change', (e) => { settings.fps = (e.target as HTMLInputElement).checked; applySettings(); });
  $('o-shadows').addEventListener('change', (e) => { settings.shadows = (e.target as HTMLInputElement).checked; applySettings(); });
  $('o-image').addEventListener('change', (e) => { settings.image = +(e.target as HTMLSelectElement).value; applySettings(); });
  window.addEventListener('beforeunload', () => { if (started && !cantSave()) saveGame(gather()); });

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
    if (deadT > 0 || shops.open) return null;
    if (!inside) { const a = missions.action() ?? shops.action(); if (a) return a; }
    if (player.vehicle) return null;
    // edificios con interior: ascensores y gente con la que hablar o a la que pedir
    for (const lm of landmarks) {
      const la = lm.action?.(player.pos);
      if (la) return la;
      const n = lm.npcNear(player.pos);
      if (!n) continue;
      const bubble = n.pos.clone().setY(n.pos.y);
      if (n.offer) {
        const of = n.offer;
        return {
          text: `Pedir ${of.text} (${of.price.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €)`,
          run: () => {
            n.face(player.pos);
            if (!pay(of.price)) { hud.say(n.name, 'Uy, no te llega. Otro día.', bubble); return; }
            hud.say(n.name, of.reply[Math.floor(Math.random() * of.reply.length)], bubble);
            player.health = Math.min(100, player.health + of.heal);
            player.ch.setProp('coffee'); player.ch.setAction('drink'); drinkT = 4;
          },
        };
      }
      return { text: `Hablar con ${n.name}`, run: () => { n.face(player.pos); hud.say(n.name, n.line(), bubble); } };
    }
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
    } else if (deadT <= 0 && !shops.open) {
      player.aiming = aiming;
      player.updateOnFoot(dt, input, rig.yaw, collision, ground, solidAt);
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
    // los aparcados solo se simulan si se mueven, o si arden (para que acaben reventando)
    for (const v of parked) if (v !== player.vehicle && (v.speed > 0.05 || v.airborne || (v.health <= 0 && !v.burnt))) v.update(dt, { throttle: 0, steer: 0, handbrake: true }, collision, ground);
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
    if (started) missions.update(dt, deadT > 0);
    if (player.vehicle && player.vehicle.lastImpact > 5) rig.addShake(Math.min(1, player.vehicle.lastImpact / 20));
  };

  const manageParked = (focus: THREE.Vector3) => {
    for (let k = parked.length - 1; k >= 0; k--) {
      const v = parked[k];
      if (v === player.vehicle || v === lastCar || missions.owns(v)) continue;
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
    renderer.info.reset();
    input.poll();
    // Start del mando: pausa / continuar
    if (started && input.padPressed(9)) { if (paused) resume(); else openPause(); }
    if (paused) {
      retro.render(scene, camera, 0, sky.night);
      input.endFrame();
      return;
    }
    if (mapOpen) {
      if (input.wasPressed('KeyM') || input.wasPressed('Escape') || input.padPressed(13) || input.padPressed(1)) { toggleMap(false); input.endFrame(); return; }
      const f = player.vehicle ? player.vehicle.pos : player.pos;
      if (input.wasPressed('KeyC')) worldMap.center(f.x, f.z);
      worldMap.move(input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']) + input.pad.lx, input.axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']) + input.pad.ly,
        input.axis(['KeyQ', 'Minus', 'NumpadSubtract'], ['KeyE', 'Equal', 'BracketRight', 'NumpadAdd']) + input.pad.rt - input.pad.lt, raw);
      nav.update(0, f.x, f.z, player.vehicle ? player.vehicle.heading : player.heading, !!player.vehicle, missions.currentTarget);
      const rt = routeText();
      worldMap.draw(raw, { x: inside ? inside.door.x : f.x, z: inside ? inside.door.z : f.z, heading: player.vehicle ? player.vehicle.heading : player.heading },
        mapIcons(0, 0, 1e9), nav.route && rt ? { pts: nav.route.pts, color: missions.currentTarget ? '#d4c29a' : '#8fb2e8', text: rt.long } : null);
      input.endFrame();
      return;
    }
    if (started) {
      played += raw;
      autosaveT += raw;
      if (autosaveT > 120) { autosaveT = 0; if (!cantSave()) doSave(true); }
    }
    if (input.wasPressed('KeyM') || (input.padPressed(13) && !shops.open)) toggleMap(true);
    if (input.wasPressed('KeyL')) lightsMode = lightsMode === 'auto' ? 'on' : lightsMode === 'on' ? 'off' : 'auto';
    if (player.vehicle && (input.wasPressed('KeyR') || input.padPressed(8))) player.vehicle.reset(ground);
    if (input.wasPressed('KeyH')) hud.toggleHelp();
    if (input.wasPressed('KeyV') || input.padPressed(12)) { rig.firstPerson = !rig.firstPerson; hud.toast(rig.firstPerson ? 'Primera persona' : 'Tercera persona'); }
    if (input.wasPressed('KeyJ')) hud.toast(sky.toggleRain() ? 'Empieza a llover' : 'Deja de llover');
    if (input.wasPressed('KeyP')) { hud.toast(`Imagen: ${retro.cycle()}`); settings.image = retro.preset; saveSettings(settings); }
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
      if (!shops.open && (input.wasPressed('KeyQ') || input.padPressed(11))) {
        const was = !!player.cover;
        if (player.toggleCover(solidAt)) hud.toast('A cubierto · A/D para moverte · Q para salir');
        else if (!was) hud.toast('No hay nada donde cubrirse');
      }
      const w = combat.def;
      aiming = (input.isDown('Mouse2') || input.pad.lt > 0.5) && drinkT <= 0;
      if (drinkT > 0) { drinkT -= raw; if (drinkT <= 0) player.ch.setAction('none'); }
      else {
        player.ch.setProp(w.prop);
        player.ch.setAction(aiming ? w.aim : player.crouched ? 'crouch' : w.ready);
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
    } else { aiming = false; padRtWas = false; player.cover = null; }
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
    shops.update(raw, {
      up: input.wasPressed('KeyW') || input.wasPressed('ArrowUp') || input.padPressed(12),
      down: input.wasPressed('KeyS') || input.wasPressed('ArrowDown') || input.padPressed(13),
      buy: input.wasPressed('KeyE') || input.padPressed(0),
      close: input.wasPressed('KeyQ') || input.padPressed(1),
    });
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
      const h = police.heli;
      audio.rotor(h && !h.crashed ? h.pos : null);
      police.night = sky.night;
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
        beep: v ? null : lights.crossingBeep(focus.x, focus.z), solDist: Math.hypot(focus.x - km0.x, focus.z - km0.z), rain: sky.rain, water: inside ? 0 : water.loudness(focus.x, focus.z, focus.y),
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
    headlight.intensity = v && v.headlights ? Math.max(0.35, sky.night) * 600 * v.headOk : 0;
    if (v) hud.setCar({ name: v.type.name, gear: v.gear, rpm: v.rpm / v.type.mech.redline, health: v.health });

    parkedTimer += raw;
    if (parkedTimer > 2) { parkedTimer = 0; manageParked(wfocus); }
    nameTimer -= raw;
    if (nameTimer <= 0) {
      nameTimer = 0.5;
      if (inside) hud.setZone(inside.door.name, placeName(wfocus.x, wfocus.z));
      else if (lmInside) hud.setZone(lmInside.name, placeName(focus.x, focus.z));
      else hud.setZone(placeName(focus.x, focus.z), `Madrid · ${Math.round(terrain.altitude(focus.x, focus.z))} m`);
    }
    hud.update(raw, sky.clock() + (timeBoost > 1 ? ` x${timeBoost}` : ''), v ? v.speed * 3.6 : null);
    if (started && deadT <= 0) {
      const ea = eAction();
      const near = inside || v ? null : nearestEnterable();
      if (ea) hud.setHint('E', ea.text);
      else if (near) hud.setHint('F', near.driver === 'ai' ? `Robar ${near.type.name.toLowerCase()}` : `Subir al ${near.type.name.toLowerCase()}`);
      else hud.setHint(null);
    } else hud.setHint(null);
    // nombres de los vecinos con rutina y bocadillos
    const tags = routines.npcs.filter((n) => n.visible && n.alive && n.pos.distanceTo(player.pos) < 14)
      .map((n) => ({ key: n.name, text: `${n.name} <i>· ${n.role}</i>`, x: n.pos.x, y: n.pos.y, z: n.pos.z }));
    hud.placeOverlays(raw, project, tags);
    // GPS: ruta al objetivo de la misión o al destino marcado
    if (started && !inside) {
      nav.update(raw, wfocus.x, wfocus.z, v ? v.heading : player.heading, !!v, missions.currentTarget);
      if (nav.arrived) hud.toast('Has llegado a tu destino');
    }
    const rt = routeText();
    const viewM = v ? THREE.MathUtils.clamp(300 + v.speed * 9, 300, 650) : 230;
    hud.drawMinimap(wfocus.x, wfocus.z, rig.yaw, v ? v.heading : player.heading, inside ? [] : mapIcons(wfocus.x, wfocus.z, 110),
      nav.route && !inside ? { pts: nav.route.pts, color: missions.currentTarget ? '#d4c29a' : '#8fb2e8' } : null, viewM, rt && !inside ? rt.short : null, raw);
    hud.drawCompass(rig.yaw, focus.x, focus.z, [
      ...(lastCar && lastCar !== v ? [{ x: lastCar.pos.x, z: lastCar.pos.z, color: '#9a8f78' }] : []),
      ...(inside ? [] : missions.compass()),
      ...(nav.waypoint && !missions.currentTarget && !inside ? [{ x: nav.waypoint.x, z: nav.waypoint.z, color: '#8fb2e8' }] : []),
    ]);

    water.update(raw, sky.night);
    // edificios con interior: gente dentro y luz interior que acompaña al jugador
    {
      const p = player.vehicle ? player.vehicle.pos : player.pos;
      let inLm: Landmark | null = null;
      for (const lm of landmarks) { lm.update(raw, p, sky.time); if (!inLm && lm.inside(p.x, p.z, p.y)) inLm = lm; }
      // ascensor: el suelo sube con la cabina
      let lf: number | null = null;
      for (const lm of landmarks) { const y = lm.floorAt?.(player.pos) ?? null; if (y !== null) lf = y; }
      if (lf !== null) { player.floorOverride = lf; liftRide = true; }
      else if (liftRide) { liftRide = false; if (!inside) player.floorOverride = null; }
      if (inLm) sky.hemi.intensity += inLm.fill;
      if (!inside) {
        if (inLm) {
          const fw = new THREE.Vector3(Math.sin(rig.yaw), 0, Math.cos(rig.yaw));
          roomLights[0].position.set(p.x, p.y + 2.8, p.z);
          roomLights[1].position.set(p.x - fw.x * 5, p.y + 2.6, p.z - fw.z * 5);
          roomLights[0].intensity = 45; roomLights[1].intensity = 35;
          roomLights[0].distance = roomLights[1].distance = 18;
          audio.setIndoor(0.55);
          lmInside = inLm;
        } else if (lmInside) {
          lmInside = null;
          roomLights.forEach((l) => { l.intensity = 0; l.distance = 16; });
          audio.setIndoor(0);
        }
      }
    }
    drawDist.update(raw, camera.position, (scene.fog as THREE.Fog).far);
    if (settings.fps) {
      fpsN++; fpsT += clock.elapsedTime - fpsLast; fpsLast = clock.elapsedTime;
      if (fpsT > 0.5) {
        const ri = renderer.info.render;
        fpsEl.textContent = `${Math.round(fpsN / fpsT)} FPS · ${ri.calls} llamadas · ${Math.round(ri.triangles / 1000)}k triángulos`;
        fpsN = 0; fpsT = 0;
      }
    }
    lodT -= raw;
    if (lodT <= 0) {
      lodT = 0.25;
      const cp = camera.position;
      for (const c of [...parked, ...traffic.cars, ...police.vehicles()]) c.setFar(c !== player.vehicle && Math.hypot(c.pos.x - cp.x, c.pos.z - cp.z) > 70);
    }
    retro.render(scene, camera, raw, sky.night);
    input.endFrame();
  };
  frame();

  // Depuración en consola
  (window as unknown as { __madriz: unknown }).__madriz = {
    player, sky, traffic, peds, scene, solidAt, renderer, camera, rig, retro, hud, combat, police, pickups, getMoney: () => money, bridgeLog, landmarks, water, drawDist, nav, worldMap, toggleMap, setMoney: (n: number) => { money = n; }, missions, shops, routines, interiors, shopDoors, goInside, goOutside, getInside: () => inside, music: () => music, eAction, myCar, terrain, ground, data, collision, THREE, facades, lights, Vehicle, VEHICLE_TYPES, fx, audio, parked,
    start: () => { document.getElementById('start')!.classList.add('hidden'); started = true; },
    pause: () => openPause(), resume, save: () => doSave(false), load: () => { const sv = loadGame(); if (sv) applySave(sv); return !!sv; }, gather,
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
