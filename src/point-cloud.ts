/**
 * PointCloudSystem — la logica de audio-reactividad.
 *
 * Corre dentro del loop de render de IWSDK: update() se llama una vez por frame
 * de XR (72-90 fps en Quest 3). No hace falta requestAnimationFrame ni
 * setInterval propios, y meterlos seria peor: quedarian desincronizados del
 * ritmo del compositor de WebXR.
 *
 * Este sistema hace UNA cosa por frame: traducir el espectro de audio a un
 * float de energia por punto. El empuje radial, el tamano, el color rainbow y
 * la rotacion los deriva el vertex shader (ver point-cloud.scene-asset.ts).
 */

import {
  BufferAttribute,
  createSystem,
  type Entity,
  Object3D,
  Points,
  ShaderMaterial,
} from '@iwsdk/core';
import { getSharedAnalyser, MusicAnalyser, USED_BINS } from './audio-analyser.js';
import { PointCloud } from './point-cloud-component.js';

export class PointCloudSystem extends createSystem({
  clouds: { required: [PointCloud] },
}) {
  private analyser!: MusicAnalyser;

  /** Referencias cacheadas para no buscarlas por frame. */
  private energyAttr: BufferAttribute | null = null;
  private material: ShaderMaterial | null = null;

  /** Bin del FFT que le toca a cada punto, segun su altura. */
  private pointBins!: Uint16Array;

  private pointCount = 0;

  /** Segundos acumulados. Alimenta la rotacion y el ciclo de arcoiris. */
  private elapsed = 0;

  /** Asa invisible; se escala junto con la esfera para que el grab siga cuadrando. */
  private grabHandle: Object3D | null = null;

  // --- Deteccion de beat ---
  /** Promedio movil lento de la energia de graves. Es la linea base. */
  private bassBaseline = 0;
  /** Envolvente del golpe: salta a 1 y decae. La lee el shader como uBeat. */
  private beatEnvelope = 0;
  /** Segundos que faltan para poder detectar otro golpe. */
  private beatCooldown = 0;

  /** Elementos del panel, resueltos una vez en init(). */
  private playLabel: any = null;
  private trackNameEl: any = null;
  private trackPosEl: any = null;

  init(): void {
    this.analyser = getSharedAnalyser();

    // 'qualify' solo dispara para entidades que califican DESPUES de suscribirse.
    // Los systems se registran en el .then() de World.create(), o sea con la
    // escena ya cargada y la entidad ya existente, asi que este callback por si
    // solo no alcanza: update() tambien intenta enlazar mientras no lo logre.
    this.queries.clouds.subscribe('qualify', (entity) => {
      this.tryBind(entity);
    });

    this.wirePanel();

    this.cleanupFuncs.push(() => this.analyser.dispose());
  }

  /** Enlaza la geometria de una entidad si todavia no lo hicimos. */
  private tryBind(entity: Entity): void {
    if (this.energyAttr != null) {
      return;
    }
    const points = findPoints(entity.object3D);
    if (points == null) {
      return;
    }
    this.bindGeometry(points);
  }

  /**
   * Precalcula el bin de FFT de cada punto a partir de su altura.
   * Hacer esto una vez deja el update() como pura aritmetica sobre un array.
   */
  private bindGeometry(points: Points): void {
    const geometry = points.geometry;

    this.material = points.material as ShaderMaterial;
    this.grabHandle = points.parent?.getObjectByName('GrabHandle') ?? null;
    this.energyAttr = geometry.getAttribute('aEnergy') as BufferAttribute;

    const positionAttr = geometry.getAttribute('position') as BufferAttribute;
    this.pointCount = positionAttr.count;
    this.pointBins = new Uint16Array(this.pointCount);

    for (let i = 0; i < this.pointCount; i++) {
      const y = positionAttr.getY(i);
      const r = Math.hypot(positionAttr.getX(i), y, positionAttr.getZ(i)) || 1;

      // Aca esta el mapeo que hace legible la nube: la ALTURA del punto elige
      // su banda de frecuencia. Los puntos de abajo escuchan los graves, los de
      // arriba los agudos. La esfera se vuelve un analizador de espectro
      // esferico: el kick empuja la base y los hi-hats chispean en la cupula.
      const heightT = (y / r + 1) / 2; // -1..1 -> 0..1

      // Curva cuadratica en vez de lineal: los primeros bins concentran casi
      // toda la energia musical, asi que darles mas puntos reparte mejor el
      // movimiento a lo largo de la esfera.
      const binT = heightT * heightT;
      this.pointBins[i] = Math.min(
        USED_BINS - 1,
        Math.floor(binT * (USED_BINS - 1)),
      );
    }
  }

  /** Conecta los controles del panel. */
  private wirePanel(): void {
    const panel = this.world.getSceneObject('welcome-panel') as {
      getElementById?: (id: string) => any;
    } | null;

    const byId = (id: string) => panel?.getElementById?.(id) ?? null;

    this.playLabel = byId('play-label');
    this.trackNameEl = byId('track-name');
    this.trackPosEl = byId('track-pos');

    this.refreshTrackLabels();

    this.bindClick(byId('play-button'), () => {
      void this.analyser.toggle().then((playing) => this.setPlayLabel(playing));
    });

    this.bindClick(byId('prev-button'), () => {
      void this.analyser.skip(-1).then((playing) => {
        this.refreshTrackLabels();
        this.setPlayLabel(playing);
      });
    });

    this.bindClick(byId('next-button'), () => {
      void this.analyser.skip(1).then((playing) => {
        this.refreshTrackLabels();
        this.setPlayLabel(playing);
      });
    });

    this.wireScenePanel();

    const slider = byId('sensitivity-slider');
    if (slider != null) {
      // El Slider del kit Horizon expone onValueChange como propiedad, no como
      // evento del DOM: se setea con setProperties y se dispara en cada cambio.
      slider.setProperties({
        onValueChange: (value: number) => {
          for (const entity of this.queries.clouds.entities) {
            entity.setValue(PointCloud, 'sensitivity', value);
          }
        },
      });
    }
  }

  /** Slider de tamano del segundo panel. */
  private wireScenePanel(): void {
    const panel = this.world.getSceneObject('scene-panel') as {
      getElementById?: (id: string) => any;
    } | null;

    const slider = panel?.getElementById?.('scale-slider');
    const readout = panel?.getElementById?.('scale-readout');

    slider?.setProperties({
      onValueChange: (value: number) => {
        for (const entity of this.queries.clouds.entities) {
          entity.setValue(PointCloud, 'scale', value);
        }
        readout?.setProperties({ text: `${value.toFixed(2)}x` });
      },
    });
  }

  /** Registra un listener de click y su teardown en un solo paso. */
  private bindClick(element: any, handler: () => void): void {
    if (element == null) {
      return;
    }
    element.addEventListener('click', handler);
    this.cleanupFuncs.push(() => element.removeEventListener('click', handler));
  }

  private setPlayLabel(playing: boolean): void {
    this.playLabel?.setProperties({ text: playing ? 'Pause' : 'Play' });
  }

  private refreshTrackLabels(): void {
    this.trackNameEl?.setProperties({ text: this.analyser.trackName });
    this.trackPosEl?.setProperties({ text: this.analyser.trackPosition });
  }

  update(delta: number): void {
    if (this.energyAttr == null) {
      // Reintento de enlace: barato mientras falle, y se apaga solo al lograrlo.
      for (const entity of this.queries.clouds.entities) {
        this.tryBind(entity);
      }
      if (this.energyAttr == null) {
        return;
      }
    }

    this.elapsed += delta;

    // Un solo getByteFrequencyData por frame para toda la nube.
    const spectrum = this.analyser.sample();

    // La sensibilidad se lee de la entidad, no de una variable suelta: asi el
    // valor vive en el ECS y el editor puede inspeccionarlo. El MVP coloca una
    // sola nube, que es la duena de los atributos cacheados arriba.
    let sensitivity = 1;
    let scale = 1;
    for (const entity of this.queries.clouds.entities) {
      sensitivity = entity.getValue(PointCloud, 'sensitivity') ?? 1;
      scale = entity.getValue(PointCloud, 'scale') ?? 1;
    }

    const energies = this.energyAttr.array as Float32Array;

    for (let i = 0; i < this.pointCount; i++) {
      // Energia cruda de la banda que le toca a este punto, 0..1.
      // getByteFrequencyData ya devuelve 0..255 en escala de decibeles.
      //
      // Aca NO se aplica la sensibilidad ni se recorta: eso lo hace el shader.
      // Antes se hacia aca con Math.min(1, raw * sensitivity) y el resultado era
      // que con sensibilidad alta los graves se clavaban en el tope y dejaban de
      // moverse justo en los pasajes con mas bajo.
      energies[i] = spectrum[this.pointBins[i]] / 255;
    }

    this.detectBeat(spectrum, delta);

    if (this.material != null) {
      const uniforms = this.material.uniforms;
      uniforms.uTime.value = this.elapsed;
      uniforms.uScale.value = scale;
      uniforms.uSensitivity.value = sensitivity;
      uniforms.uBeat.value = this.beatEnvelope;
      // El alto del framebuffer cambia al redimensionar y al entrar en XR, asi
      // que el uniform se refresca por frame en vez de una sola vez.
      uniforms.uViewportHeight.value = this.world.renderer.domElement.height;
    }

    // El asa de agarre no la toca el shader, asi que hay que escalarla a mano
    // para que siga cubriendo la esfera cuando cambia el slider de tamano.
    this.grabHandle?.scale.setScalar(scale);

    // Sin esto la GPU sigue mostrando el buffer del primer frame: hay que
    // avisarle a three que reenvie el array modificado.
    this.energyAttr.needsUpdate = true;
  }

  /**
   * Deteccion de beat por energia de graves contra su propia linea base.
   *
   * La idea: un golpe no es "hay mucho grave", es "hay MAS grave que hace un
   * momento". Un umbral fijo fallaria en cuanto cambia el volumen o el track;
   * comparar contra un promedio movil lento se adapta solo a cada cancion.
   *
   * El cooldown evita que un solo kick, que dura varios frames por encima del
   * umbral, dispare diez beats seguidos.
   */
  private detectBeat(spectrum: Uint8Array, delta: number): void {
    // Primeros bins: ~0 a 560 Hz a 48 kHz de sample rate. Ahi vive el kick.
    const BASS_BINS = 6;
    let bass = 0;
    for (let i = 0; i < BASS_BINS; i++) {
      bass += spectrum[i];
    }
    bass /= BASS_BINS * 255;

    this.beatCooldown -= delta;

    // 1.28x sobre la linea base marca el golpe. El piso de 0.18 evita que el
    // ruido de fondo en un silencio dispare beats fantasma.
    const isBeat =
      bass > this.bassBaseline * 1.28 &&
      bass > 0.18 &&
      this.beatCooldown <= 0;

    if (isBeat) {
      this.beatEnvelope = 1;
      // 160 ms de bloqueo: tope de ~375 BPM, mas que suficiente.
      this.beatCooldown = 0.16;
    }

    // Promedio movil lento. Con 0.03 tarda ~1 segundo en adaptarse, que es lo
    // que hace que siga el nivel de la cancion sin seguir cada golpe.
    this.bassBaseline += (bass - this.bassBaseline) * 0.03;

    // Decaimiento exponencial del destello: ~110 ms de constante de tiempo.
    this.beatEnvelope *= Math.exp(-delta / 0.11);
  }
}

/** El nodo instanciado puede ser el Points directo o un Group que lo contiene. */
function findPoints(root: Object3D | null | undefined): Points | null {
  if (root == null) {
    return null;
  }
  if ((root as Points).isPoints) {
    return root as Points;
  }
  let found: Points | null = null;
  root.traverse((child) => {
    if (found == null && (child as Points).isPoints) {
      found = child as Points;
    }
  });
  return found;
}
