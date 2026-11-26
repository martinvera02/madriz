/** Teclado + ratón con pointer lock. Usa `KeyboardEvent.code`, así funciona igual en teclado español. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  /** Mando (API Gamepad, mapeo estándar): ejes con zona muerta y gatillos 0..1. */
  pad = { connected: false, lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 };
  private padBtn: boolean[] = [];
  private padPrev: boolean[] = [];
  mouseDY = 0;
  wheel = 0;
  locked = false;

  constructor(private target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    target.addEventListener('click', () => this.lock());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === target;
    });
    // botones del ratón como teclas virtuales: Mouse0 (izquierdo), Mouse2 (derecho); rueda acumulada
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      const c = 'Mouse' + e.button;
      if (!this.down.has(c)) this.pressed.add(c);
      this.down.add(c);
    });
    window.addEventListener('mouseup', (e) => this.down.delete('Mouse' + e.button));
    window.addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });
    window.addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
  }

  /** Leer el mando: llamar al principio de cada frame. */
  poll() {
    const gp = navigator.getGamepads?.().find((g) => g && g.connected) ?? null;
    this.padPrev = this.padBtn;
    if (!gp) { this.pad.connected = false; this.padBtn = []; return; }
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    this.pad.connected = true;
    this.pad.lx = dz(gp.axes[0] ?? 0); this.pad.ly = dz(gp.axes[1] ?? 0);
    this.pad.rx = dz(gp.axes[2] ?? 0); this.pad.ry = dz(gp.axes[3] ?? 0);
    this.pad.lt = gp.buttons[6]?.value ?? 0; this.pad.rt = gp.buttons[7]?.value ?? 0;
    this.padBtn = gp.buttons.map((b) => b.pressed);
  }
  padDown(i: number) { return !!this.padBtn[i]; }
  padPressed(i: number) { return !!this.padBtn[i] && !this.padPrev[i]; }

  lock() {
    if (!this.locked) this.target.requestPointerLock?.();
  }

  isDown(code: string) { return this.down.has(code); }
  /** Pulsada en este frame (flanco de subida). */
  wasPressed(code: string) { return this.pressed.has(code); }

  axis(neg: string[], pos: string[]) {
    let v = 0;
    if (neg.some((c) => this.down.has(c))) v -= 1;
    if (pos.some((c) => this.down.has(c))) v += 1;
    return v;
  }

  /** Llamar al final de cada frame. */
  endFrame() {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
