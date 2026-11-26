import * as THREE from 'three';

/**
 * Material de fachadas procedural. Cada vértice lleva:
 *   uv     = (metros a lo largo de la fachada, metros sobre la calle)  → las ventanas se alinean por plantas
 *   color  = color del revoco / ladrillo / piedra (o de la cubierta en los tejados)
 *   aInfo  = (estilo, altura del edificio, semilla)
 *
 * Estilos:
 *   0 madrileño: balcones con barandilla de forja, persianas, bajos comerciales, cornisa
 *   1 muro cortina de vidrio
 *   2 monumental de granito (Palacio Real, Telefónica): plantas altas, pilastras
 *   3 ladrillo visto con recercados de piedra (Casa de Correos, Prado, Atocha)
 *   4 piedra casi ciega (iglesias): hiladas y ventanales altos
 *   5 ornamental blanco (Metrópolis, Cibeles, Banco de España): pilastras y ventanas en arco
 *   6 rascacielos de los años 20 (Telefónica): machones verticales
 *   7 moderno de retícula (Torre de Madrid)
 *   8 bandas horizontales de vidrio y granito (Capitol)
 */
export const buildingUniforms = {
  uNight: { value: 0 },
};

export function createBuildingMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0.0, vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = buildingUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aInfo;
        varying vec3 vInfo;
        varying vec2 vFacade;
        varying float vRoof;
        varying vec3 vWPos;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vInfo = aInfo;
        vFacade = uv;
        vRoof = step(0.5, objectNormal.y);
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uNight;
        varying vec3 vInfo;
        varying vec2 vFacade;
        varying float vRoof;
        varying vec3 vWPos;
        // Hash estable: entradas enteras pequeñas para que el ruido de interpolación no lo dispare
        float hash21(vec2 p) {
          p = mod(floor(p + 0.5), 289.0);
          p = fract(p * vec2(0.1031, 0.1030));
          p += dot(p, p.yx + 33.33);
          return fract((p.x + p.y) * p.x);
        }
        float box(vec2 f, vec2 a, vec2 b) { return step(a.x, f.x) * step(f.x, b.x) * step(a.y, f.y) * step(f.y, b.y); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float litWin = 0.0;
        float shopGlow = 0.0;
        vec3 signGlow = vec3(0.0);
        vec3 wall = diffuseColor.rgb;
        float style = floor(vInfo.x + 0.5);
        float bH = vInfo.y;
        float seed = floor(vInfo.z * 10.0 + 0.5); // entero 0..100, idéntico en todo el edificio
        if (vRoof < 0.5) {
          vec2 uv = vFacade;
          float fw = length(fwidth(uv));
          float fine = 1.0 - smoothstep(0.02, 0.06, fw);   // detalles finos (ladrillo, barrotes)
          vec3 glass = vec3(0.09, 0.11, 0.13);
          vec3 col = wall;
          float win = 0.0;
          vec2 id = vec2(0.0);
          float groundH = style < 0.5 ? 4.2 : (style > 1.5 && style < 2.5 ? 5.5 : 4.5);
          float upper = step(groundH, uv.y);
          if (style < 0.5 || (style > 2.5 && style < 3.5)) {
            // Plantas tipo con balcón (madrileño) o recercados blancos (ladrillo + piedra)
            vec2 cell = vec2(3.0, 3.3);
            vec2 g = vec2(uv.x, uv.y - groundH) / cell;
            id = floor(g);
            vec2 f = fract(g);
            win = box(f, vec2(0.31, 0.06), vec2(0.69, 0.80)) * upper;
            if (style > 2.5) {
              // ladrillo: llagas y tendeles
              float brick = step(0.88, fract(uv.y / 0.075)) + step(0.94, fract((uv.x + step(0.5, fract(uv.y / 0.15)) * 0.12) / 0.24)) * 0.6;
              col *= 1.0 - brick * 0.12 * fine;
              float frame = box(f, vec2(0.25, 0.0), vec2(0.75, 0.88)) * upper * (1.0 - win);
              col = mix(col, vec3(0.88, 0.85, 0.78), frame);
            } else {
              // imposta entre plantas
              col *= 1.0 - step(0.965, f.y) * upper * 0.18;
              // recercado sutil
              col = mix(col, col * 1.12, box(f, vec2(0.27, 0.0), vec2(0.73, 0.86)) * upper * (1.0 - win));
            }
            float h = hash21(id + seed);
            // Persiana alicantina / de librillo: tapa parte de la ventana
            float shut = h * 0.75;
            vec3 shutCol = mix(vec3(0.55, 0.45, 0.32), vec3(0.33, 0.42, 0.33), step(0.7, hash21(vec2(seed, 3.0))));
            float shutter = step(1.0 - shut, (f.y - 0.06) / 0.74) * win;
            col = mix(col, glass, win);
            col = mix(col, shutCol * (0.85 + 0.15 * step(0.5, fract(uv.y * 6.0)) * fine), shutter);
            // Balcón: losa + barandilla de forja
            float rail = box(f, vec2(0.27, 0.06), vec2(0.73, 0.33)) * upper * step(0.25, hash21(vec2(seed, id.y + 7.0)));
            float bars = step(0.55, fract(uv.x * 9.0)) + box(f, vec2(0.0, 0.30), vec2(1.0, 0.33));
            col = mix(col, vec3(0.06, 0.06, 0.07), rail * mix(0.45, clamp(bars, 0.0, 1.0), fine) * 0.9);
            col = mix(col, col * 0.7, box(f, vec2(0.26, 0.035), vec2(0.74, 0.06)) * upper);
            litWin = win * (1.0 - shutter) * step(0.55, h);
          } else if (style < 1.5) {
            vec2 cell = vec2(1.6, 3.6);
            vec2 f = fract(uv / cell);
            id = floor(uv / cell);
            win = box(f, vec2(0.05, 0.1), vec2(0.95, 0.96));
            col = mix(col * 0.6, mix(vec3(0.25, 0.34, 0.42), wall, 0.25), win);
            litWin = win * step(0.6, hash21(id + seed));
          } else if (style < 2.5) {
            // Monumental: pilastras y ventanales
            vec2 cell = vec2(4.6, 5.2);
            vec2 g = vec2(uv.x, uv.y - groundH) / cell;
            id = floor(g);
            vec2 f = fract(g);
            float pil = (step(f.x, 0.11) + step(0.89, f.x)) * upper;
            col = mix(col, col * 1.1, pil);
            win = box(f, vec2(0.33, 0.12), vec2(0.67, 0.72)) * upper;
            col = mix(col, col * 0.82, box(f, vec2(0.29, 0.74), vec2(0.71, 0.84)) * upper); // frontón
            float gwin = box(fract(uv / vec2(4.6, groundH)), vec2(0.36, 0.0), vec2(0.64, 0.7)) * (1.0 - upper);
            col *= 1.0 - (1.0 - upper) * step(0.9, fract(uv.y / 0.5)) * 0.15; // almohadillado
            win = max(win, gwin);
            col = mix(col, glass, win);
            litWin = win * step(0.6, hash21(id + seed));
          } else if (style < 4.5) {
            // Piedra con hiladas y ventanales altos
            col *= 1.0 - step(0.93, fract(uv.y / 0.6)) * 0.12 - step(0.97, fract((uv.x + step(0.5, fract(uv.y / 1.2)) * 0.6) / 1.2)) * 0.08;
            vec2 cell = vec2(6.0, 9.0);
            vec2 f = fract(uv / cell);
            id = floor(uv / cell);
            vec2 c = (f - vec2(0.5, 0.62)) * cell;
            float arch = step(length(c), 0.75);
            win = (box(f, vec2(0.375, 0.2), vec2(0.625, 0.62)) + arch * step(0.62, f.y)) * step(4.0, uv.y);
            win = clamp(win, 0.0, 1.0);
            col = mix(col, vec3(0.12, 0.12, 0.16), win);
            litWin = win * 0.6;
          } else if (style > 5.5 && style < 6.5) {
            // Rascacielos de los años 20 (Telefónica): machones verticales continuos y antepechos oscuros
            vec2 cell = vec2(2.6, 3.6);
            vec2 g = vec2(uv.x, uv.y - groundH) / cell;
            id = floor(g);
            vec2 f = fract(g);
            float pier = (step(f.x, 0.16) + step(0.84, f.x)) * upper;
            win = box(f, vec2(0.2, 0.18), vec2(0.8, 0.92)) * upper;
            float spandrel = box(f, vec2(0.2, 0.0), vec2(0.8, 0.18)) * upper;
            col = mix(col, col * 1.12, pier);
            col = mix(col, col * 0.72, spandrel);
            col = mix(col, glass, win);
            litWin = win * step(0.55, hash21(id + seed));
          } else if (style > 6.5 && style < 7.5) {
            // Moderno (Torre de Madrid): retícula regular, sin balcones
            vec2 cell = vec2(1.9, 2.95);
            vec2 g = vec2(uv.x, uv.y - groundH) / cell;
            id = floor(g);
            vec2 f = fract(g);
            win = box(f, vec2(0.12, 0.3), vec2(0.88, 0.92)) * upper;
            col = mix(col, glass * 1.3, win);
            col *= 1.0 - step(0.96, f.y) * upper * 0.12;
            litWin = win * step(0.6, hash21(id + seed));
          } else if (style > 7.5 && style < 8.5) {
            // Expresionista / art déco (Capitol): bandas horizontales de vidrio y granito pulido
            float fy = fract((uv.y - groundH) / 3.4);
            id = vec2(floor(uv.x / 3.0), floor((uv.y - groundH) / 3.4));
            float band = step(0.42, fy) * upper;
            float mull = step(0.94, fract(uv.x / 1.5)) * band;
            col = mix(col, col * 1.06, (1.0 - band) * upper); // petos de piedra pulida
            col = mix(col, glass * 1.2, band * (1.0 - mull));
            win = band;
            litWin = band * (1.0 - mull) * step(0.5, hash21(id + seed));
          } else {
            // Ornamental: pilastras pareadas y ventanas con arco
            vec2 cell = vec2(3.8, 4.4);
            vec2 g = vec2(uv.x, uv.y - groundH) / cell;
            id = floor(g);
            vec2 f = fract(g);
            float pil = (box(f, vec2(0.0, 0.0), vec2(0.07, 1.0)) + box(f, vec2(0.93, 0.0), vec2(1.0, 1.0))) * upper;
            col = mix(col, col * 1.08, pil);
            vec2 c = (f - vec2(0.5, 0.62)) * cell;
            float arch = step(length(c), 0.62) * step(0.62, f.y);
            win = clamp(box(f, vec2(0.34, 0.1), vec2(0.66, 0.62)) + arch, 0.0, 1.0) * upper;
            col = mix(col, glass, win);
            col *= 1.0 - (1.0 - upper) * step(0.88, fract(uv.y / 0.6)) * 0.12;
            litWin = win * step(0.5, hash21(id + seed));
          }
          // Bajos comerciales (todos menos vidrio, iglesias y monumentales)
          if (style < 0.5 || (style > 2.5 && style < 3.5) || style > 4.5) {
            vec2 gc = vec2(uv.x / 4.0, uv.y / groundH);
            vec2 gf = fract(gc);
            float shop = box(gf, vec2(0.12, 0.0), vec2(0.88, 0.78)) * (1.0 - upper);
            float hs = hash21(floor(gc) + vec2(seed * 3.0, 11.0));
            vec3 shopCol = mix(glass * 1.4, vec3(0.32, 0.30, 0.28), step(0.75, hs)); // algunos con cierre metálico
            col = mix(col, shopCol, shop);
            // toldo / rótulo
            float sign = box(gf, vec2(0.1, 0.8), vec2(0.9, 0.93)) * (1.0 - upper) * step(0.45, hs);
            vec3 signCol = mix(vec3(0.55, 0.12, 0.10), vec3(0.12, 0.25, 0.35), step(0.7, hash21(floor(gc) + vec2(5.0, seed))));
            col = mix(col, signCol, sign);
            litWin = max(litWin, shop * step(0.3, hs) * 0.3);
            // de lejos, un interior sugerido: baldas, luz cenital y el suelo más oscuro
            float shelves = 0.55 + 0.45 * step(0.45, fract(gf.y * 6.0)) * step(0.3, gf.y);
            shopGlow = shop * step(0.3, hs) * step(hs, 0.75) * (0.45 + 0.35 * hash21(floor(gc) + vec2(2.0, seed))) * shelves * mix(0.5, 1.0, gf.y);
            signGlow = sign * signCol * 2.2 * step(0.55, hash21(floor(gc) + vec2(9.0, seed)));
          }
          // Cornisa y alero
          float cornice = step(bH - 0.9, uv.y) * step(8.0, bH);
          col = mix(col, wall * 1.18, cornice);
          col *= 1.0 - step(bH - 1.2, uv.y) * (1.0 - step(bH - 0.9, uv.y)) * step(8.0, bH) * 0.35;
          // Antialias: a lo lejos, color medio (evita el muaré)
          float aa = smoothstep(0.4, 1.1, fw);
          vec3 avg = mix(wall, glass, style > 0.5 && style < 1.5 ? 0.55 : 0.25);
          col = mix(col, avg, aa);
          litWin *= 1.0 - aa * 0.4;
          // Suciedad / oclusión a ras de suelo
          col *= mix(0.72, 1.0, clamp(uv.y / 5.0, 0.0, 1.0));
          // Desgaste: churretones verticales bajo las ventanas y manchas de humedad a gran escala
          float streak = hash21(vec2(floor(uv.x * 2.0), seed)) * (0.5 + 0.5 * fract(uv.y * 0.31 + hash21(vec2(floor(uv.x * 2.0), 3.0))));
          col *= 1.0 - 0.13 * streak * (1.0 - aa);
          float blot = hash21(floor(uv * vec2(0.18, 0.12)) + seed) * hash21(floor(uv * vec2(0.37, 0.23)) + seed + 7.0);
          col *= 1.0 - 0.16 * blot;
          col = mix(col, vec3(dot(col, vec3(0.3, 0.55, 0.15))), 0.18); // algo apagado, nada de colores de plástico
          diffuseColor.rgb = col;
        } else {
          // Cubierta: teja árabe (rojiza) o azotea
          float tile = step(diffuseColor.b + 0.08, diffuseColor.r);
          float ridges = step(0.5, fract(vWPos.x * 2.2 + vWPos.z * 0.6)) * tile;
          diffuseColor.rgb *= 1.0 - ridges * 0.12;
          diffuseColor.rgb *= 0.92 + 0.08 * hash21(floor(vWPos.xz * 0.5));
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.70, 0.38) * litWin * uNight * 0.45;
        // Escaparates y rótulos encendidos al caer la tarde: el color cálido de la calle
        totalEmissiveRadiance += (vec3(0.66, 0.48, 0.26) * shopGlow * 0.75 + signGlow * 0.7) * smoothstep(0.15, 0.6, uNight);`,
      );
  };
  return mat;
}
