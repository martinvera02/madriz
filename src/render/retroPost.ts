import * as THREE from 'three';

/*
 * Render "retro urbano": la escena se pinta a una resolución interna reducida y se amplía con
 * píxel duro (como una consola de principios de los 2000), y después pasa por un único pase de color:
 *   - tone mapping ACES y gradación hacia la paleta de la dirección artística
 *     (sombras azul noche #202B3A, medios gris azulado #536477, luces cálidas #D4C29A / #B75B32),
 *   - un poco de desaturación, tramado ordenado 4×4 con profundidad de color reducida,
 *   - grano de película, viñeta y un leve sangrado cálido de las luces.
 * Un solo render target y un quad a pantalla completa: sin dependencias y más barato que pintar a resolución nativa.
 */

export const RETRO_PRESETS = [
  { name: 'Retro', scale: 0.5 },
  { name: 'Retro fuerte', scale: 0.34 },
  { name: 'Nítido', scale: 1 },
] as const;

export class RetroRenderer {
  private target: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly uniforms = {
    tScene: { value: null as THREE.Texture | null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uNight: { value: 0 },
    uExposure: { value: 1.05 },
    uLevels: { value: 40 },
    uWet: { value: 0 },
  };
  preset = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.target = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    this.uniforms.tScene.value = this.target.texture;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform vec2 uRes;
        uniform float uTime, uNight, uExposure, uLevels, uWet;
        varying vec2 vUv;

        vec3 aces(vec3 x) {
          const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }
        vec3 toSRGB(vec3 c) {
          return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
        }
        float bayer(vec2 p) {
          vec2 q = mod(floor(p), 4.0);
          int i = int(q.x + q.y * 4.0);
          float m[16];
          m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0; m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
          m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0; m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
          for (int k = 0; k < 16; k++) if (k == i) return m[k] / 16.0 - 0.5;
          return 0.0;
        }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

        void main() {
          vec3 hdr = texture2D(tScene, vUv).rgb;
          // sangrado cálido de las luces intensas (farolas, escaparates, faros): 4 muestras vecinas
          vec2 px = 1.0 / uRes;
          vec3 glow = vec3(0.0);
          for (int k = 0; k < 4; k++) {
            vec2 o = vec2(k < 2 ? (k == 0 ? 2.0 : -2.0) : 0.0, k >= 2 ? (k == 2 ? 2.0 : -2.0) : 0.0) * px;
            vec3 s = texture2D(tScene, vUv + o).rgb;
            glow += max(s - 1.1, 0.0);
          }
          hdr += glow * 0.18 * vec3(1.0, 0.85, 0.65);

          vec3 col = aces(hdr * uExposure);
          float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));

          // Gradación: sombras hacia azul noche, medios hacia gris azulado, luces conservan el calor
          // (valores en espacio lineal)
          vec3 shadowTint = vec3(0.014, 0.024, 0.041);   // #202B3A
          vec3 midTint    = vec3(0.087, 0.127, 0.184);   // #536477
          vec3 hiTint     = vec3(0.658, 0.521, 0.325);   // #D4C29A
          float sh = 1.0 - smoothstep(0.0, 0.45, lum);
          float hi = smoothstep(0.55, 1.0, lum);
          col = mix(col, col * 0.7 + shadowTint * 0.9, sh * 0.6);
          col = mix(col, col * 0.85 + midTint * 0.6 * lum, (1.0 - sh - hi) * 0.5);
          col = mix(col, col * 0.88 + hiTint * 0.14, hi * 0.6);
          // desaturar (más de noche), sin tocar los colores muy saturados de las luces
          float sat = mix(0.78, 0.68, uNight);
          float maxc = max(col.r, max(col.g, col.b)), minc = min(col.r, min(col.g, col.b));
          float vivid = smoothstep(0.35, 0.7, maxc - minc) * smoothstep(0.4, 0.8, maxc);
          col = mix(vec3(lum), col, mix(sat, 1.05, vivid));
          // contraste en S, negros levantados (nunca negro puro: #171A20)
          vec3 cs = sqrt(col);                                  // curva en S en espacio perceptual
          cs = cs * cs * (3.0 - 2.0 * cs) * 0.4 + cs * 0.6;
          col = cs * cs;
          col = max(col, vec3(0.008, 0.010, 0.014));            // negro carbón #171A20, nunca negro puro

          vec3 outc = toSRGB(clamp(col, 0.0, 1.0));
          // profundidad de color reducida con tramado ordenado (en píxeles de la resolución interna)
          vec2 ip = vUv * uRes;
          outc += bayer(ip) / uLevels;
          outc = floor(outc * uLevels + 0.5) / uLevels;
          // grano
          float g = hash(ip + fract(uTime) * 97.0) - 0.5;
          outc += g * mix(0.035, 0.06, uNight);
          // viñeta
          vec2 d = vUv - 0.5;
          outc *= 1.0 - dot(d, d) * mix(0.55, 0.85, uNight);
          gl_FragColor = vec4(outc, 1.0);
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.quad.frustumCulled = false;
    this.postScene.add(this.quad);
    this.resize();
  }

  get presetName() { return RETRO_PRESETS[this.preset].name; }

  cycle() {
    this.preset = (this.preset + 1) % RETRO_PRESETS.length;
    this.resize();
    return this.presetName;
  }

  resize() {
    const s = RETRO_PRESETS[this.preset].scale;
    const w = Math.max(160, Math.round(window.innerWidth * s));
    const h = Math.max(90, Math.round(window.innerHeight * s));
    this.target.setSize(w, h);
    this.uniforms.uRes.value.set(w, h);
    // menos niveles con más píxel: aspecto de 16 bits sin bandas exageradas
    this.uniforms.uLevels.value = s < 0.4 ? 28 : s < 0.9 ? 40 : 64;
  }

  render(scene: THREE.Scene, camera: THREE.Camera, dt: number, night: number) {
    const r = this.renderer;
    this.uniforms.uTime.value += dt;
    this.uniforms.uNight.value = night;
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCam);
  }
}
