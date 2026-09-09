/**
 * Nube de puntos audio-reactiva.
 *
 * Se exporta como un Object3D "prototipo" sin padre: IWSDK lo registra en el
 * manifest de assets (src/assets.ts) y la escena JSON lo instancia como un nodo
 * mas. Por eso este modulo tiene que ser puro — se evalua dos veces, una por el
 * runtime y otra por el editor, en realms de JS distintos. Nada de World, DOM,
 * timers ni estado compartido.
 *
 * Reparto de trabajo CPU/GPU
 * --------------------------
 * La CPU escribe UN solo float por punto y por frame: aEnergy, la energia de la
 * banda de frecuencia que le toca. Todo lo demas — empuje radial, tamano, color
 * rainbow y rotacion — lo deriva el vertex shader a partir de ese valor y del
 * tiempo.
 *
 * Con 500 puntos daba igual hacerlo en JS. Con 1800 no: calcular HSL a RGB por
 * punto y por frame son ~160.000 conversiones por segundo a 90 fps, y encima
 * habria que resubir tres arrays en vez de uno.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  ShaderMaterial,
  SphereGeometry,
} from '@iwsdk/core';

/** Cantidad de puntos. */
export const POINT_COUNT = 1800;

/** Radio de reposo de la esfera, en metros. */
export const BASE_RADIUS = 0.5;

/**
 * Distribucion de Fibonacci sobre la esfera.
 *
 * Usar Math.random() para los tres ejes agrupa los puntos en los polos y deja
 * huecos visibles. La espiral de Fibonacci reparte N puntos de forma casi
 * uniforme sobre la superficie, que es lo que hace que la nube se lea como un
 * objeto solido y no como ruido.
 */
function fibonacciDirection(
  index: number,
  count: number,
): [number, number, number] {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (index / (count - 1)) * 2;
  const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = goldenAngle * index;
  return [Math.cos(theta) * radiusAtY, y, Math.sin(theta) * radiusAtY];
}

/**
 * Ruido determinista a partir de un entero. Devuelve 0..1.
 * Reemplaza a Math.random() para que el prototipo sea reproducible entre los
 * dos realms que evaluan este modulo.
 */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const VERTEX_SHADER = /* glsl */ `
  attribute float aEnergy;
  attribute float aHue;

  uniform float uViewportHeight;
  uniform float uTime;
  uniform float uSizeRest;
  uniform float uSizeGain;
  uniform float uRadialGain;
  uniform float uSpinSpeed;
  uniform float uRainbowSpeed;
  uniform float uScale;
  uniform float uSensitivity;
  uniform float uBeat;

  varying vec3 vColor;

  /** HSL a RGB. Portado de la formula estandar; corre por vertice, no por pixel. */
  vec3 hsl2rgb(float h, float s, float l) {
    vec3 rgb = clamp(
      abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0,
      0.0,
      1.0
    );
    return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
  }

  void main() {
    // --- Rotacion ---
    // Se hace aca y no rotando el Object3D para no pelear con la sincronizacion
    // de transforms del ECS: el shader es dueno de la pose y nadie se la pisa.
    float angle = uTime * uSpinSpeed;
    float s = sin(angle);
    float c = cos(angle);
    vec3 spun = vec3(
      position.x * c + position.z * s,
      position.y,
      -position.x * s + position.z * c
    );

    // --- Empuje radial ---
    // 'position' ya es direccion * radio, asi que escalarlo empuja el punto
    // hacia afuera sobre su propio rayo desde el centro.
    // uScale lo maneja el slider del panel de escena. Va aca y no en el
    // transform de la entidad para no pelear con la sincronizacion del ECS, y
    // porque asi el tamano del PUNTO no escala con la esfera: los puntos se
    // separan pero siguen midiendo lo mismo, que es lo que hace que la esfera
    // grande se vea mas dispersa en vez de solo mas zoom.
    // 'drive' es la energia cruda amplificada por la sensibilidad, SIN recortar
    // a 1. Antes el recorte vivia en la CPU y con sensibilidad alta los graves
    // quedaban clavados en el tope: dejaban de moverse justo cuando mas fuerte
    // sonaban. Ahora subir la sensibilidad agranda el RECORRIDO, no solo el
    // punto de saturacion.
    float drive = aEnergy * uSensitivity;

    // uScale lo maneja el slider del panel de escena. Va aca y no en el
    // transform de la entidad para no pelear con la sincronizacion del ECS, y
    // porque asi el tamano del PUNTO no escala con la esfera: los puntos se
    // separan pero siguen midiendo lo mismo, que es lo que hace que la esfera
    // grande se vea mas dispersa en vez de solo mas zoom.
    vec3 pushed = spun * uScale * (1.0 + drive * uRadialGain + uBeat * 0.12);

    vec4 mvPosition = modelViewMatrix * vec4(pushed, 1.0);

    // --- Tamano en pixeles ---
    // gl_PointSize se expresa en pixeles del framebuffer, asi que la escala hay
    // que derivarla de la proyeccion en vez de inventar un factor:
    //
    //   projectionMatrix[1][1] = 1 / tan(fov/2)
    //
    // Por media altura de viewport y dividido por la profundidad, da cuantos
    // pixeles mide un metro a esa distancia. Con un factor inventado el tamano
    // queda atado al fov y a la resolucion: lo que se ve bien en desktop
    // desaparece en el visor, que tiene otra densidad de pixeles.
    float pixelsPerMeter =
      projectionMatrix[1][1] * uViewportHeight * 0.5 / -mvPosition.z;

    float sizeMeters = uSizeRest + drive * uSizeGain + uBeat * 0.008;

    // Clamp: sin el, un punto muy cerca de la camara genera un quad gigante y
    // el fill rate se derrumba en el visor.
    gl_PointSize = clamp(sizeMeters * pixelsPerMeter, 1.0, 64.0);

    // --- Color ---
    // El tono sale de la altura del punto (aHue) mas un corrimiento por tiempo:
    // eso da el rainbow que gira sin que el audio toque nunca el tono. Si el
    // audio moviera el tono, la nube cambiaria de paleta entera en cada golpe y
    // se leeria como ruido de color. El audio modula saturacion y brillo.
    // El color si tiene que quedar en rango, asi que aca sí se recorta.
    float lit = min(drive, 1.0);

    float hue = fract(aHue + uTime * uRainbowSpeed);
    float sat = 0.65 + lit * 0.35;

    // El piso de 0.3 importa: con blending aditivo un color casi negro no suma
    // nada sobre el fondo y la nube desaparece en silencio.
    // uBeat agrega el destello en el golpe.
    float light = min(1.0, 0.3 + lit * 0.45 + uBeat * 0.22);

    vColor = hsl2rgb(hue, sat, light);

    gl_Position = projectionMatrix * mvPosition;
  }
`;

