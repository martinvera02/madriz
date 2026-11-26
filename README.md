# MADRIZ (título provisional)

Juego de mundo abierto estilo GTA ambientado en Madrid y su área metropolitana.
Three.js + TypeScript + Vite, se juega en el navegador.

## Arrancar

```bash
npm install
node tools/fetch-data.mjs centro   # descarga OSM + relieve → public/data/ (solo la primera vez, ~2 min)
npm run dev                        # abre http://localhost:5173
npm run build                      # build de producción en dist/
```

Parámetros de URL: `?hora=22` (0–24) para cambiar la hora de inicio (por defecto, el anochecer), `?lluvia` para empezar lloviendo, `?zona=centro` para elegir zona.

## Controles

| Tecla | Acción |
|---|---|
| WASD / flechas | Moverse / conducir |
| Ratón | Cámara (clic para capturar el puntero) |
| Shift | Correr |
| Espacio | Saltar / freno de mano (derrape) |
| F | Subir / bajar del coche (o robarlo si tiene conductor) |
| S | Frenar y, parado, marcha atrás |
| Q | Claxon |
| C | Mirar atrás (conduciendo) |
| L | Luces: automáticas → encendidas → apagadas |
| R | Enderezar el coche |
| V | Primera / tercera persona (a pie y al volante) |
| E | Empezar misión (marcador naranja) · armería · taller · hablar con la gente · entrar y salir de bares y tiendas · pedir en el mostrador (cuesta dinero) · echar una moneda a Lucía |
| 1–5 / rueda | Puños, bate, pistola, subfusil, escopeta |
| Clic derecho | Apuntar (cámara al hombro) / guardia con los puños |
| Clic izquierdo | Disparar / golpear |
| R (a pie) | Recargar |
| J | Lluvia sí / no |
| P | Imagen: retro → retro fuerte → nítida |
| M | Mapa completo: marcar destino y ruta más rápida (la música y el volumen están en la pausa) |
| N | Acelerar el reloj (x1 → x20 → x120) |
| H | Mostrar / ocultar ayuda |
| Esc | Pausa: continuar, guardar, cargar, nueva partida y opciones |

Mando (mapeo estándar): RT/LT acelerar/frenar, stick izquierdo dirección/andar, stick derecho cámara,
A freno de mano / saltar, X correr, Y subir/bajar, L3 o B claxon, R3 mirar atrás, Select enderezar,
Start pausa, cruceta arriba primera / tercera persona.

## Versión 0.11: minimapa inteligente, mapa completo y GPS

- **GPS** (`src/systems/navigation.ts`): A* sobre la red viaria real con montículo binario. En coche busca la
  ruta más **rápida** (tiempo según el tipo de vía y un pequeño coste por cruce) y respeta los sentidos únicos;
  a pie, la más corta por aceras, plazas y calles peatonales. Se recalcula sola cada segundo (o antes si cambia
  el destino o te subes/bajas del coche). Con una misión activa, la ruta lleva al objetivo de la misión.
- **Mapa completo** (tecla M, cruceta abajo en el mando): mover arrastrando o con WASD, zoom con la rueda o Q/E,
  clic para marcar destino, clic derecho para quitarlo, C para centrar. Nombres de calles según el zoom (sin
  solaparse), lugares de interés, misiones, armería, taller, bares y tiendas, tu coche y la policía, con leyenda,
  escala y el nombre de la calle bajo el ratón. Abrirlo pausa el juego.
- **Minimapa**: se aleja con la velocidad del coche, dibuja la ruta, distancia y tiempo estimado abajo, iconos
  propios (misión, objetivo, destino, armería, taller, bar, tienda, coche, policía) y deja en el borde solo lo
  importante cuando cae fuera.
- La tecla M deja de cambiar la música: música y volumen están en el menú de pausa.

## Versión 0.10: misiones, armería y taller

