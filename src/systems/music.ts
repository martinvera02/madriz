/*
 * Banda sonora procedural de estilo cyberpunk suave / synthwave, sin ficheros:
 * pad de sierras desafinadas con reverberación, bajo pulsante, arpegio con eco, batería suave
 * y una melodía ocasional. Progresión en La menor que cambia por secciones (intro, estrofa, puente).
 * Suena bajita en la calle, más alta en el coche (como una radio) y en los bares (gramola).
 * También genera la guitarra de la música callejera, a tempo con la banda sonora.
 */

const BPM = 86;
const SIX = 60 / BPM / 4; // semicorchea
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// acordes (MIDI) por compás: Am F C G | Am F Em G | Dm Am F E | Am F C G
const PROG = [
  [57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62],
  [57, 60, 64], [53, 57, 60], [52, 55, 59], [55, 59, 62],
  [50, 53, 57], [57, 60, 64], [53, 57, 60], [52, 56, 59],
  [57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62],
];
const PENTA = [69, 72, 74, 76, 79, 81, 84];

export class Music {
  private ctx: AudioContext;
  private out: GainNode;
  private bus: GainNode;
  private verb: ConvolverNode;
  private delay: DelayNode;
  private noise: AudioBuffer;
  private step = 0;
  private nextTime = 0;
  private timer: number | null = null;
  private level = 0.1;
  enabled = true;
  /** Volumen de la guitarra callejera (0 = lejos). */
  busk = 0;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(ctx.destination);
    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    // pequeño "sidechain": el compresor hace respirar la mezcla
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    this.bus.connect(comp).connect(this.out);
    // reverberación por convolución con un impulso generado
    this.verb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.8;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.verb.buffer = ir;
    const verbG = ctx.createGain(); verbG.gain.value = 0.55;
    this.verb.connect(verbG).connect(this.bus);
    // eco de corchea con puntillo para el arpegio
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = SIX * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2400;
    this.delay.connect(dl).connect(fb).connect(this.delay);
    const dOut = ctx.createGain(); dOut.gain.value = 0.5;
    dl.connect(dOut).connect(this.bus);
    dOut.connect(this.verb);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const n = this.noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
  }

  start() {
    if (this.timer !== null) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  /** Volumen objetivo: 0.1 calle, 0.26 coche, 0.3 bar… */
  setLevel(v: number) {
    this.level = this.enabled ? v : 0;
    this.out.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.6);
  }

  private schedule() {
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      this.play16(this.step, this.nextTime);
      this.step++;
      this.nextTime += SIX;
    }
  }

  private voice(type: OscillatorType, f: number, t: number, dur: number, vol: number, opts: { attack?: number; cutoff?: number; detune?: number; dest?: AudioNode[]; slide?: number } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(opts.slide, t + dur);
    if (opts.detune) o.detune.value = opts.detune;
    const g = ctx.createGain();
    const a = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.setTargetAtTime(0.0001, t + Math.max(a, dur * 0.7), dur * 0.25 + 0.02);
    let node: AudioNode = o;
    if (opts.cutoff) { const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = opts.cutoff; f2.Q.value = 0.8; node = node.connect(f2); }
    node.connect(g);
    for (const d of opts.dest ?? [this.bus]) g.connect(d);
    o.start(t);
    o.stop(t + dur + 0.6);
  }

  private hit(t: number, dur: number, vol: number, type: BiquadFilterType, f: number, q = 1) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt).connect(g).connect(this.bus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  private play16(step: number, t: number) {
    const bar = Math.floor(step / 16) % PROG.length;
    const s16 = step % 16;
    const section = Math.floor(step / 16 / 16) % 4; // 0 intro, 1 estrofa, 2 completo, 3 calma
    const chord = PROG[bar];
    const drums = section === 1 || section === 2;
    const arp = section >= 1 && section !== 3 ? 1 : 0;
    if (this.level > 0.001) {
      // pad: al empezar cada compás
      if (s16 === 0) {
        for (const n of chord) for (const dt of [-9, 8]) {
          this.voice('sawtooth', midi(n), t, SIX * 16, 0.028, { attack: 0.5, cutoff: section === 3 ? 700 : 1100, detune: dt, dest: [this.verb, this.bus] });
        }
        this.voice('sine', midi(chord[0] - 12), t, SIX * 16, 0.04, { attack: 0.8, dest: [this.verb] });
      }
      // bajo: corcheas con la fundamental (octava 2), con respiración
      if (section !== 0 && s16 % 2 === 0) {
        const root = chord[0] - 24 + (s16 === 14 ? 7 : 0);
        this.voice('sawtooth', midi(root), t, SIX * 1.6, s16 % 4 === 0 ? 0.085 : 0.06, { cutoff: 380 });
      }
      // arpegio a semicorcheas, dos octavas, con eco
      if (arp) {
        const seq = [0, 1, 2, 1, 0, 2, 1, 2];
        const n = chord[seq[s16 % 8]] + (s16 >= 8 ? 12 : 0) + 12;
        this.voice('square', midi(n), t, SIX * 0.9, 0.022, { cutoff: 2000 + 600 * Math.sin(step / 40), dest: [this.bus, this.delay] });
      }
      // batería suave
      if (drums) {
        if (s16 === 0 || s16 === 8 || (section === 2 && s16 === 11)) this.voice('sine', 110, t, 0.28, 0.32, { slide: 42 });
        if (s16 === 4 || s16 === 12) { this.hit(t, 0.18, 0.12, 'bandpass', 1800, 0.7); this.voice('triangle', 190, t, 0.08, 0.05); }
        if (s16 % 2 === 0) this.hit(t, 0.04, s16 % 4 === 2 ? 0.05 : 0.025, 'highpass', 7500);
      }
      // melodía ocasional (sección completa): notas sueltas de la pentatónica
      if (section === 2 && (s16 === 0 || s16 === 6 || s16 === 10) && Math.random() < 0.55) {
        const n = PENTA[Math.floor(Math.random() * PENTA.length)];
        this.voice('triangle', midi(n), t, SIX * (s16 === 0 ? 6 : 3), 0.05, { attack: 0.03, dest: [this.bus, this.verb, this.delay] });
      }
    }
    // guitarra callejera: arpegio de púa, independiente del volumen de la banda sonora
    if (this.busk > 0.01 && s16 % 2 === 0) {
      const n = chord[(s16 / 2) % 3] + (s16 % 8 === 6 ? 12 : 0) - 12;
      this.pluck(midi(n), t, this.busk);
    }
  }

  private pluck(f: number, t: number, vol: number) {
    const ctx = this.ctx;
    // cuerda: ruido muy corto filtrado + armónicos que decaen deprisa
    for (const [mul, v] of [[1, 1], [2, 0.4], [3, 0.18]]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f * mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.09 * vol * v, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9 / mul);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 1);
    }
  }
}
