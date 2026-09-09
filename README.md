# Point Cloud Music Visualizer

Visualizador de música en realidad mixta para **Meta Quest 3**, construido con
[Immersive Web SDK](https://github.com/facebook/immersive-web-sdk) sobre WebXR.

Una nube de 1800 puntos flota en tu cuarto y reacciona en tiempo real al audio:
los graves empujan la base de la esfera, los agudos chispean en la cúpula. Se
puede agarrar con las manos, redimensionar, y alternar entre passthrough y VR
inmersivo desde paneles espaciales.

---

## Qué hace

- **Nube de puntos audio-reactiva** — 1800 puntos sobre un cascarón esférico.
  Tamaño, color, brillo y desplazamiento radial modulados por el espectro de audio.
- **Espectro espacializado** — la altura de cada punto determina su banda de
  frecuencia. La esfera funciona como un analizador de espectro esférico.
- **Detección de beat** — el golpe de bombo dispara un destello y un pulso radial.
- **Color arcoíris rotatorio** — el tono viene de altura + tiempo; el audio nunca
  toca el tono, solo saturación y brillo.
- **Dos paneles espaciales** (UIKitML) — reproducción y sensibilidad en uno,
  tamaño de esfera y modo de inmersión en el otro.
- **Esfera agarrable** — grab por proximidad con el botón *grip*.
- **Passthrough ↔ VR** — cambio de session mode en caliente.

## Stack

| Pieza | Para qué |
|---|---|
| [IWSDK](https://github.com/facebook/immersive-web-sdk) `0.5.3` | Runtime WebXR, ECS, sistema de entrada, assets |
| Three.js (`super-three` r181) | Render. Se importa desde `@iwsdk/core`, nunca desde `three` |
| UIKitML + kit Horizon | Paneles espaciales declarativos |
| Web Audio API | `AnalyserNode` + `getByteFrequencyData` |
| Vite 7 + TypeScript | Build y dev server con HTTPS |

## Requisitos

- Node.js `>=20.19` / `>=22.12` / `>=24`
- Meta Quest 3 (o cualquier visor con navegador compatible con WebXR)
- Para probar sin visor: el emulador **IWER** viene inyectado en modo dev

## Arranque

```bash
npm install
npm run dev:runtime
```

El servidor queda en `https://localhost:8081/` — **HTTPS es obligatorio**, WebXR
solo funciona en un secure context. El certificado es autofirmado, así que el
navegador va a advertir la primera vez.

> **Nota:** `npm run dev` levanta además un navegador gestionado con el editor
> visual de escenas. Si ese navegador no arranca en tu máquina, el comando se
> cae entero y te quedás sin servidor. `npm run dev:runtime` levanta solo el
> runtime y es suficiente para desarrollar.

### Probar en el Quest 3

**Por Wi-Fi** — el visor y la PC en la misma red:

1. Averiguá la IP local de la PC (`ipconfig` en Windows, `ifconfig` en macOS/Linux).
2. En el navegador del Quest, entrá a `https://TU_IP:8081/` (con `https://`).
3. Aceptá la advertencia de certificado: **Advanced → Proceed**.
4. Tocá **Enter XR**.

Si no carga, lo más probable es el firewall. En Windows, como administrador:

```powershell
New-NetFirewallRule -DisplayName "IWSDK dev 8081" -Direction Inbound -LocalPort 8081 -Protocol TCP -Action Allow
```

**Por USB** — más confiable, y evita el problema de redes con aislamiento de
clientes:

```bash
adb reverse tcp:8081 tcp:8081
```

Después entrá a `https://localhost:8081/` desde el visor. Como bonus, esa URL
coincide con el nombre del certificado.

## Controles

| Acción | Entrada |
|---|---|
| Botones y sliders de los paneles | **Gatillo** (raycast) |
| Agarrar y mover la esfera | **Grip** (proximidad — acercá la mano) |

La esfera **no** es `RayInteractable` a propósito: si lo fuera, se comería el
rayo del gatillo antes de que llegara a los paneles.

## Cómo funciona la audio-reactividad

### El grafo de audio

```
HTMLAudioElement → MediaElementAudioSourceNode → AnalyserNode → destination
```

`fftSize: 512` da 256 bins hasta ~24 kHz, pero **solo se usan los primeros 96**
(~0–9 kHz). Casi toda la energía musical vive abajo de 8 kHz; usar los 256
dejaría dos tercios de la nube en silencio permanente.

El `AudioContext` se construye en el primer click, no en el constructor: los
navegadores lo crean `suspended` hasta que hay un gesto del usuario, y armarlo
antes deja un contexto muerto que nunca produce datos.

### Reparto CPU / GPU

Este es el punto de diseño central del proyecto.

**La CPU escribe un solo float por punto y por frame**: `aEnergy`, la energía de
la banda de frecuencia que le toca a ese punto. Nada más.

**El vertex shader deriva todo lo demás** a partir de ese valor y del tiempo:
empuje radial, tamaño en píxeles, color arcoíris, rotación y destello del beat.

Con 500 puntos daba igual hacerlo en JS. Con 1800 no: calcular HSL→RGB por punto
y por frame son ~160.000 conversiones por segundo a 90 fps, y encima habría que
resubir tres arrays en vez de uno.

### El mapeo altura → frecuencia

La altura de cada punto elige su bin del FFT, con una curva cuadrática — los
primeros bins concentran casi toda la energía musical, así que darles más puntos
reparte mejor el movimiento a lo largo de la esfera.

Los puntos de abajo escuchan los graves; los de arriba, los agudos. El bombo
empuja la base y los hi-hats chispean en la cúpula.

### El tamaño de los puntos

`gl_PointSize` se expresa en píxeles del framebuffer, así que la escala se deriva
de la matriz de proyección en vez de inventar un factor:

```glsl
float pixelsPerMeter =
  projectionMatrix[1][1] * uViewportHeight * 0.5 / -mvPosition.z;
```

`projectionMatrix[1][1]` es `1 / tan(fov/2)`. Con un factor inventado el tamaño
queda atado al fov y a la resolución: lo que se ve bien en desktop desaparece en
el visor, que tiene otra densidad de píxeles.

### La detección de beat

Un golpe no es "hay mucho grave", es **"hay más grave que hace un momento"**.
Un umbral fijo fallaría en cuanto cambia el volumen o el track; el detector
compara la energía de los bins 0–5 contra un promedio móvil lento que se adapta
solo a cada canción.

El cooldown de 160 ms evita que un solo bombo, que dura varios frames por encima
del umbral, dispare diez beats seguidos.

### Por qué el audio no toca el tono

El tono sale de **altura + tiempo**; el audio modula saturación, brillo, tamaño y
radio. Si el audio moviera el tono, la nube cambiaría de paleta entera en cada
golpe y se leería como ruido de color en vez de música.

## Estructura

```
iwsdk.config.json                        Autoridad del proyecto: escena, assets, features XR
src/
  index.ts                               World.create() + registro de sistemas
  assets.ts                              defineAssets() — catálogo compartido runtime/editor
  components.ts                          defineComponents() — catálogo de componentes ECS
  point-cloud-component.ts               Componente PointCloud (sensitivity, scale)
  point-cloud.ts                         PointCloudSystem — análisis de audio y beat
  audio-analyser.ts                      Web Audio: reproducción, playlist, AnalyserNode
  panel.ts                               PanelSystem — sesión XR y selector de modo
  scene-assets/
    point-cloud.scene-asset.ts           Geometría y shaders de la nube
public/
  scenes/main.iwsdk.scene.json           Composición: qué nodos, dónde, con qué componentes
  ui/welcome.uikitml                     Panel de audio
  ui/scene-panel.uikitml                 Panel de escena
  audio/music/                           Pistas
```

Convención de IWSDK: **la geometría estática vive en TypeScript, la composición
en JSON**. El scene JSON nunca declara URLs, geometría ni materiales — solo IDs
del manifest.

## Parámetros para toquetear

Todos como `uniforms` al final de [`point-cloud.scene-asset.ts`](src/scene-assets/point-cloud.scene-asset.ts):

| Uniform | Default | Qué hace |
|---|---|---|
| `uSizeRest` | `0.009` | Tamaño del punto en reposo (metros) |
| `uSizeGain` | `0.032` | Cuánto crece con energía máxima |
| `uRadialGain` | `0.6` | Cuánto se aleja del centro en el pico |
| `uSpinSpeed` | `0.16` | Radianes por segundo de giro |
| `uRainbowSpeed` | `0.075` | Vueltas de arcoíris por segundo |

`POINT_COUNT` (1800) está arriba del mismo archivo. Los umbrales del beat
(`1.28`, `0.18`, `0.16`) están juntos en `detectBeat()` de
[`point-cloud.ts`](src/point-cloud.ts).

## Trampas encontradas en el camino

Cosas que fallan en silencio y costaron encontrar. Quedan documentadas porque
ninguna da un error útil:

- **`encodeURIComponent` en la URL del mp3** convierte la coma en `%2C`, y con
  eso el middleware estático de Vite deja de matchear el archivo y cae al
  fallback de `index.html`. El `<audio>` recibe `text/html` con status **200** y
  falla con `"no supported sources"` — un error que no menciona ni la URL ni un
  404. Se usa `encodeURI`.

- **El parser de UIKitML no soporta comentarios CSS** `/* ... */` dentro de
  `<style>`: descarta la regla que los sigue, sin warning.

- **`setProperties({ text })` sobre un `<ButtonLabel>` no hace nada** — es un
  contenedor. El texto tiene que ir en un `<span>` con id propio.

- **`queries.x.subscribe('qualify')` solo dispara para entidades que califican
  después de suscribirse.** Los sistemas se registran en el `.then()` de
  `World.create()`, o sea con la escena ya cargada: el callback nunca corre para
  las entidades del scene JSON. `update()` reintenta el enlace.

- **El `InputSystem` solo calcula BVH para objetos `isMesh`.** Un `Points` no
  tiene raycast confiable, así que el grab necesita una malla como asa. No sirve
  `visible = false` — three saltea los objetos invisibles al raycastear; hay que
  usar `colorWrite: false`.

- **Las unidades numéricas de UIKitML son centímetros**, no píxeles. Un panel de
  `width: 344` mide 3.44 m.

## Audio — hay que poner el tuyo

**El repo no incluye pistas.** Las usadas durante el desarrollo son material con
copyright, así que `public/audio/music/*.mp3` está en el `.gitignore`. Recién
clonado, el visualizador levanta y renderiza, pero no suena nada hasta que
agregues audio.

1. Copiá uno o más `.mp3` en `public/audio/music/`.
2. Actualizá el array `TRACKS` en [`audio-analyser.ts`](src/audio-analyser.ts)
   con los nombres exactos, extensión incluida.

```ts
export const TRACKS = [
  'mi-cancion.mp3',
  'otra-cancion.mp3',
];
```

Los nombres pueden tener espacios, comas y paréntesis: la URL se arma con
`encodeURI`, que los maneja bien.

Para que la reactividad luzca, sirve música con graves marcados y transientes
claros — el detector de beat mira los bins de 0 a ~560 Hz.

## Licencia

MIT para el código. El scaffold base viene de
[`@iwsdk/create`](https://www.npmjs.com/package/@iwsdk/create) (Meta Platforms, MIT).