- **Sistema de misiones** (`src/systems/missions.ts`): marcadores naranjas en el mapa, el minimapa y la brújula;
  se empiezan con E. Rótulo de inicio, diálogo de quien te da el encargo, objetivo abajo, contrarreloj,
  marcador de destino y rótulos de misión superada / fallida. Si fallas (o caes), el marcador vuelve a aparecer.
  El progreso se guarda con la partida; no se puede guardar a mitad de misión.
  1. **El primer recado** (Paco, Puerta del Sol): consigue un coche, recoge un paquete en el Mercado de San Miguel
     y entrégalo en la plaza de Lavapiés en menos de 2:40. 150 €.
  2. **Cobro pendiente** (Paco, Tirso de Molina): el Rata está en Cascorro, huye corriendo; hay que darle un
     escarmiento sin matarlo y cobrar. 300 €.
  3. **Coche caliente** (Lola, plaza de Lavapiés): roba un deportivo rojo en la plaza de España (salta la alarma:
     1 estrella), pierde a la policía y llévalo al taller de Embajadores. Hasta 500 € según cómo llegue el coche.
- **Armería Montera** (marcador azul, calle de la Montera): bate, subfusil, escopeta, munición y botiquín.
  Menú con W/S, E compra, Q sale. Una partida nueva empieza solo con puños y pistola.
- **Taller de Embajadores** (marcador verde): entra con el coche y pulsa E: reparación y matrícula nueva por 120 €,
  y la policía deja de buscarte.

## Versión 0.9: partida guardada y pausa

- **Guardar y cargar.** Se guarda en el navegador (localStorage): posición, vida, dinero, armas y munición, hora,
  lluvia y tiempo jugado, más un hueco `progress` para las misiones. Guardado automático cada 2 minutos, al pausar
  y al cerrar la pestaña. No se puede guardar con estrellas de búsqueda ni estando KO; dentro de un local se guarda
  en la puerta.
- **Pantalla de inicio** con «Continuar» (fecha, tiempo jugado y dinero de la partida) y «Nueva partida».
- **Menú de pausa** (Esc o Start): continuar, guardar, cargar la última partida, nueva partida (pide confirmación)
  y opciones que se recuerdan: volumen, sensibilidad del ratón, invertir eje vertical, música e imagen.
  La pausa congela la simulación y el audio.

## Versión 0.8: policía, dinero, recargas y sonido real de armas

- **Nivel de búsqueda (1–5 estrellas).** Disparar, herir, matar, atropellar, reventar coches o robar un coche
  patrulla sube el «calor»; si un agente lo ve, cuenta un 50 % más. Si nadie te ve durante 14 s, las estrellas
  parpadean y bajan solas. Al morir se borra la búsqueda (y el hospital te cobra el 40 % de lo que llevas).
- **Policía Municipal.** Patrullas blancas y azules con «POLICÍA MUNICIPAL», 092, puente de luces giratorias y
  sirena. Te persiguen por la red de calles (A* + seguimiento de la ruta, incluidas calles peatonales como Sol);
  los dos agentes bajan del coche, te dan el alto y disparan si vas armado, si tienes 2 estrellas o más, o si
  vas en coche. Puedes robar el patrulla (los agentes se quedan a pie).
- **Dinero.** Empiezas con 40 €. Pedir en un local cuesta dinero; quien cae suelta billetes y los agentes,
  munición. En el estanco o la administración de lotería, el décimo puede tocar.
- **Locales distintos.** Taberna de azulejos, taberna de barriles y jamones, cafetería, cervecería, farmacia,
  locutorio, peluquería, frutería, estanco/loterías, panadería, kebab (con su asador girando) y tienda de barrio,
  cada uno con su mostrador, su oferta y su personal que se mueve detrás de la barra.
- **Recargas animadas**, en tercera persona (mano al cinturón, cargador, corredera; la escopeta mete cartucho a
  cartucho y bombea) y en primera persona (el arma baja y gira, la mano libre va a por el cargador).
- **Sonido de armas grabado** (ver créditos), con tono aleatorio, filtrado por distancia y eco de calle.
- **Volante en primera persona corregido**: ahora gira hacia donde giras.
- **Armas en primera persona rehechas (0.8.1).** Modelos propios para la vista (corredera, alza y punto de mira,
  cargador, guardamanos, bombeo), agarre a dos manos con los dedos rodeando la empuñadura, apuntado por las miras
  y fogonazo en la boca del cañón. Las trazadoras salen ya del cañón y no del pecho (también en tercera persona
  mientras levantas el arma).

## Versión 0.7: vida en la calle, combate, locales y música

- **Animaciones** (`character.ts`): andar, correr, saltar, caer, sentarse, móvil, fumar, café, brazos cruzados, mirar alrededor,
  hablar gesticulando, saludar, manos arriba, cubrirse agachado, beber, tocar la guitarra, barrer, bailar, gritar, guardia,
  apuntar con pistola o arma larga, puñetazos alternos, batazo, patada, retroceso y reacción al golpe. Se mezclan con el andar
  y cada persona lleva su objeto en la mano (móvil, cigarro, café, caña, guitarra, escoba, armas).