/**
 * Fragment shader.
 *
 * gl_PointCoord va de (0,0) a (1,1) dentro del cuadrado del punto. Descartando
 * lo que cae fuera del radio 0.5 convertimos ese cuadrado en un circulo, sin
 * cargar ninguna textura de sprite.
 */
const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) {
      discard;
    }

    // Borde suave: opaco al centro, transparente al filo. Sin esto los puntos
    // se ven como discos duros con aliasing.
    float alpha = smoothstep(0.5, 0.15, d);

    gl_FragColor = vec4(vColor, alpha);
  }
`;

function createPointCloud(): Group {
  const geometry = new BufferGeometry();

  const positions = new Float32Array(POINT_COUNT * 3);
  const hues = new Float32Array(POINT_COUNT);
  const energies = new Float32Array(POINT_COUNT);

  for (let i = 0; i < POINT_COUNT; i++) {
    const [dx, dy, dz] = fibonacciDirection(i, POINT_COUNT);

    // Jitter radial leve: rompe la regularidad perfecta de la espiral, que si no
    // se nota como un patron de rayas.
    const jitter = 0.93 + pseudoRandom(i) * 0.14;
    const r = BASE_RADIUS * jitter;

    positions[i * 3 + 0] = dx * r;
    positions[i * 3 + 1] = dy * r;
    positions[i * 3 + 2] = dz * r;

    // Tono base por altura: da una banda de arcoiris continua del polo sur al
    // norte, que el shader luego hace girar en el tiempo.
    hues[i] = (dy + 1) / 2;

    energies[i] = 0;
  }

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aHue', new Float32BufferAttribute(hues, 1));
  geometry.setAttribute('aEnergy', new Float32BufferAttribute(energies, 1));

  const material = new ShaderMaterial({
    uniforms: {
      // Valor inicial razonable; el sistema lo pisa con el tamano real.
      uViewportHeight: { value: 1024 },
      uTime: { value: 0 },
      /** Tamano de punto en reposo, en metros. */
      uSizeRest: { value: 0.009 },
      /** Cuanto crece un punto con energia maxima. */
      uSizeGain: { value: 0.032 },
      /** Cuanto se aleja del centro un punto con energia maxima. */
      uRadialGain: { value: 0.6 },
      /** Multiplicador de tamano de la esfera, del slider del panel de escena. */
      uScale: { value: 1 },
      /** Sensibilidad del slider de audio. Amplifica el recorrido, no recorta. */
      uSensitivity: { value: 1.2 },
      /** Envolvente de golpe: salta a 1 en cada beat y decae solo. */
      uBeat: { value: 0 },
      /** Radianes por segundo de giro sobre el eje Y. */
      uSpinSpeed: { value: 0.16 },
      /** Vueltas de arcoiris por segundo. */
      uRainbowSpeed: { value: 0.075 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    // Additive: los puntos que se solapan suman brillo en vez de taparse. En
    // passthrough esto hace que la nube se lea como luz y no como plastico.
    blending: AdditiveBlending,
    // Con additive el z-buffer solo genera artefactos de orden de dibujado.
    depthWrite: false,
  });

  const points = new Points(geometry, material);

  // El frustum culling usa la bounding sphere calculada al construir. Como el
  // shader empuja los puntos hacia afuera y los rota, la nube desapareceria de
  // golpe al mirarla de costado. Desactivarlo es mas barato que recalcular.
  points.frustumCulled = false;

  points.name = 'PointCloud';

  // Asa de agarre invisible.
  //
  // El InputSystem de IWSDK solo calcula BVH para objetos isMesh, asi que un
  // Points no tiene raycast confiable y el grab no engancharia. Esta esfera si
  // es una malla: con colorWrite en false no dibuja un solo pixel, pero sigue
  // intersectando el rayo del control.
  //
  // No sirve poner visible = false: three saltea los objetos invisibles al
  // raycastear, y el asa dejaria de existir para el grab tambien.
  //
  // El radio del asa es MAYOR que el de la nube visible a proposito. El grab por
  // proximidad exige que la mano entre en el volumen del objeto, y la superficie
  // de la esfera queda a ~1.15 m de la cabeza: mas lejos de lo que llega el
  // brazo. Con el asa a 1.6x alcanza con estirar la mano hacia la esfera.
  const handle = new Mesh(
    new SphereGeometry(BASE_RADIUS * 1.6, 16, 12),
    new MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    }),
  );
  handle.name = 'GrabHandle';

  const root = new Group();
  root.name = 'PointCloudRoot';
  root.add(points);
  root.add(handle);

  return root;
}

export default createPointCloud();
