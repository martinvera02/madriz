import * as THREE from 'three';
import type { Vehicle } from '../entities/vehicle';

/*
 * Sonido de la ciudad, sintetizado en tiempo real con Web Audio (sin ficheros):
 *  - Ambiente: rumor de tráfico según los coches cercanos, murmullo de gente, viento a velocidad,
 *    pájaros de día y grillos de noche en las zonas verdes, cláxones y sirenas lejanas,
 *    campanadas del reloj de la Puerta del Sol a las horas en punto.
 *  - Vehículos: motor del jugador por RPM y tipo (gasolina, diésel, híbrido, V8, gas natural),
 *    motores de la IA posicionales, derrapes, golpes, claxon, frenos de aire del autobús.
 *  - Peatón: pasos sobre el pavimento y avisadores acústicos de los semáforos.
 */

export interface AudioFrame {
  camera: THREE.Camera;
  playerCar: Vehicle | null;
  playerPos: THREE.Vector3;
  footSpeed: number;
  grounded: boolean;
  cars: Vehicle[];
  pedCount: number;
  night: number;
  hour: number;
  green: number; // 0..1 cuánta vegetación hay alrededor
  beep: { d: number; fast: boolean } | null;
  solDist: number; // distancia al reloj de la Casa de Correos
  rain?: number;
  /** 0..1: fuentes o río cerca. */
  water?: number;
}

interface EngineVoice {
  osc: OscillatorNode[];
  filter: BiquadFilterNode;
  gain: GainNode;
  panner?: PannerNode;
  car: Vehicle | null;
}