- **Combate** (`systems/combat.ts`): puños y bate (cono delante, derriban), pistola, subfusil automático y escopeta de perdigones,
  con munición, recarga, dispersión, fogonazo, trazadoras, polvo en las paredes, marcador de impacto y retroceso de cámara.
  Los coches acumulan daño y pueden explotar. La gente reacciona: huye, se agacha o levanta las manos si le apuntas.
- **Vida del jugador**: barra de salud, atropellos, explosiones y disparos de la policía; regeneración lenta; «Has caído» y alta en el hospital.
- **Vecinos con rutina** (`systems/routines.ts`): Paco el quiosquero (7–21 h), Lucía la música callejera (tardes, con su guitarra sonando
  a tempo con la banda sonora), Don Manuel el de los cupones (con pregones), Toni el barrendero (turno de noche, ruta), el Agente Ruiz
  de la Policía Municipal (patrulla; da el alto si oye tiros y dispara si sigues) y el abuelo Julián en su banco. Nombres sobre la cabeza
  y puntos en el minimapa.
- **Hablar (E)** con cualquier peatón: frases castizas, indicaciones, miedo si vas armado. Grupos de dos charlando por la calle.
- **Locales visitables** (`world/interiors.ts`): bares de azulejo con barra, grifo, cafetera, botellero, tele con el fútbol, tragaperras
  y parroquianos; tiendas 24 h con estanterías, neveras y dependiente. Se pide en la barra (recupera vida). Fundido al entrar y salir.
- **Música** (`systems/music.ts`): banda sonora procedural cyberpunk suave (pad, bajo, arpegio con eco, batería ligera, melodía
  ocasional) que sube en el coche y en los bares.
- **Ciclo de día y noche de 45 minutos.**

## Versión 0.5: dirección artística «sandbox urbano low-poly»

- **Render retro** (`src/render/retroPost.ts`): resolución interna reducida (50 % / 34 % / nativa con la tecla P),
  ampliación con píxel duro, tone mapping ACES y gradación hacia la paleta: azul noche `#202B3A`, gris azulado `#536477`,
  gris cemento `#858B91`, negro carbón `#171A20`, naranja oxidado `#B75B32` y amarillo cálido `#D4C29A`.
  Tramado ordenado 4×4, profundidad de color reducida, grano, viñeta y un leve resplandor cálido de las luces.
- **Atmósfera**: se empieza al anochecer; cielo encapotado con degradado y horizonte naranja oxidado, niebla azulada
  densa, noches frías y legibles, farolas cálidas, sombras duras. Lluvia con calzada mojada (más oscura y brillante, charcos de luz).
- **Materiales**: pavimentos a resolución contenida y filtrado sin suavizar; fachadas con churretones, manchas de humedad
  y colores apagados; escaparates y rótulos encendidos en los bajos al caer la tarde.
- **HUD**: brújula superior con marcador y distancia al último coche, reloj con estado del tiempo, velocímetro circular,
  etiquetas de interacción `[F] Robar compacto`, avisos breves, minimapa con la paleta, tipografía condensada.
- **Primera persona** (V): ojos del personaje con balanceo al andar y brazos a la vista; al volante, manos en el aro que giran con la dirección,
  cuadro de instrumentos iluminado y la cabeza que vuelve sola al frente.
- **Locales de barrio** (`src/world/shopfronts.ts`): rótulos con nombre (farmacia, bar, estanco, frutería, locutorio, kebab…),
  banderolas, toldos a rayas y escaparates con interior pintado en perspectiva que se enciende de noche.
- **Semáforos en la acera**: el poste se coloca a la derecha del acceso, fuera de cualquier calzada, y la línea de detención
  queda antes del borde de la calle que se cruza (en avenidas anchas estaba dentro del cruce).
- **Peatones solo en aceras y zonas peatonales**: se descarta cualquier aparición sobre una calzada.
- **Personajes nuevos** (`src/entities/character.ts`): proporciones humanas con torso por secciones, codos, rodillas, manos con pulgar,
  cara con nariz, orejas, ojos y cejas; ropa variada (camiseta, manga larga, sudadera con capucha, chaqueta abierta, chándal),
  pelo, gorra o gorro, barba, hombres y mujeres de distintas alturas y complexiones. Una sola malla con esqueleto por persona.
  Los conductores de los coches usan el mismo modelo, sentados.
