/**
 * Reproduccion y analisis de audio con Web Audio API.
 *
 * Administra tres fuentes de sonido en un grafo compartido:
 * 1. Pistas MP3 locales (public/audio/music/).
 * 2. Radio Web en streaming continuo HTTPS (SomaFM con CORS habilitado).
 * 3. Tornamesa / Sintetizador procedural (SynthEngine).
 *
 * Todas las fuentes pasan por el mismo AnalyserNode hacia context.destination,
 * de modo que cualquier sonido producido modula la nube de puntos en tiempo real.
 */

import { SynthEngine } from './synth-engine.js';

/** Pistas disponibles en public/audio/music/. */
export const TRACKS = [
  'Beyond-the-Fire-Official_128k.mp3',
  'I REALLY WANT TO STAY AT YOUR HOUSE.mp3',
];

export interface RadioStation {
  name: string;
  genre: string;
  url: string;
}

export const RADIO_STATIONS: RadioStation[] = [
  {
    name: 'Vaporwaves',
    genre: 'Synthwave / Retro',
    url: '/api/radio/vaporwaves',
  },
  {
    name: 'Groove Salad',
    genre: 'Ambient / Lo-Fi',
    url: '/api/radio/groovesalad',
  },
  {
    name: 'DEF CON Radio',
    genre: 'Electronic / Beats',
    url: '/api/radio/defcon',
  },
];

/**
 * Cuantos bins del espectro miramos.
 *
 * Con fftSize 512 el analyser devuelve 256 bins. Nos quedamos con los
 * primeros 96 (~0 a 9 kHz a 48 kHz de sample rate).
 */
export const USED_BINS = 96;

export class MusicAnalyser {
  /** Elemento <audio> para pistas locales. */
  private readonly element: HTMLAudioElement;

  /** Elemento <audio> dedicado a la radio web. */
  private readonly radioElement: HTMLAudioElement;

  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private synthEngine: SynthEngine | null = null;

  /**
   * Buffer de salida del FFT: un byte 0..255 por bin.
   * Se reusa en cada frame para no generar basura para el GC.
   */
  private readonly spectrum: Uint8Array<ArrayBuffer>;

  private trackIndex = 0;
  private radioIndex = 0;
  private currentLoadedRadioIndex = -1;

  constructor() {
    this.element = new Audio();
    this.element.loop = true;
    this.element.crossOrigin = 'anonymous';
    this.element.preload = 'auto';
    this.element.src = this.trackUrl(this.trackIndex);

    this.radioElement = new Audio();
    this.radioElement.crossOrigin = 'anonymous';
    this.radioElement.preload = 'none';
    this.radioElement.src = RADIO_STATIONS[this.radioIndex].url;
    this.currentLoadedRadioIndex = this.radioIndex;

    this.spectrum = new Uint8Array(USED_BINS);
  }

  private trackUrl(index: number): string {
    return `${import.meta.env.BASE_URL}audio/music/${encodeURI(TRACKS[index])}`;
  }

  /** Nombre de la pista actual, sin extension, para mostrar en el panel. */
  get trackName(): string {
    return TRACKS[this.trackIndex]?.replace(/\.mp3$/u, '') ?? 'Sin pista';
  }

  /** Posicion en la lista, para mostrar "2 / 5" en el panel. */
  get trackPosition(): string {
    return `${this.trackIndex + 1} / ${TRACKS.length}`;
  }

  /** Informacion de la estacion de radio activa. */
  get currentRadioStation(): RadioStation {
    return RADIO_STATIONS[this.radioIndex];
  }

  get isPlaying(): boolean {
    return !this.element.paused;
  }

  get isRadioPlaying(): boolean {
    return !this.radioElement.paused;
  }

  /**
   * Obtiene o inicializa el motor de sintesis de la tornamesa.
   */
  get synth(): SynthEngine {
    this.ensureGraph();
    return this.synthEngine!;
  }

