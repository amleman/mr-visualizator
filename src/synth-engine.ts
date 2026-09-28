/**
 * Motor de sintesis de audio procedural con Web Audio API puro.
 *
 * Genera todos los instrumentos, efectos de DJ y ritmo en tiempo real:
 * - Cero archivos externos ni descargas requeridas.
 * - Latencia minima (<5 ms).
 * - Enrutado directo al AnalyserNode (para deformar la esfera de puntos)
 *   y a context.destination (para que el usuario lo escuche).
 */

export class SynthEngine {
  private readonly context: AudioContext;
  private readonly output: GainNode;
  private noiseBuffer: AudioBuffer | null = null;

  // --- Auto Beat Sequencer ---
  private autoBeatTimer: number | null = null;
  private currentStep = 0;
  private bpm = 120;

  constructor(context: AudioContext, masterOutput: AudioNode) {
    this.context = context;

    // Sub-master de ganancia para la tornamesa
    this.output = this.context.createGain();
    this.output.gain.value = 0.85;
    this.output.connect(masterOutput);

    this.initNoiseBuffer();
  }

  /** Genera 1 segundo de ruido blanco estatico para reutilizar en percusiones. */
  private initNoiseBuffer(): void {
    const bufferSize = this.context.sampleRate;
    this.noiseBuffer = this.context.createBuffer(1, bufferSize, this.context.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }

  /**
   * Bombo 808 sub-grave.
   * La caida de 150 Hz a 38 Hz llena los primeros bins (0-5) del FFT,
   * provocando la expansion radial de la base de la esfera y disparando el beat.
   */
  playKick(): void {
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.12);

    // Click inicial de ataque para definicion
    gain.gain.setValueAtTime(1.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc.connect(gain);
    gain.connect(this.output);

    osc.start(now);
    osc.stop(now + 0.4);
  }

  /**
   * Caja (Snare): Tono resonante medio + rafaga de ruido filtrado.
   */
  playSnare(): void {
    const now = this.context.currentTime;

    // Tono base
    const osc = this.context.createOscillator();
    const oscGain = this.context.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.1);
    oscGain.gain.setValueAtTime(0.7, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(oscGain);
    oscGain.connect(this.output);

    // Componente de ruido
    if (this.noiseBuffer) {
      const noise = this.context.createBufferSource();
      noise.buffer = this.noiseBuffer;

      const filter = this.context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1200, now);
      filter.Q.setValueAtTime(1.5, now);

      const noiseGain = this.context.createGain();
      noiseGain.gain.setValueAtTime(0.9, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.output);

      noise.start(now);
      noise.stop(now + 0.22);
    }

    osc.start(now);
    osc.stop(now + 0.15);
  }

  /**
   * Platillo (Hi-Hat): Ruido filtrado paso alto (>8 kHz).
   * Modula los bins superiores, encendiendo la cupula de la esfera.
   */
  playHiHat(open = false): void {
    if (!this.noiseBuffer) return;
    const now = this.context.currentTime;
    const duration = open ? 0.25 : 0.05;

    const noise = this.context.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.context.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(7500, now);

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.65, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.output);