- **Andar más suave**: cadencia según la zancada, rodillas y codos que se doblan, cadera y hombros en contraposición, cabeza estable;
  arranques y frenadas progresivos; la cámara sigue la altura con suavidad (bordillos, escalones) y el balanceo en primera persona es sutil.

## Versión 0.4: pavimentos, vehículos, conducción y sonido

- **Pavimentos de Madrid**: baldosa hidráulica gris de 20 × 20 cm de 4 pastillas en las aceras, losas de granito
  en plazas y peatonales anchas, adoquín de granito en el casco y calles de coexistencia, albero en los paseos.
  Mapa de materiales por trozo de suelo con bordes irregulares (`src/world/paving.ts`).
- **Aceras elevadas** 15 cm con bordillo de granito, medidas hasta la fachada; peatones y coches suben el bordillo.
- **9 modelos de vehículo** generados por perfil lateral real (pasos de rueda, lunas, interior, faros LED,
  matrículas españolas, llantas por tipo): utilitario, compacto, berlina, SUV, furgoneta, furgón, deportivo,
  **taxi de Madrid** (blanco, franja roja diagonal en las puertas delanteras con escudo encima y licencia debajo,
  módulo TAXI con luz verde) y **autobús EMT** de 12 m (azul, rótulo EMT Madrid, indicador LED de línea,
  tres puertas, gemelas traseras, carenado de gas natural). Colores con el reparto típico del parque español.
- **Física nueva para el jugador**: neumáticos con deriva (curva tipo Pacejka), círculo de fricción, transferencia
  de pesos, tracción delantera/trasera, cambio automático con RPM, freno motor, control de estabilidad suave,
  freno de mano para derrapar, suspensión visual, abolladuras en el punto del golpe y humo con el motor tocado.
- **Sonido procedural** (Web Audio, sin ficheros): tráfico, gente, pájaros y grillos, cláxones y sirenas lejanas,
  campanadas del reloj de Sol, motores por RPM y tipo (híbrido, diésel, V8, gas natural), derrapes, golpes,
  frenos de aire del autobús, pitido de los semáforos, pasos.

## Versión 0.2: Madrid real a escala 1:1

- **Trazado urbano real** de OpenStreetMap: todas las calles con su forma y su ancho (carriles/ancho OSM),
  sentidos únicos, glorietas, calles peatonales, escaleras, aceras, plazas, parques y el Manzanares.
- **Relieve real LiDAR** (MDT05 del IGN, 5 m); las cuestas (Bailén, Segovia, Atocha…) se notan al
  conducir: los coches cabecean, frenan cuesta arriba y pueden despegar en los cambios de rasante. Puentes con tablero propio.
- **~16.000 edificios** con su planta real y sus alturas por partes (datos de Catastro en OSM), patios incluidos.
  Fachada madrileña procedural: balcones con forja, persianas, bajos comerciales con rótulos, cornisas, teja árabe.
- **Edificios emblemáticos** con fachada y remates propios: Real Casa de Correos (torre del reloj),
  Metrópolis (cúpula y Victoria alada), Telefónica (relojes y antenas), Edificio España, Torre de Madrid,
  Capitol/Carrión (rótulo), Palacio Real, Palacio de Cibeles (pináculos), Banco de España, Almudena y
  San Francisco el Grande (cúpulas), Círculo de Bellas Artes (Minerva), Casa de la Panadería y Plaza Mayor,
  Prado, Atocha, Puerta de Alcalá (modelo con arcos), fuentes de Cibeles, Neptuno y Apolo, Oso y el Madroño,
  Mariblanca, estatuas ecuestres, Colón, Alfonso XII en el Retiro, Ángel Caído…
- **Tráfico** sobre el grafo viario real, por la derecha, respetando sentidos únicos. **Peatones** por aceras y calles peatonales.
- 8.700 árboles reales de OSM + arbolado de parques; farolas de OSM y a lo largo de las calles.
- HUD con el nombre de la calle o plaza donde estás y la altitud real.

Zona incluida: distrito Centro y alrededores (Plaza de España – Atocha, Manzanares – Retiro), ~4 × 3 km.

### Novedades 0.3