  /**
   * Arma el grafo de audio unificado.
   */
  ensureGraph(): void {
    if (this.context != null) {
      if (this.context.state === 'suspended') {
        void this.context.resume();
      }
      return;
    }

    const context = new AudioContext();
    const analyser = context.createAnalyser();

    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.75;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -10;

    // Conectar el <audio> de archivos locales
    const trackSource = context.createMediaElementSource(this.element);
    trackSource.connect(analyser);

    // Conectar el <audio> de la radio web
    const radioSource = context.createMediaElementSource(this.radioElement);
    radioSource.connect(analyser);

    // El analyser conduce a los parlantes (destination)
    analyser.connect(context.destination);

    // Conectar el sintetizador al analyser (asi se escucha y deforma la esfera)
    this.synthEngine = new SynthEngine(context, analyser);

    this.context = context;
    this.analyser = analyser;
  }

  /** Alterna reproduccion de pistas locales. */
  async toggle(): Promise<boolean> {
    this.ensureGraph();

    if (this.context?.state === 'suspended') {
      await this.context.resume();
    }

    if (this.element.paused) {
      // Si la radio estaba sonando, la pausamos para no solapar dos canciones
      if (this.isRadioPlaying) {
        this.radioElement.pause();
      }
      await this.element.play();
    } else {
      this.element.pause();
    }

    return this.isPlaying;
  }

  /** Salta a la pista siguiente o anterior en ciclo. */
  async skip(step: number): Promise<boolean> {
    const wasPlaying = this.isPlaying;
    const count = TRACKS.length;
    this.trackIndex = (this.trackIndex + step + count) % count;
    this.element.src = this.trackUrl(this.trackIndex);

    if (wasPlaying) {
      this.ensureGraph();
      if (this.context?.state === 'suspended') {
        await this.context.resume();
      }
      await this.element.play();
    }

    return this.isPlaying;
  }

  // --- Funcionalidades de Radio Web ---

  /** Alterna reproduccion de la radio web. */
  async toggleRadio(): Promise<boolean> {
    this.ensureGraph();

    if (this.context?.state === 'suspended') {
      await this.context.resume();
    }

    if (this.radioElement.paused) {
      // Si la playlist local estaba sonando, la pausamos
      if (this.isPlaying) {
        this.element.pause();
      }
      // Actualizar src de la estacion activa solo si cambio
      if (this.currentLoadedRadioIndex !== this.radioIndex) {
        this.radioElement.src = RADIO_STATIONS[this.radioIndex].url;
        this.radioElement.load();
        this.currentLoadedRadioIndex = this.radioIndex;
      }
      try {
        await this.radioElement.play();
      } catch (err) {
        console.warn('[Radio] Error al reproducir stream:', err);
      }
    } else {
      this.radioElement.pause();
    }

    return this.isRadioPlaying;
  }

  /** Cambia de estacion de radio. */
  async skipRadio(step: number): Promise<boolean> {
    const wasPlaying = this.isRadioPlaying;
    const count = RADIO_STATIONS.length;
    this.radioIndex = (this.radioIndex + step + count) % count;
    this.radioElement.src = RADIO_STATIONS[this.radioIndex].url;
    this.radioElement.load();
    this.currentLoadedRadioIndex = this.radioIndex;

    if (wasPlaying) {
      this.ensureGraph();
      if (this.context?.state === 'suspended') {
        await this.context.resume();
      }
      try {
        await this.radioElement.play();
      } catch (err) {
        console.warn('[Radio] Error al cambiar estacion:', err);
      }
    }

    return this.isRadioPlaying;
  }

  /**
   * Copia el espectro del frame actual al buffer interno.
   * getByteFrequencyData escribe magnitudes 0..255.
   */
  sample(): Uint8Array<ArrayBuffer> {
    if (this.analyser == null) {
      this.spectrum.fill(0);
      return this.spectrum;
    }

    this.analyser.getByteFrequencyData(this.spectrum);
    return this.spectrum;
  }

  dispose(): void {
    this.element.pause();
    this.element.src = '';
    this.radioElement.pause();
    this.radioElement.src = '';
    this.synthEngine?.dispose();
    void this.context?.close();
    this.context = null;
    this.analyser = null;
    this.synthEngine = null;
  }
}

let sharedAnalyser: MusicAnalyser | null = null;
export function getSharedAnalyser(): MusicAnalyser {
  if (sharedAnalyser == null) {
    sharedAnalyser = new MusicAnalyser();
  }
  return sharedAnalyser;
}

