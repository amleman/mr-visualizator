/**
 * Reproduccion y analisis de audio con Web Audio API.
 *
 * Nota de diseno: IWSDK trae su propio componente AudioSource, que da audio
 * espacializado y maneja el ciclo de vida de la sesion XR. No lo uso aca porque
 * mantiene los nodos THREE.Audio en un pool interno que no expone
 * publicamente, y sin acceso a ese nodo no hay donde colgar el AnalyserNode.
 * Para un visualizador frontal la espacializacion no aporta, asi que manejo el
 * audio directo y me queda el grafo entero bajo control.
 */

/** Pistas disponibles en public/audio/music/. */
export const TRACKS = [
  'Funk Da Montanha (Super Slowed) - chipbagov, SCARIONIX e IMMO.mp3',
  'GET AWAY II - MXRGX y NERONUS.mp3',
  'INSONAMIA - maxy4wyn.mp3',
  'I_M SORRY - DVRST.mp3',
  'in your dreams - marcos.mp3',
];

/**
 * Cuantos bins del espectro miramos.
 *
 * Con fftSize 512 el analyser devuelve 256 bins que cubren de 0 Hz a la mitad
 * del sample rate (~24 kHz). Casi toda la energia musical vive abajo de 8 kHz,
 * asi que usar los 256 bins desperdiciaria dos tercios de la nube en silencio.
 * Nos quedamos con los primeros 96 (~0 a 9 kHz a 48 kHz de sample rate).
 */
export const USED_BINS = 96;

export class MusicAnalyser {
  /** Elemento <audio> que hace de fuente. */
  private readonly element: HTMLAudioElement;

  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;

  /**
   * Buffer de salida del FFT: un byte 0..255 por bin.
   * Se reusa en cada frame — asignar un Uint8Array por frame seria basura para
   * el GC a 90 fps.
   */
  private readonly spectrum: Uint8Array<ArrayBuffer>;

  private trackIndex = 0;

  constructor() {
    this.element = new Audio();
    this.element.loop = true;
    this.element.crossOrigin = 'anonymous';
    this.element.preload = 'auto';
    this.element.src = this.trackUrl(this.trackIndex);

    this.spectrum = new Uint8Array(USED_BINS);
  }

  private trackUrl(index: number): string {
    // encodeURI, NO encodeURIComponent. La diferencia importa: encodeURIComponent
    // convierte la coma en %2C, y con eso el middleware estatico de Vite deja de
    // matchear el archivo y cae al fallback de index.html. El <audio> recibe
    // text/html con status 200 y falla con "no supported sources", que es un
    // error que no menciona ni la URL ni el 404 que uno esperaria.
    // encodeURI escapa los espacios y deja comas y parentesis, que son validos
    // en un path.
    return `${import.meta.env.BASE_URL}audio/music/${encodeURI(TRACKS[index])}`;
  }

  /** Nombre de la pista actual, sin extension, para mostrar en el panel. */
  get trackName(): string {
    return TRACKS[this.trackIndex].replace(/\.mp3$/u, '');
  }

  /** Posicion en la lista, para mostrar "2 / 5" en el panel. */
  get trackPosition(): string {
    return `${this.trackIndex + 1} / ${TRACKS.length}`;
  }

  /**
   * Salta a la pista siguiente (o anterior con step -1), en ciclo.
   *
   * Cambiar element.src no rompe el grafo de audio: el MediaElementSourceNode
   * sigue atado al ELEMENTO, no al archivo, asi que el analyser sigue conectado
   * sin reconstruir nada. Reconstruirlo seria ademas un error — un elemento solo
   * admite un createMediaElementSource en toda su vida, y el segundo tira
   * InvalidStateError.
   *
   * @returns true si quedo sonando.
   */
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

  get isPlaying(): boolean {
    return !this.element.paused;
  }

  /**
   * Arma el grafo de audio. Se llama recien en el primer play, no en el
   * constructor, porque los navegadores crean el AudioContext en estado
   * 'suspended' hasta que hay un gesto del usuario. Construirlo antes del click
   * significa un contexto muerto que nunca produce datos.
   */
  private ensureGraph(): void {
    if (this.context != null) {
      return;
    }

    const context = new AudioContext();

    // Puentea el <audio> al grafo de Web Audio. Ojo: una vez que el elemento
    // pasa por aca, su sonido deja de salir por la ruta normal y SOLO sale por
    // el grafo. Si no conectamos hasta destination, no se escucha nada.
    const source = context.createMediaElementSource(this.element);

    const analyser = context.createAnalyser();

    // 512 muestras -> 256 bins. Mas resolucion no ayuda: el cuello de botella
    // visual son los 500 puntos, no la precision en frecuencia.
    analyser.fftSize = 512;

    // Suavizado temporal: mezcla cada frame con el anterior. Sin esto los
    // valores saltan tanto que la nube tiembla en vez de latir. 0.75 deja que
    // el golpe del kick se sienta pero que el decaimiento sea fluido.
    analyser.smoothingTimeConstant = 0.75;

    // Piso de ruido. Por defecto es -100 dB, que mete siseo casi inaudible en
    // el rango visible y hace que la nube nunca se apague del todo.
    analyser.minDecibels = -85;
    analyser.maxDecibels = -10;

    source.connect(analyser);
    analyser.connect(context.destination);

    this.context = context;
    this.analyser = analyser;
  }

  /** Alterna reproduccion. Devuelve el estado nuevo. */
  async toggle(): Promise<boolean> {
    this.ensureGraph();

    // El contexto puede quedar suspendido tras entrar/salir de XR o si el
    // navegador lo pauso por politica de autoplay. Resumir es idempotente.
    if (this.context?.state === 'suspended') {
      await this.context.resume();
    }

    if (this.element.paused) {
      await this.element.play();
    } else {
      this.element.pause();
    }

    return this.isPlaying;
  }

  /**
   * Copia el espectro del frame actual al buffer interno.
   *
   * getByteFrequencyData escribe magnitudes 0..255 ya mapeadas a la escala en
   * decibeles definida por min/maxDecibels — o sea que la respuesta ya es
   * perceptualmente razonable y no hace falta pasarla a log a mano.
   *
   * @returns El buffer reusado. No lo guardes, se sobrescribe cada frame.
   */
  sample(): Uint8Array<ArrayBuffer> {
    if (this.analyser == null) {
      // Sin grafo todavia (nunca se apreto play): espectro en silencio.
      this.spectrum.fill(0);
      return this.spectrum;
    }

    // El analyser escribe frequencyBinCount bins; nosotros pedimos una vista de
    // solo los primeros USED_BINS pasandole un array mas corto.
    this.analyser.getByteFrequencyData(this.spectrum);
    return this.spectrum;
  }

  dispose(): void {
    this.element.pause();
    this.element.src = '';
    void this.context?.close();
    this.context = null;
    this.analyser = null;
  }
}