- **Quioscos, marquesinas y la bóveda de Cercanías de Sol** en vez de bloques de 5 plantas (OSM no trae su altura).
  Los edificios sin altura dentro de parques son pabellones de una planta.
- **Mobiliario urbano real de OSM**: ~1.500 bancos, ~1.100 papeleras, bolardos, 468 paradas de la EMT, 109 bocas de metro,
  fuentes de beber, buzones de Correos, BiciMAD y setos.
- **Semáforos reales** agrupados en cruces con fases; los coches se detienen en rojo y los peatones esperan para cruzar.
- **IA de tráfico**: persecución pura por la trayectoria, frenado en giros, ceder a peatones, maniobra para desatascarse,
  coches aparcados solo donde cabe. **Peatones**: esperan a que no venga nadie, se apartan entre ellos, se paran a ratos.
- **Calles**: bordillos de granito, asfalto con rodadas y parches, baldosa de acera, albero en los paseos, césped con detalle.
- **Vegetación con volumen**: copas de varias masas, coníferas por pisos, palmeras, arbustos, alcorques, viento.
- **Edificios genéricos**: cornisa volada, moldura, zócalo de granito e imposta en 3D; balcones con forja,
  alféizares y dinteles en relieve cerca del jugador; chimeneas, máquinas y depósitos en las azoteas.
  Las medianeras (paredes pegadas a otro edificio) no llevan detalle.

### Limitaciones conocidas

- El relieve es el MDT05 del IGN (LiDAR, malla de 5 m, alturas en metros enteros con un suavizado ligero).
  Es terreno desnudo: los puentes se reconstruyen a partir de OSM (tablero entre los estribos). Si el servicio
  WCS del IGN no responde, el script usa automáticamente las teselas globales (~30 m); también con `--terrarium`.
- Los túneles (M-30 soterrada, pasos inferiores) no se modelan.
- Las fachadas genéricas son procedurales: los emblemáticos tienen remates propios, pero no son réplicas exactas.

## Estructura

```
tools/fetch-data.mjs        descarga OSM (API 0.6) + relieve (terrarium) y genera public/data/<zona>.json/.bin
src/
  main.ts                   carga, bucle de juego, entrar/salir de coches, nombres de calles
  config.ts                 utilidades (RNG con semilla, ángulos…)
  world/
    realData.ts             formato de los datos y carga
    terrain.ts              relieve + suelo pintado (zonas, calles peatonales) + minimapa
    roads.ts                calzadas 3D, marcas viales, pasos de cebra, puentes (Ground = suelo + tableros)
    buildings.ts            extrusión de edificios con patios, colisiones por aristas
    buildingMaterial.ts     shader de fachadas (6 estilos)
    iconic.ts               fachadas y remates de los edificios emblemáticos, fuentes y estatuas
    props.ts                árboles y farolas
    collision.ts, sky.ts
  entities/  character.ts, player.ts, vehicle.ts (con pendientes y saltos)
  systems/   roadGraph.ts, traffic.ts, pedestrians.ts, cameraRig.ts, input.ts
  ui/hud.ts
```

## Datos y licencias

Calles, edificios y monumentos: © colaboradores de OpenStreetMap, licencia ODbL (hay que mantener la atribución).
Relieve: MDT05 © Instituto Geográfico Nacional, licencia CC BY 4.0 (alternativa: Mapzen Terrain Tiles, AWS Open Data).

Sonidos (`public/sfx/`, recortados y convertidos a MP3):
- Disparos (`pistola`, `subfusil`, `escopeta`): «Gunshot Sounds» de Tabasco en OpenGameArt.org
  (https://opengameart.org/content/gunshot-sounds). La página lo marca como CC0, pero el texto incluido indica
  © 2009 Vincent Sevedge, CC BY 3.0, así que se acredita igualmente.
- Recargas (`recarga-*`): «Gun reload sounds» de SpringySpringo en OpenGameArt.org, CC0
  (https://opengameart.org/content/gun-reload-sounds).
Si no cargan, el juego vuelve a los sonidos sintetizados.

## Depuración (consola del navegador)

```js
__madriz.tp(0, 0)            // teletransporte (metros desde el Kilómetro Cero; X = este, Z = sur)
__madriz.sky.time = 21       // cambiar la hora
__madriz.cam([x,y,z],[tx,ty,tz]) / __madriz.cam(null)   // cámara libre
```
