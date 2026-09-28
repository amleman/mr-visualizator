/**
 * DJSystem — Gestiona la interactividad de la Tornamesa, LaunchPad y Radio Web.
 *
 * Enlaza los botones de dj-panel con SynthEngine y MusicAnalyser, y anade atajos
 * de teclado para probar y actuar comodamente desde la PC.
 */

import { createSystem } from '@iwsdk/core';
import { getSharedAnalyser } from './audio-analyser.js';

const NOTE_FREQUENCIES = [
  261.63, // 1: Do  (C4)
  293.66, // 2: Re  (D4)
  329.63, // 3: Mi  (E4)
  349.23, // 4: Fa  (F4)
  392.0,  // 5: Sol (G4)
  440.0,  // 6: La  (A4)
  493.88, // 7: Si  (B4)
  523.25, // 8: Do' (C5)
];

export class DJSystem extends createSystem({}) {
  private analyser = getSharedAnalyser();

  // Elementos UI de la radio
  private radioNameEl: any = null;
  private radioGenreEl: any = null;
  private radioPlayLabelEl: any = null;
  private autobeatLabelEl: any = null;

  private isBound = false;

  init(): void {
    this.tryBindPanel();
    this.setupKeyboardShortcuts();
  }

  update(): void {
    // Si el panel de la escena aun no estaba instanciado en init(), reintentar
    if (!this.isBound) {
      this.tryBindPanel();
    }
  }

  private tryBindPanel(): void {
    const panel = this.world.getSceneObject('dj-panel') as {
      getElementById?: (id: string) => any;
    } | null;

    if (!panel || typeof panel.getElementById !== 'function') {
      return;
    }

    const byId = (id: string) => panel.getElementById?.(id) ?? null;

    // --- Radio Web ---
    this.radioNameEl = byId('radio-name');
    this.radioGenreEl = byId('radio-genre');
    this.radioPlayLabelEl = byId('radio-play-label');
    this.refreshRadioUI();

    this.bindClick(byId('radio-play'), () => {
      void this.analyser.toggleRadio().then(() => this.refreshRadioUI());
    });

    this.bindClick(byId('radio-prev'), () => {
      void this.analyser.skipRadio(-1).then(() => this.refreshRadioUI());
    });

    this.bindClick(byId('radio-next'), () => {
      void this.analyser.skipRadio(1).then(() => this.refreshRadioUI());
    });

    // --- Tornamesa / Scratch & Auto Beat ---
    this.autobeatLabelEl = byId('autobeat-label');

    this.bindClick(byId('btn-scratch'), () => {
      this.analyser.synth.playScratch();
    });

    this.bindClick(byId('btn-autobeat'), () => {
      const playing = this.analyser.synth.toggleAutoBeat();
      this.autobeatLabelEl?.setProperties({
        text: playing ? 'Parar Beat' : 'Auto Beat',
      });
    });

    // --- LaunchPad (Drums & FX) ---
    this.bindClick(byId('btn-kick'), () => this.analyser.synth.playKick());
    this.bindClick(byId('btn-snare'), () => this.analyser.synth.playSnare());
    this.bindClick(byId('btn-hihat'), () => this.analyser.synth.playHiHat());
    this.bindClick(byId('btn-clap'), () => this.analyser.synth.playClap());
    this.bindClick(byId('btn-drop'), () => this.analyser.synth.playBassDrop());
    this.bindClick(byId('btn-laser'), () => this.analyser.synth.playLaser());

    // --- Teclado Melodico (Notas 1 a 8) ---
    for (let i = 1; i <= 8; i++) {
      const freq = NOTE_FREQUENCIES[i - 1];
      this.bindClick(byId(`btn-key-${i}`), () => {
        this.analyser.synth.playNote(freq);
      });
    }

    this.isBound = true;
  }

  private refreshRadioUI(): void {
    const station = this.analyser.currentRadioStation;
    this.radioNameEl?.setProperties({ text: station.name });
    this.radioGenreEl?.setProperties({ text: station.genre });
    this.radioPlayLabelEl?.setProperties({
      text: this.analyser.isRadioPlaying ? 'Pausar' : 'Play Radio',
    });
  }

  private bindClick(element: any, handler: () => void): void {
    if (!element) return;
    element.addEventListener('click', handler);
    this.cleanupFuncs.push(() => element.removeEventListener('click', handler));
  }

  /**
   * Atajos de teclado para tocar desde la PC con raton o teclado fisico.
   */
  private setupKeyboardShortcuts(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignorar si el foco esta en un input de texto
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      const key = e.key;

      // Notas 1..8
      if (key >= '1' && key <= '8') {
        const index = parseInt(key, 10) - 1;
        this.analyser.synth.playNote(NOTE_FREQUENCIES[index]);
        return;
      }

      switch (key.toLowerCase()) {
        case ' ': // Espacio: Bombo 808
          e.preventDefault();
          this.analyser.synth.playKick();
          break;
        case 'c': // C: Snare
          this.analyser.synth.playSnare();
          break;
        case 'x': // X: Hi-Hat
          this.analyser.synth.playHiHat();
          break;
        case 'v': // V: Scratch
          this.analyser.synth.playScratch();
          break;
        case 'z': // Z: Clap
          this.analyser.synth.playClap();
          break;
        case 'd': // D: Bass Drop
          this.analyser.synth.playBassDrop();
          break;
        case 'l': // L: Laser
          this.analyser.synth.playLaser();
          break;
        case 'r': // R: Toggle Radio
          void this.analyser.toggleRadio().then(() => this.refreshRadioUI());
          break;
        case 'a': // A: Auto Beat
          {
            const playing = this.analyser.synth.toggleAutoBeat();
            this.autobeatLabelEl?.setProperties({
              text: playing ? 'Parar Beat' : 'Auto Beat',
            });
          }
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    this.cleanupFuncs.push(() => window.removeEventListener('keydown', onKeyDown));
  }
}
