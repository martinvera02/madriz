import * as THREE from 'three';
import { loadWorld } from './realData';
import { Terrain, buildGround } from './terrain';
import { Ground, buildRoads } from './roads';
import { buildViaduct } from './viaduct';
import { buildStreetFurniture } from './streetFurniture';
import { FacadeDetail, buildRoofProps } from './facadeDetail';
import { CarwayIndex } from './spatial';
import { buildBuildings } from './buildings';
import { makeFacadeOverride, buildIconic, buildFacadeDetails } from './iconic';
import { buildProps } from './props';
import { CollisionWorld } from './collision';
import { Sky } from './sky';
import { Water } from './water';
import { buildBridges, buildPlazaMayor, buildPlazaEspana } from './urban';
import { landmarkBuildings, buildLandmarks, cutTerrain, type Landmark } from './landmarks';
import { Vehicle, VEHICLE_TYPES } from '../entities/vehicle';
import { outsideCells } from './zoneShape';
import { DrawDistance, splitGroup, splitInstancedGroup } from '../render/streaming';

/**
 * Construye la ciudad entera (relieve, calles, edificios, monumentos, agua, arbolado y mobiliario),
 * la trocea en celdas y registra cada grupo en la distancia de dibujado. No crea sistemas de juego.
 */
export async function buildWorld(scene: THREE.Scene, zone: string, params: URLSearchParams,
  say: (msg: string) => void, frameYield: () => Promise<unknown>) {
  const { data, heights } = await loadWorld(zone, say);
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
  // edificios emblemáticos con interior recorrible: su bloque de OSM se sustituye por el modelo propio
  const landmarkDefs = landmarkBuildings(data);
  const baseOverride = makeFacadeOverride(data);
  const { group: bGroup, placed, specials, facades, roofSpots } = buildBuildings(data, terrain, collision,
    // los contornos de puente que OSM etiqueta como edificio (Segovia, del Rey) se modelan en urban.ts
    (b) => (landmarkDefs.has(b) || /^(puente|pasarela|presa|viaducto)\b/i.test(b.name ?? '') ? { skip: true } : baseOverride(b)), groundRes.minimap);
  say('Amueblando el Mercado de San Miguel y San Ginés…'); await frameYield();
  const landmarks: Landmark[] = buildLandmarks(data, ground, collision, landmarkDefs);
  for (const lm of landmarks) scene.add(lm.group);
  // taxis en las paradas de los edificios (Atocha)
  const landmarkCars: Vehicle[] = [];
  for (const lm of landmarks) for (const pk of lm.parking ?? []) {
    const v = new Vehicle(VEHICLE_TYPES[pk.type]);
    v.place(pk.x, pk.z, pk.heading, ground.heightAt(pk.x, pk.z));
    scene.add(v.mesh);
    landmarkCars.push(v);
  }
  // sin terreno bajo los edificios con interior (sótanos y escaleras)
  cutTerrain(groundRes.group, landmarks.map((l) => ({ pts: l.footprint, floor: l.floor })));
  scene.add(bGroup);
  const roofProps = buildRoofProps(roofSpots);
  scene.add(roofProps);
  const facadeDetail = new FacadeDetail(facades);
  scene.add(facadeDetail.group);
  say('Llenando fuentes, estanques y el Manzanares…'); await frameYield();
  const water = new Water(data, ground, collision);
  scene.add(water.group);
  // puentes de Madrid Río, Plaza Mayor y plaza de España con el túnel de Bailén
  say('Puentes de Madrid Río, Plaza Mayor y plaza de España…'); await frameYield();
  const bridges = buildBridges(data, ground, collision, water);
  const plazaMayor = buildPlazaMayor(data, ground, collision);
  const plazaEspana = buildPlazaEspana(data, ground, collision);
  scene.add(bridges, plazaMayor, plazaEspana.group);
  cutTerrain(groundRes.group, plazaEspana.cuts);
  const iconic = buildIconic(data, placed, ground, collision);
  scene.add(iconic);
  const bigDetails = buildFacadeDetails(data, placed);
  scene.add(bigDetails);

  say('Plantando árboles y farolas…'); await frameYield();
  const props = buildProps(data, ground, collision);
  scene.add(props.group);
  const wind = (props.group.userData as { wind: { value: number } }).wind;
  say('Colocando bancos, quioscos y marquesinas…'); await frameYield();
  const carway = new CarwayIndex(data);
  const furniture = buildStreetFurniture(data, specials, ground, collision, carway);
  scene.add(furniture);
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
  // zona de varios rectángulos: muros en las esquinas del envoltorio que quedan fuera
  for (const c of outsideCells(data.boxes ?? [B], B)) collision.addBox(c.x0, c.z0, c.x1, c.z1, 1e4);

  // Rendimiento: trocear la ciudad en celdas de CELL m y dibujar cada categoría hasta su distancia
  const CELL = Number(params.get('celda') ?? 260);
  for (const g of [groundRes.group, roads.group, bGroup, bigDetails, furniture, water.group, bridges, plazaMayor, plazaEspana.group]) splitGroup(g, CELL);
  splitInstancedGroup(roofProps, CELL);
  // los cachivaches de las azoteas no aportan sombra visible y multiplicaban las llamadas de la sombra
  roofProps.traverse((o) => { o.castShadow = false; });
  const drawDist = new DrawDistance();
  for (const g of [groundRes.group, roads.group, bGroup, bigDetails]) drawDist.add(g, 'city');
  drawDist.add(iconic, 'landmark');
  drawDist.add(water.group, 'city');
  for (const g of [bridges, plazaMayor, plazaEspana.group]) drawDist.add(g, 'city');
  drawDist.add(furniture, 'detail');
  drawDist.add(props.group, 'props');
  drawDist.add(roofProps, 'roof');

  return {
    data, terrain, ground, collision, groundRes, landmarks, landmarkCars, placed, specials, facades, facadeDetail, water,
    props, wind, carway, sky, wetMats, baseRough, baseCol, drawDist,
  };
}

export type World = Awaited<ReturnType<typeof buildWorld>>;
