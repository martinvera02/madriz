# Plan de actuación: monumentos, plazas, puentes e interiores

Plan de trabajo para la siguiente tanda de mejoras de MADRIZ. Cada bloque dice qué hay ahora en el juego,
qué se quiere conseguir y cómo se va a hacer con el sistema actual (`iconic.ts` para los modelos propios,
`facadeKit.ts` para las fachadas en relieve, `water.ts` para el agua, `interiors.ts` para los interiores).

Coordenadas en metros del mapa (origen en el Kilómetro Cero, x hacia el este, z hacia el sur).

## Orden propuesto

| # | Bloque | Por qué en este orden |
|---|---|---|
| ✅ | Agua: fuentes, estanques y Manzanares | Base para Madrid Río, Colón y Plaza de España |
| 1 | Plaza Mayor | La plaza más visitada; ya tiene soportales, falta lo que la hace reconocible |
| 2 | Plaza de España y paseo a Sabatini | Pide datos nuevos (túneles) y cambia la circulación |
| 3 | Puentes de Madrid Río | Se apoya en el río recién hecho |
| 4 | Almudena, Puertas de Toledo y San Vicente, Colón | Modelos propios uno a uno |
| 5 | Atocha y Príncipe Pío | Fachadas y entorno (glorietas, marquesinas, accesos) |
| 6 | Más fachadas emblemáticas | Repaso de la lista de edificios con nombre |
| 7 | Interiores emblemáticos | En curso: ✅ Mercado de San Miguel, ✅ Chocolatería San Ginés; faltan jardín de Atocha, azotea del Círculo, Almudena y Palacio Real |

---

## 1. Plaza Mayor (−325, 95)

**Ahora:** soportales de granito, balcones de forja y cubiertas de pizarra en los edificios de la plaza;
chapiteles en las torres de la Casa de la Panadería.

**Falta:**
- **Estatua ecuestre de Felipe III** en el centro, sobre su pedestal.
- **Pinturas de la fachada de la Casa de la Panadería** (Carlos Franco, 1992): figuras mitológicas sobre fondo
  ocre entre los balcones. Se hará como textura propia, sin copiar el mural: colores y composición inspirados,
  no una reproducción.
- **Los nueve arcos de acceso**, sobre todo el **Arco de Cuchilleros** con su escalinata hacia la Cava de San Miguel.
- **Suelo de adoquín** de la plaza con el dibujo de cuadros de granito, faroles de forja y terrazas con
  sombrillas en los soportales.
- La **Casa de la Carnicería**, enfrente, con las mismas torres con chapitel.

## 2. Plaza de España y paseo hacia los Jardines de Sabatini (−746, −712)

**Ahora:** la plaza es una gran zona verde con el Edificio España y la Torre de Madrid con fachadas propias.
**Los túneles no existen en el juego**: el programa que descarga los datos de OpenStreetMap
(`tools/fetch-data.mjs`) descarta las vías en túnel.

**Objetivo:** la plaza tras la reforma de 2021: el tráfico de la calle Bailén y la Cuesta de San Vicente pasa
por debajo, y la plaza enlaza a pie, a nivel, con el paseo que baja hacia los Jardines de Sabatini y el Palacio Real.

**Cómo:**
1. Cambiar `fetch-data.mjs` para conservar las vías `tunnel=yes` con su `layer`, y volver a generar los datos.
2. Calzada en túnel: trinchera con muros, techo de hormigón y bocas con su pretil. El tráfico y el GPS las
   usan como cualquier calle; la cámara no pasa por debajo del techo.
3. Encima: paseo peatonal continuo con la pérgola, los estanques nuevos y el **Monumento a Cervantes**
   (don Quijote y Sancho a caballo, con su estanque delante).
4. Revisar que la policía y los peatones no queden atrapados en las bocas.

## 3. Puentes de Madrid Río

Puentes dentro del mapa:

| Puente | Posición | Cómo es |
|---|---|---|
| Puente del Rey | (−1560, −239) | Puente histórico de piedra, peatonal, junto a la entrada a la Casa de Campo |
| Puente de Segovia | (−1639, 305) | El más antiguo (Juan de Herrera, siglo XVI): nueve arcos de granito |
| Puente de Segovia Norte | (−1558, 286) | Pasarela moderna |
| Puente Oblicuo | (−1561, 677) | Pasarela de acero en diagonal sobre el río |
| Puente del Principado de Andorra | (−1601, 1246) | Pasarela |
| Puente de San Isidro | (−1452, 1405) | Puente de tráfico |
| Pasarela Aniceto Marinas | (−1649, −572) | Pasarela de Príncipe Pío |

**Ahora** los puentes son tablero plano sobre el agua, sin arcos ni pilas.

**Cómo:** un generador de puentes por tipo, colocado sobre la geometría real de OSM:
- **De fábrica** (Segovia, del Rey): arcos de medio punto de granito, pilas con tajamares, pretil de piedra y
  farolas fernandinas.
- **Pasarelas modernas**: tablero fino, barandilla de acero, apoyos esbeltos.
- **De tráfico**: tablero de hormigón con aceras y pretil.

El agua pasa por debajo de los arcos (la lámina del río ya existe).