export class CityAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private muted = false;
  private white!: AudioBuffer;
  private pink!: AudioBuffer;
  private brown!: AudioBuffer;

  private traffic!: GainNode;
  private hum!: GainNode;
  private crowd!: GainNode;
  private crowdLevel = 0;
  private wind!: GainNode;
  private screech!: GainNode;
  private screechF!: BiquadFilterNode;
  private crickets!: GainNode;
  private waterG: GainNode | null = null;
  private rainG!: GainNode;

  private engine: EngineVoice | null = null;
  private engineIntake!: GainNode;
  private engineIntakeF!: BiquadFilterNode;
  private electric!: OscillatorNode;
  private electricG!: GainNode;
  private ai: EngineVoice[] = [];
  private hornNodes: { g: GainNode } | null = null;

  private hornPrev = new Map<number, boolean>();
  private speedPrev = new Map<number, number>();
  private nextBird = 2;
  private nextDistant = 8;
  private nextBeep = 0;
  private stepPhase = 0;
  private lastHour = -1;
  private bellQueue: { at: number; big: boolean }[] = [];
  private t = 0;
  private impactCooldown = 0;

  get started() { return !!this.ctx; }
  get context() { return this.ctx; }
  private indoor = 0;

  /** Dentro de un local: la calle se oye amortiguada. */
  setIndoor(k: number) {
    this.indoor = k;
    if (this.ctx && !this.muted) this.master.gain.setTargetAtTime(this.volume * (1 - 0.7 * k), this.ctx.currentTime, 0.3);
  }

  // ---- muestras grabadas (bancos de sonido libres, ver README): disparos y recargas
  private samples = new Map<string, AudioBuffer>();
  private loadSamples() {
    const names = ['pistola', 'subfusil', 'escopeta', 'recarga-pistola', 'recarga-subfusil', 'recarga-escopeta'];
    for (const n of names) {
      fetch(`sfx/${n}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then((b) => this.ctx!.decodeAudioData(b)).then((buf) => this.samples.set(n, buf)).catch(() => { /* se usa la síntesis */ });
    }
  }
  /** Reproduce una muestra con posición 3D, una pizca de variación de tono y filtro por distancia. */
  private sample(name: string, pos: THREE.Vector3, vol = 1, rate = 1): boolean {
    const buf = this.samples.get(name);
    if (!buf || !this.ctx) return false;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = ctx.createGain();
    g.gain.value = vol;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const L = ctx.listener;
    const d = L.positionX ? Math.hypot(pos.x - L.positionX.value, pos.y - L.positionY.value, pos.z - L.positionZ.value) : 0;
    lp.frequency.value = Math.max(900, 18000 - d * 90); // de lejos suena más apagado
    src.connect(lp).connect(g).connect(this.panner(pos.x, pos.y, pos.z, 6));
    src.start();
    return true;
  }

  // ---- sirena de la policía (una voz posicional que sigue al coche más cercano)
  private sirenV: { g: GainNode; p: PannerNode } | null = null;
  siren(pos: THREE.Vector3 | null) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (!this.sirenV) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 900;
      // barrido sube-baja ("wail") de la sirena
      const lfo = ctx.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 0.32;
      const lg = ctx.createGain(); lg.gain.value = 420;
      lfo.connect(lg).connect(o.frequency);
      const bp = this.bp(1100, 0.9);
      const g = ctx.createGain(); g.gain.value = 0;
      const p = this.panner(0, 0, 0, 10);
      o.connect(bp).connect(g).connect(p);
      o.start(); lfo.start();
      this.sirenV = { g, p };
    }
    const v = this.sirenV;
    if (pos) { v.p.positionX.value = pos.x; v.p.positionY.value = pos.y + 1.5; v.p.positionZ.value = pos.z; }
    this.set(v.g.gain, pos ? 0.09 : 0, 0.3);
  }

  // ---- helicóptero: ruido grave troceado por las palas ("chop-chop"), posicional
  private rotorV: { g: GainNode; p: PannerNode } | null = null;
  rotor(pos: THREE.Vector3 | null) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (!this.rotorV) {
      const src = ctx.createBufferSource();
      src.buffer = this.brown; src.loop = true;
      const lp = this.lp(420);
      const am = ctx.createGain(); am.gain.value = 0.35;
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 11.5;
      const lg = ctx.createGain(); lg.gain.value = 0.65;
      lfo.connect(lg).connect(am.gain);
      const g = ctx.createGain(); g.gain.value = 0;
      const p = this.panner(0, 0, 0, 25);
      src.connect(lp).connect(am).connect(g).connect(p);
      src.start(); lfo.start();
      this.rotorV = { g, p };
    }
    const v = this.rotorV;
    if (pos) { v.p.positionX.value = pos.x; v.p.positionY.value = pos.y; v.p.positionZ.value = pos.z; }
    this.set(v.g.gain, pos ? 0.9 : 0, 0.6);
  }

  /** Sonidos de armas y peleas. */
  weapon(kind: 'shot' | 'melee' | 'swish' | 'reload' | 'empty' | 'explosion' | 'ricochet', weapon: string | null, pos: THREE.Vector3) {
    if (!this.ctx) return;
    const p = pos.clone();
    switch (kind) {
      case 'shot': {
        const big = weapon === 'escopeta', small = weapon === 'subfusil';
        // grabación real (banco libre) si está cargada; si no, síntesis
        if (!this.sample(weapon ?? 'pistola', p, small ? 0.75 : 1, small ? 1.08 : 1)) {
          this.oneShotNoise(big ? 0.45 : small ? 0.16 : 0.26, [this.hp(180), this.lp(big ? 2600 : 3800)], big ? 1.0 : small ? 0.55 : 0.75, p, 0.001);
          this.tone(big ? 55 : 75, big ? 0.3 : 0.16, big ? 0.6 : 0.4, 'sine', 0, p, 32);
        }
        // eco entre las fachadas (cola grave que se pierde por las calles)
        if (this.indoor < 0.5) this.oneShotNoise(big ? 1.2 : 0.8, [this.lp(600)], big ? 0.12 : 0.07, p, 0.08);
        break;
      }
      case 'melee': this.tone(95, 0.12, 0.45, 'sine', 0, p, 50); this.oneShotNoise(0.1, [this.lp(700)], 0.4, p); break;
      case 'swish': this.oneShotNoise(0.16, [this.bp(weapon === 'bate' ? 700 : 1100, 1.4)], 0.12, p, 0.06); break;
      case 'reload': if (!this.sample('recarga-' + (weapon ?? 'pistola'), p, 0.8)) for (const at of [0, 0.35, 0.9]) this.tone(1800, 0.03, 0.08, 'square', at, p); break;
      case 'empty': this.tone(2400, 0.02, 0.08, 'square', 0, p); break;
      case 'ricochet': this.tone(2600 + Math.random() * 800, 0.18, 0.05, 'triangle', 0, p, 1100); break;
      case 'explosion':
        this.oneShotNoise(2.4, [this.lp(900)], 1.2, p, 0.01);
        this.tone(45, 1.2, 0.8, 'sine', 0, p, 25);
        this.oneShotNoise(3.5, [this.lp(300)], 0.4, p, 0.2);
        break;
    }
  }

  /** Debe llamarse desde un gesto del usuario (el botón Jugar). */
  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(comp).connect(ctx.destination);
    this.makeNoise();

    this.traffic = this.loop(this.brown, [this.lp(260), this.lp(500)], 0);
    this.hum = this.loop(this.pink, [this.bp(110, 0.6)], 0);
    this.crowd = this.loop(this.pink, [this.bp(650, 0.9), this.lp(1600)], 0);
    this.wind = this.loop(this.white, [this.hp(400), this.lp(2200)], 0);
    this.screechF = this.bp(1900, 6);
    this.screech = this.loop(this.white, [this.screechF, this.bp(2300, 3)], 0);
    this.rainG = this.loop(this.pink, [this.hp(900), this.lp(7000)], 0);
    this.waterG = this.loop(this.white, [this.bp(1500, 0.45), this.lp(4200)], 0);

    // Grillos: portadora aguda modulada en trenes de pulsos
    const cr = ctx.createOscillator();
    cr.frequency.value = 4400;
    const am = ctx.createGain();
    am.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = 'square'; lfo.frequency.value = 28;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.5;
    lfo.connect(lfoG).connect(am.gain);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 1.3;
    const lfo2G = ctx.createGain(); lfo2G.gain.value = 0.5;
    const env = ctx.createGain(); env.gain.value = 0.5;
    lfo2.connect(lfo2G).connect(env.gain);
    this.crickets = ctx.createGain(); this.crickets.gain.value = 0;
    cr.connect(am).connect(env).connect(this.crickets).connect(this.master);
    cr.start(); lfo.start(); lfo2.start();

    // Motores de la IA: cinco voces posicionales que se asignan a los coches más cercanos
    for (let i = 0; i < 5; i++) this.ai.push(this.makeEngine(true));
    this.loadSamples();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * (1 - 0.7 * this.indoor), this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /** Volumen general (0–1). */
  volume = 0.85;
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx && !this.muted) this.master.gain.setTargetAtTime(this.volume * (1 - 0.7 * this.indoor), this.ctx.currentTime, 0.05);
  }

  /** Pausa: congela todo el audio (motor, ambiente, música) sin perder su estado. */
  setPaused(on: boolean) {
    if (!this.ctx) return;
    if (on && this.ctx.state === 'running') void this.ctx.suspend();
    if (!on && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  // ------------------------------------------------------------------ utilidades
  private makeNoise() {
    const ctx = this.ctx!;
    const n = ctx.sampleRate * 3;
    this.white = ctx.createBuffer(1, n, ctx.sampleRate);
    this.pink = ctx.createBuffer(1, n, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, n, ctx.sampleRate);
    const w = this.white.getChannelData(0), p = this.pink.getChannelData(0), b = this.brown.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.random() * 2 - 1;
      w[i] = x;
      b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
      b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
      p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11; b6 = x * 0.115926;
      last = (last + 0.02 * x) / 1.02; b[i] = last * 3.5;
    }
  }
  private lp(f: number, q = 0.7) { const n = this.ctx!.createBiquadFilter(); n.type = 'lowpass'; n.frequency.value = f; n.Q.value = q; return n; }
  private hp(f: number) { const n = this.ctx!.createBiquadFilter(); n.type = 'highpass'; n.frequency.value = f; return n; }
  private bp(f: number, q: number) { const n = this.ctx!.createBiquadFilter(); n.type = 'bandpass'; n.frequency.value = f; n.Q.value = q; return n; }
  private loop(buf: AudioBuffer, chain: AudioNode[], vol: number) {
    const src = this.ctx!.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.loopStart = Math.random();
    let node: AudioNode = src;
    for (const c of chain) node = node.connect(c);
    const g = this.ctx!.createGain();
    g.gain.value = vol;
    node.connect(g).connect(this.master);
    src.start(0, Math.random() * 2);
    return g;
  }
  private set(g: AudioParam, v: number, tc = 0.12) { g.setTargetAtTime(v, this.ctx!.currentTime, tc); }
  private panner(x: number, y: number, z: number, ref = 5) {
    const p = this.ctx!.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = 1.4; p.maxDistance = 400;
    p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
    p.connect(this.master);
    return p;
  }

  private makeEngine(positional: boolean): EngineVoice {
    const ctx = this.ctx!;
    const osc = [ctx.createOscillator(), ctx.createOscillator(), ctx.createOscillator()];
    osc[0].type = 'sawtooth'; osc[1].type = 'square'; osc[2].type = 'sawtooth';
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 255) * 2 - 1; curve[i] = Math.tanh(x * 2.2); }
    shaper.curve = curve;
    const mix = ctx.createGain(); mix.gain.value = 0.4;
    const filter = this.lp(400, 1.2);
    const gain = ctx.createGain(); gain.gain.value = 0;
    const levels = [0.5, 0.35, 0.18];
    osc.forEach((o, i) => { const g = ctx.createGain(); g.gain.value = levels[i]; o.connect(g).connect(mix); o.start(); });
    mix.connect(shaper).connect(filter).connect(gain);
    let panner: PannerNode | undefined;
    if (positional) { panner = this.panner(0, 0, 0, 4); gain.connect(panner); } else gain.connect(this.master);
    return { osc, filter, gain, panner, car: null };
  }

  private ensurePlayerEngine() {
    if (this.engine) return;
    const ctx = this.ctx!;
    this.engine = this.makeEngine(false);
    this.engineIntakeF = this.bp(300, 1.5);
    this.engineIntake = this.loop(this.white, [this.engineIntakeF], 0);
    this.electric = ctx.createOscillator();
    this.electric.type = 'sine';
    this.electricG = ctx.createGain(); this.electricG.gain.value = 0;
    this.electric.connect(this.electricG).connect(this.master);
    this.electric.start();
  }

  /** Frecuencia de encendido y "carácter" según el motor. */
  private engineTone(v: Vehicle) {
    const e = v.type.engine;
    const cylHalf = e === 'v8' ? 4 : e === 'gnc' ? 3 : 2; // explosiones por vuelta
    const f = (v.rpm / 60) * cylHalf;
    const bright = e === 'v8' ? 1.4 : e === 'diesel' || e === 'gnc' ? 0.6 : 1;
    return { f, bright, diesel: e === 'diesel' || e === 'gnc' };
  }

  private oneShotNoise(dur: number, filt: BiquadFilterNode[], vol: number, pos?: THREE.Vector3, attack = 0.005) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    let node: AudioNode = src;
    for (const f of filt) node = node.connect(f);
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    node.connect(g);
    if (pos) g.connect(this.panner(pos.x, pos.y, pos.z, 6)); else g.connect(this.master);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', at = 0, pos?: THREE.Vector3, slideTo?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + at;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g);
    if (pos) g.connect(this.panner(pos.x, pos.y, pos.z, 8)); else g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------ eventos
  impact(strength: number, pos?: THREE.Vector3) {
    if (!this.ctx || this.impactCooldown > 0) return;
    this.impactCooldown = 0.12;
    const s = Math.min(1, strength / 20);
    this.oneShotNoise(0.25 + s * 0.4, [this.lp(500 + s * 2500)], 0.35 + s * 0.6, pos);
    this.tone(70 + Math.random() * 20, 0.35, 0.5 * s + 0.15, 'sine', 0, pos, 40);
    if (strength > 11) {
      // cristales
      for (let k = 0; k < 6; k++) this.tone(3000 + Math.random() * 4000, 0.15 + Math.random() * 0.3, 0.05, 'triangle', 0.02 + Math.random() * 0.2, pos);
      this.oneShotNoise(0.5, [this.hp(4000)], 0.15, pos);
    }
  }

  private horn(pos?: THREE.Vector3, dur = 0.5, bus = false) {
    const f = bus ? [290, 350] : [400 + Math.random() * 40, 500 + Math.random() * 40];
    for (const fr of f) this.tone(fr, dur, 0.07, 'square', 0, pos);
  }

  private bell(at: number, big: boolean, vol = 1) {
    // campana: parciales inarmónicos con caída larga
    const base = big ? 196 : 392;
    const parts = [[0.5, 0.5], [1, 1], [1.19, 0.6], [1.5, 0.45], [2, 0.35], [2.74, 0.2], [3.76, 0.12]];
    for (const [r, v] of parts) this.tone(base * r, big ? 4.5 : 2, 0.09 * v * vol, 'sine', at);
  }

  // ------------------------------------------------------------------ bucle
  update(dt: number, f: AudioFrame) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.t += dt;
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
    // Oyente = cámara
    const cam = f.camera;
    const L = ctx.listener;
    const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    if (L.positionX) {
      L.positionX.value = cam.position.x; L.positionY.value = cam.position.y; L.positionZ.value = cam.position.z;
      L.forwardX.value = fw.x; L.forwardY.value = fw.y; L.forwardZ.value = fw.z;
      L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
    }
    const day = 1 - f.night;
    const p = f.playerPos;
    if (this.waterG) this.set(this.waterG.gain, (f.water ?? 0) * 0.16 * (1 - 0.8 * this.indoor), 0.4);

    // ---- tráfico: densidad y velocidad de los coches cercanos
    let dens = 0;
    for (const c of f.cars) {
      const d = c.pos.distanceTo(p);
      if (d > 120) continue;
      dens += (0.4 + Math.min(1, c.speed / 12)) / (1 + d / 18);
    }
    dens = Math.min(1.5, dens / 4);
    this.set(this.traffic.gain, (0.05 + dens * 0.22) * (0.6 + day * 0.4));
    this.set(this.hum.gain, 0.06 + day * 0.04);
    // ---- gente: murmullo que respira
    const crowdBase = Math.min(1, f.pedCount / 22) * (0.12 + day * 0.1);
    if (Math.random() < dt * 3) this.crowdLevel = crowdBase * (0.6 + Math.random() * 0.6);
    this.set(this.crowd.gain, this.crowdLevel, 0.4);
    // ---- lluvia: siseo general y algún goterón
    this.set(this.rainG.gain, (f.rain ?? 0) * 0.22, 0.5);
    // ---- grillos de noche en los parques
    this.set(this.crickets.gain, Math.max(0, f.night - 0.4) * f.green * 0.035 * (1 - (f.rain ?? 0)), 1);

    // ---- pájaros de día cerca de árboles
    this.nextBird -= dt;
    if (this.nextBird <= 0) {
      this.nextBird = 0.6 + Math.random() * (5 - f.green * 4);
      if (day > 0.5 && f.green > 0.1 && (f.rain ?? 0) < 0.3) {
        const base = 2600 + Math.random() * 2200, n = 2 + Math.floor(Math.random() * 5);
        const ang = Math.random() * Math.PI * 2, r = 8 + Math.random() * 25;
        const pos = new THREE.Vector3(p.x + Math.cos(ang) * r, p.y + 6 + Math.random() * 6, p.z + Math.sin(ang) * r);
        for (let k = 0; k < n; k++) this.tone(base * (0.9 + Math.random() * 0.25), 0.08 + Math.random() * 0.06, 0.045 * f.green, 'sine', k * (0.09 + Math.random() * 0.06), pos, base * (1.15 + Math.random() * 0.3));
      }
    }
    // ---- sucesos lejanos: cláxones, una sirena, un autobús que arranca
    this.nextDistant -= dt;
    if (this.nextDistant <= 0) {
      this.nextDistant = 4 + Math.random() * 10;
      const ang = Math.random() * Math.PI * 2, r = 70 + Math.random() * 120;
      const pos = new THREE.Vector3(p.x + Math.cos(ang) * r, p.y + 2, p.z + Math.sin(ang) * r);
      const k = Math.random();
      if (k < 0.55) this.horn(pos, 0.25 + Math.random() * 0.5);
      else if (k < 0.65) {
        // sirena de ambulancia/policía (bitonal), que se aleja
        for (let i = 0; i < 6; i++) { this.tone(660, 0.48, 0.05, 'sawtooth', i * 1.0, pos); this.tone(880, 0.48, 0.05, 'sawtooth', i * 1.0 + 0.5, pos); }
      } else if (k < 0.8) this.oneShotNoise(1.2, [this.bp(900, 0.5)], 0.12, pos, 0.4); // moto que pasa
    }

    // ---- campanadas del reloj de la Puerta del Sol a las horas en punto
    const hourInt = Math.floor(f.hour);
    if (this.lastHour >= 0 && hourInt !== this.lastHour && f.solDist < 600) {
      const n = hourInt % 12 || 12;
      for (let i = 0; i < 4; i++) this.bellQueue.push({ at: this.t + i * 1.4, big: false }); // cuartos
      for (let i = 0; i < n; i++) this.bellQueue.push({ at: this.t + 7 + i * 3, big: true }); // horas
    }
    this.lastHour = hourInt;
    while (this.bellQueue.length && this.bellQueue[0].at <= this.t) {
      const b = this.bellQueue.shift()!;
      this.bell(0, b.big, Math.max(0.15, 1 - f.solDist / 600));
    }

    // ---- avisador acústico del semáforo (solo a pie)
    this.nextBeep -= dt;
    if (!f.playerCar && f.beep && this.nextBeep <= 0) {
      this.nextBeep = f.beep.fast ? 0.22 : 0.55;
      this.tone(2900, 0.06, 0.05 * Math.max(0.1, 1 - f.beep.d / 22), 'square');
    }

    // ---- pasos
    if (!f.playerCar && f.grounded && f.footSpeed > 0.5) {
      this.stepPhase += dt * (f.footSpeed / 4.2) * 1.9;
      if (this.stepPhase >= 1) {
        this.stepPhase -= 1;
        this.oneShotNoise(0.07, [this.bp(f.footSpeed > 6 ? 900 : 700, 1.2)], f.footSpeed > 6 ? 0.22 : 0.13);
        this.tone(110 + Math.random() * 20, 0.05, 0.08, 'sine');
      }
    } else this.stepPhase = 0.7;

    // ---- coche del jugador
    const v = f.playerCar;
    if (v) {
      this.ensurePlayerEngine();
      const e = this.engine!;
      const tone = this.engineTone(v);
      const hybridQuiet = v.type.engine === 'hibrido' && v.speed < 9 && v.throttleIn < 0.8;
      const fr = Math.max(14, tone.f);
      this.set(e.osc[0].frequency, fr, 0.03);
      this.set(e.osc[1].frequency, fr * 0.5, 0.03);
      this.set(e.osc[2].frequency, fr * 2.01, 0.03);
      const rpmN = v.rpm / v.type.mech.redline;
      this.set(e.filter.frequency, (180 + v.throttleIn * 1400 + rpmN * 1500) * tone.bright, 0.05);
      const vol = (0.1 + v.throttleIn * 0.12 + rpmN * 0.06) * (v.health <= 0 ? 0 : 1) * (hybridQuiet ? 0.12 : 1);
      this.set(e.gain.gain, vol, 0.05);
      this.set(this.engineIntakeF.frequency, 200 + rpmN * 1800, 0.05);
      this.set(this.engineIntake.gain, (tone.diesel ? 0.05 : 0.03) * v.throttleIn * (hybridQuiet ? 0.1 : 1), 0.05);
      // zumbido eléctrico del híbrido (taxi) y del autobús
      const ev = v.type.engine === 'hibrido' || v.type.engine === 'gnc';
      this.set(this.electric.frequency, 180 + v.speed * 38, 0.05);
      this.set(this.electricG.gain, ev ? 0.012 + Math.min(0.02, v.speed * 0.001) : 0, 0.1);
      this.set(this.wind.gain, Math.min(0.2, (v.speed / 50) ** 2 * 0.2), 0.2);
      this.set(this.screechF.frequency, 1700 + Math.sin(this.t * 23) * 200 + v.speed * 10, 0.02);
      this.set(this.screech.gain, v.skid * 0.16, 0.04);
      if (v.lastImpact > 3) this.impact(v.lastImpact);
      // claxon continuo mientras se pulsa
      if (v.horn && !this.hornNodes) {
        const g = ctx.createGain(); g.gain.value = 0.0;
        const fq = v.type.id === 'autobus' ? [290, 350] : [415, 520];
        const filt = this.bp(900, 1);
        for (const fr2 of fq) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = fr2; o.connect(filt); o.start(); (g as unknown as { o: OscillatorNode[] }).o = [...((g as unknown as { o?: OscillatorNode[] }).o ?? []), o]; }
        filt.connect(g).connect(this.master);
        this.set(g.gain, 0.1, 0.01);
        this.hornNodes = { g };
      } else if (!v.horn && this.hornNodes) {
        const g = this.hornNodes.g;
        this.set(g.gain, 0, 0.02);
        const os = (g as unknown as { o: OscillatorNode[] }).o;
        setTimeout(() => os.forEach((o) => o.stop()), 200);
        this.hornNodes = null;
      }
    } else {
      if (this.engine) {
        this.set(this.engine.gain.gain, 0, 0.1);
        this.set(this.engineIntake.gain, 0, 0.1);
        this.set(this.electricG.gain, 0, 0.1);
      }
      this.set(this.wind.gain, 0, 0.3);
      this.set(this.screech.gain, 0, 0.05);
      if (this.hornNodes) { this.set(this.hornNodes.g.gain, 0, 0.02); this.hornNodes = null; }
    }

    // ---- motores de la IA más cercanos, cláxones, frenos de aire, golpes
    const near = f.cars.filter((c) => c !== v && c.driver !== 'none' && c.pos.distanceToSquared(p) < 70 * 70)
      .sort((a, b) => a.pos.distanceToSquared(p) - b.pos.distanceToSquared(p)).slice(0, this.ai.length);
    this.ai.forEach((voice, i) => {
      const c = near[i] ?? null;
      voice.car = c;
      if (!c) { this.set(voice.gain.gain, 0, 0.2); return; }
      const tone = this.engineTone(c);
      const fr = Math.max(14, tone.f);
      this.set(voice.osc[0].frequency, fr, 0.05); this.set(voice.osc[1].frequency, fr * 0.5, 0.05); this.set(voice.osc[2].frequency, fr * 2.01, 0.05);
      this.set(voice.filter.frequency, (200 + c.throttleIn * 900) * tone.bright, 0.1);
      const quiet = c.type.engine === 'hibrido' && c.speed < 9 ? 0.15 : 1;
      this.set(voice.gain.gain, (0.05 + c.throttleIn * 0.05) * (c.type.id === 'autobus' ? 1.8 : 1) * quiet, 0.1);
      const pn = voice.panner!;
      pn.positionX.value = c.pos.x; pn.positionY.value = c.pos.y + 0.6; pn.positionZ.value = c.pos.z;
    });
    for (const c of f.cars) {
      if (c === v) continue;
      const d2 = c.pos.distanceToSquared(p);
      if (d2 > 90 * 90) continue;
      const prevH = this.hornPrev.get(c.id) ?? false;
      if (c.horn && !prevH) this.horn(c.pos.clone().setY(c.pos.y + 1), 0.35 + Math.random() * 0.4, c.type.id === 'autobus');
      this.hornPrev.set(c.id, c.horn);
      const ps = this.speedPrev.get(c.id) ?? 0;
      if (c.type.id === 'autobus' && ps > 0.6 && c.speed <= 0.6) this.oneShotNoise(0.9, [this.hp(2500), this.lp(7000)], 0.18, c.pos.clone().setY(c.pos.y + 0.5), 0.02); // "pssst"
      this.speedPrev.set(c.id, c.speed);
      if (c.lastImpact > 5 && d2 < 50 * 50) this.impact(c.lastImpact, c.pos.clone());
    }
  }
}
