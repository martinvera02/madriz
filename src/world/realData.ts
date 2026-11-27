// Formato de los datos generados por tools/fetch-data.mjs (OpenStreetMap + relieve).
// Coordenadas en metros: X = este, Z = sur, origen en el Kilómetro Cero (Puerta del Sol).

export interface RoadData {
  id: number;
  name?: string;
  hw: string; // tipo OSM highway
  w: number; // ancho en metros
  lanes?: number;
  ow?: 1 | -1; // sentido único (1 = en el sentido de los nodos, -1 = al revés)
  br?: 1; // puente
  layer?: number;
  car: 0 | 1;
  n: number[]; // índices a roadNodes
}

export interface BuildingData {
  id: string;
  part?: 1;
  h: number; // altura sobre el suelo
  mh: number; // altura mínima (voladizos, partes elevadas)
  pts: number[]; // anillo exterior [x,z,x,z…]
  holes?: number[][];
  name?: string;
  kind?: string;
  col?: string;
  /** 1 = altura estimada (OSM no trae plantas ni altura). */
  est?: 1;
}

export type AreaKind = 'water' | 'grass' | 'wood' | 'pitch' | 'plaza' | 'parking' | 'rail';
export interface AreaData { kind: AreaKind; name?: string; pts: number[]; holes?: number[][]; layer?: number; }
export interface PoiData { name: string; kind: string; x: number; z: number; }

export interface TerrainInfo { file: string; w: number; h: number; res: number; x0: number; z0: number; base: number; scale: number; }

export interface WorldData {
  zone: string;
  origin: { lat: number; lon: number };
  bounds: { x0: number; x1: number; z0: number; z1: number };
  /** Rectángulos que forman la zona (si falta, la zona es `bounds`). */
  boxes?: { x0: number; x1: number; z0: number; z1: number }[];
  terrain: TerrainInfo;
  roadNodes: number[];
  roads: RoadData[];
  buildings: BuildingData[];
  areas: AreaData[];
  trees: number[];
  lamps: number[];
  signals: number[];
  /** Índices de roadNodes que son pasos de peatones. */
  crossings: number[];
  /** Mobiliario: [tipo, x, z, dirección, …] */
  furniture: (string | number)[];
  /** Tipo de cada árbol OSM: 0 frondoso, 1 conífera, 2 palmera */
  treeKind: number[];
  hedges: number[][];
  pois: PoiData[];
  attribution: string;
}

export async function loadWorld(zone: string, onProgress: (msg: string) => void): Promise<{ data: WorldData; heights: Uint16Array }> {
  onProgress('Descargando calles y edificios…');
  const res = await fetch(`data/${zone}.json`);
  if (!res.ok) throw new Error(`No encuentro data/${zone}.json — ejecuta: node tools/fetch-data.mjs ${zone}`);
  const data = (await res.json()) as WorldData;
  onProgress('Descargando relieve…');
  const tr = await fetch(`data/${data.terrain.file}`);
  // PNG RGB sin pérdidas: R = byte alto, G = byte bajo de la altura en centímetros
  const bmp = await createImageBitmap(await tr.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const heights = new Uint16Array(bmp.width * bmp.height);
  for (let i = 0; i < heights.length; i++) heights[i] = (px[i * 4] << 8) | px[i * 4 + 1];
  return { data, heights };
}