    noise.start(now);
    noise.stop(now + duration + 0.02);
  }

  /**
   * Aplauso (Clap): Rafagas triples de ruido escalonadas con decaimiento percusivo.
   */
  playClap(): void {
    if (!this.noiseBuffer) return;
    const now = this.context.currentTime;

    const noise = this.context.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1100, now);
    filter.Q.setValueAtTime(1.2, now);

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.8, now);
    gain.gain.setValueAtTime(0.2, now + 0.015);
    gain.gain.setValueAtTime(0.9, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.output);

    noise.start(now);
    noise.stop(now + 0.26);
  }

  /**
   * Caida de Sub-Bass (Bass Drop): Descenso progresivo de baja frecuencia.
   */
  playBassDrop(): void {
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 1.1);

    gain.gain.setValueAtTime(1.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.25);

    osc.connect(gain);
    gain.connect(this.output);

    osc.start(now);
    osc.stop(now + 1.3);
  }

  /**
   * Efecto Laser / Zap de DJ: Barrido rapido descendente con onda sierra.
   */
  playLaser(): void {
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(950, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.16);

    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(this.output);

    osc.start(now);
    osc.stop(now + 0.2);
  }

  /**
   * Efecto de Scratch de vinilo autentico de DJ:
   * Modula frecuencia y resonancia emulando el movimiento de la aguja hacia adelante y atras.
   */
  playScratch(): void {
    const now = this.context.currentTime;

    // Oscilador modulado para el tono del vinilo
    const osc = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();

    osc.type = 'sawtooth';
    // Curva "wiki-wiki"
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.linearRampToValueAtTime(650, now + 0.08);
    osc.frequency.linearRampToValueAtTime(180, now + 0.16);
    osc.frequency.linearRampToValueAtTime(450, now + 0.24);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800, now);
    filter.Q.setValueAtTime(3.5, now);

    gain.gain.setValueAtTime(0.85, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.output);

    osc.start(now);
    osc.stop(now + 0.3);

    // Capa de ruido de friccion de aguja
    if (this.noiseBuffer) {
      const noise = this.context.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const noiseFilter = this.context.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(2200, now);
      noiseFilter.Q.setValueAtTime(2.0, now);

      const noiseGain = this.context.createGain();
      noiseGain.gain.setValueAtTime(0.35, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.output);

      noise.start(now);
      noise.stop(now + 0.26);
    }
  }

  /**
   * Reproduce una nota musical melodica con sintetizador retro cálido.
   * @param freq Frecuencia en Hertz (ej. C4 = 261.63)
   */
  playNote(freq: number, duration = 0.45): void {
    const now = this.context.currentTime;

    const osc1 = this.context.createOscillator();
    const osc2 = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();

    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(freq, now);

    osc2.type = 'sawtooth';
    // Ligero detune para sensacion analogica
    osc2.frequency.setValueAtTime(freq * 1.004, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 3.5, now);
    filter.frequency.exponentialRampToValueAtTime(freq * 0.9, now + duration);

    // Envolvente ADSR rapida
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.65, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.output);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + duration + 0.05);
    osc2.stop(now + duration + 0.05);
  }

  /**
   * Activa o desactiva el loop de ritmo automatico a 120 BPM (Auto Beat).
   * @returns true si quedo sonando.
   */
  toggleAutoBeat(onStep?: (step: number) => void): boolean {
    if (this.autoBeatTimer !== null) {
      this.stopAutoBeat();
      return false;
    }

    this.currentStep = 0;
    // 120 BPM: cada corchea (8th note) dura 250 ms
    const intervalMs = (60 / this.bpm / 2) * 1000;

    const tick = () => {
      // Patron clásico de hip-hop / house (8 pasos):
      // Paso 0: Kick + Hi-Hat
      // Paso 1: Hi-Hat
      // Paso 2: Snare + Hi-Hat
      // Paso 3: Hi-Hat
      // Paso 4: Kick + Hi-Hat
      // Paso 5: Kick (sincope) + Hi-Hat
      // Paso 6: Snare + Hi-Hat
      // Paso 7: Hi-Hat abierto
      switch (this.currentStep) {
        case 0:
          this.playKick();
          this.playHiHat(false);
          break;
        case 1:
          this.playHiHat(false);
          break;
        case 2:
          this.playSnare();
          this.playHiHat(false);
          break;
        case 3:
          this.playHiHat(false);
          break;
        case 4:
          this.playKick();
          this.playHiHat(false);
          break;
        case 5:
          this.playKick();
          this.playHiHat(false);
          break;
        case 6:
          this.playSnare();
          this.playHiHat(false);
          break;
        case 7:
          this.playHiHat(true);
          break;
      }

      onStep?.(this.currentStep);
      this.currentStep = (this.currentStep + 1) % 8;
    };

    // Dispara el primer beat de inmediato
    tick();
    this.autoBeatTimer = window.setInterval(tick, intervalMs);
    return true;
  }

  stopAutoBeat(): void {
    if (this.autoBeatTimer !== null) {
      clearInterval(this.autoBeatTimer);
      this.autoBeatTimer = null;
    }
  }

  get isAutoBeatPlaying(): boolean {
    return this.autoBeatTimer !== null;
  }

  dispose(): void {
    this.stopAutoBeat();
  }
}