## 4. Catedral de la Almudena, Puertas de Toledo y San Vicente, Plaza de Colón

### Catedral de la Almudena (−969, 66)

**Ahora:** volumen de OSM con fachada clásica genérica y una cúpula añadida.

**Objetivo:** la catedral reconocible desde la Plaza de la Armería y desde la calle Bailén:
- Fachada principal neoclásica hacia el Palacio Real, con pórtico, dos torres campanario y las estatuas
  en lo alto.
- Cúpula sobre tambor octogonal con linterna, bien proporcionada respecto a la nave.
- Pizarra gris en las cubiertas y piedra clara en los muros.
- Escalinata y atrio, y la cripta neorrománica (solo el volumen exterior) por la calle Mayor.

**Cómo:** modelo propio en `iconic.ts` sobre la planta real (como la Puerta de Alcalá), ocultando las partes de OSM.

### Puerta de Toledo (−686, 1105)

**Ahora:** volumen genérico de 19 m.

**Objetivo:** arco triunfal neoclásico de granito (1817–1827):
- Gran arco central de medio punto y dos vanos laterales adintelados.
- Columnas y pilastras.
- Grupo escultórico en el remate.
- Glorieta con su tráfico alrededor.

### Puerta de San Vicente (−1427, −394)

**Ahora:** volumen genérico.

**Objetivo:** puerta barroca de granito (la actual es una reconstrucción de 1995 de la de Sabatini):
- Arco central con pilastras y frontón.
- Trofeos y escudo en el remate.
- Colocada en la glorieta, frente a Príncipe Pío.

### Plaza de Colón (≈ 1112, −945)

**Ahora:** las Torres de Colón (106 m) y el Centro Colón son volúmenes de OSM, y el monumento no tiene modelo.

**Objetivo:**
- **Monumento a Colón:** columna neogótica con la estatua en lo alto.
- **Torres de Colón:** las dos torres colgadas de su núcleo, con el remate verde característico.
- **Jardines del Descubrimiento:** los grandes bloques de hormigón con relieves.
- **Bandera de España** en su mástil gigante.
- Acceso al Teatro Fernán Gómez bajo la plaza.

## 5. Atocha (≈ 971–1373, 1026–1313) y Príncipe Pío (−1313, −509)

**Atocha:**
- **Fachada histórica** (1892): el gran arco de hierro y cristal de la marquesina entre dos pabellones de
  ladrillo y piedra con cúpulas.
- **Glorieta de Carlos V** con su tráfico.
- **Estación nueva** (1992): el cilindro de acceso y su reloj, y las cubiertas de las vías.

**Príncipe Pío:**
- La **marquesina de hierro** del antiguo andén.
- El **edificio de viajeros** de ladrillo con sus torreones.
- La **explanada** y el acceso al intercambiador.
- Su relación con la Puerta de San Vicente y la bajada a Madrid Río.

## 6. Más fachadas emblemáticas

Ya tienen fachada propia: Casa de Correos, Metrópolis, Telefónica, Edificio España, Torre de Madrid, Capitol,
Palacio de Cibeles, Palacio Real, Plaza Mayor y los clásicos de cornisa y balaustrada (Banco de España, Círculo,
Teatro Real, Casino…).

**Siguientes candidatos:**
- Real Basílica de San Francisco el Grande
- Palacio de Santa Cruz
- Casa de la Villa
- Congreso de los Diputados (leones y pórtico)
- Edificio Vitalicio, Palacio de la Prensa y Palacio de la Música
- Teatro Español
- Real Academia de Bellas Artes de San Fernando
- El Corte Inglés de Callao
- Palacio de Linares (Casa de América)

---

## 7. Propuesta de interiores

Hoy los interiores son locales pequeños de una sala: bares y tiendas. Se proponen dos grupos.

**Con juego** (aportan algo a las misiones o a la economía):

| Interior | Qué aportaría |
|---|---|
| **Piso franco en Lavapiés** | Tu casa: guardar partida, cambiar de ropa, cama para pasar la noche |
| **Armería Montera** | Mostrador con las armas a la vista en vez del menú en la calle |
| **Taller de Embajadores** | Entrar con el coche, puente elevador; base para pintar coches |
| **Estación de Sol** (vestíbulo de metro y Cercanías) | Primer paso hacia el metro como viaje rápido |
| **Comisaría** | Si te detienen apareces aquí (además del hospital al morir) |

**Emblemáticos para recorrer:**

| Interior | Qué tiene |
|---|---|
| **Mercado de San Miguel** | Estructura de hierro y cristal, puestos y gente comiendo; encaja con la misión 1 |
| **Jardín tropical de Atocha** | La antigua nave de la estación con palmeras y estanque |
| **Chocolatería San Ginés** | Pequeño, muy reconocible, churros a cualquier hora |
| **Azotea del Círculo de Bellas Artes** | Mirador con la Minerva y vistas a Alcalá y Gran Vía |
| **Catedral de la Almudena** | La nave con su techo de colores |
| **Palacio Real** | La escalera principal y el Salón del Trono |

Recomendación para empezar: **piso franco, Mercado de San Miguel, jardín tropical de Atocha y la Estación de Sol**.
Dan una casa al jugador, dos sitios muy reconocibles y abren la puerta al metro.
