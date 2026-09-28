/**
 * DeviceUI — Interfaz 2D moderna y adaptativa para PC y Dispositivos Moviles (Celulares y Tablets).
 *
 * Se activa automaticamente cuando NO se esta en una sesion XR inmersiva:
 * - Oculta los paneles flotantes 3D del mundo (que resultan incomodos en pantallas planas).
 * - Despliega un panel interactivo tactil y de raton con diseno glassmorphism.
 * - Incluye todas las funciones: Tornamesa DJ, Radio Web en directo, Pistas MP3,
 *   LaunchPad, Teclado musical, Controles de escena y boton para Entrar a XR.
 * - Permite colapsar / minimizar para disfrutar de la esfera 3D a pantalla completa.
 */

import { SessionMode } from '@iwsdk/core';
import { getSharedAnalyser } from './audio-analyser.js';

export interface DeviceUIOptions {
  onSetScale: (scale: number) => void;
  onSetSensitivity: (sensitivity: number) => void;
  onSetMode: (mode: SessionMode) => void;
  onLaunchXR: () => void;
  getMode: () => SessionMode;
  getScale: () => number;
}

const NOTE_FREQS = [
  261.63, // Do  (C4)
  293.66, // Re  (D4)
  329.63, // Mi  (E4)
  349.23, // Fa  (F4)
  392.0,  // Sol (G4)
  440.0,  // La  (A4)
  493.88, // Si  (B4)
  523.25, // Do' (C5)
];

const NOTE_NAMES = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si', "Do'"];

export class DeviceUI {
  private analyser = getSharedAnalyser();
  private options: DeviceUIOptions;

  private rootEl: HTMLElement | null = null;
  private kbdPanelEl: HTMLElement | null = null;
  private activeTab: 'dj' | 'tracks' | 'scene' = 'dj';
  private isMinimized = false;
  private isKbdMinimized = false;

  constructor(options: DeviceUIOptions) {
    this.options = options;
    this.buildUI();
  }

  show(): void {
    if (this.rootEl) {
      this.rootEl.style.display = 'block';
    }
    if (this.kbdPanelEl) {
      this.kbdPanelEl.style.display = 'block';
    }
  }

  hide(): void {
    if (this.rootEl) {
      this.rootEl.style.display = 'none';
    }
    if (this.kbdPanelEl) {
      this.kbdPanelEl.style.display = 'none';
    }
  }

  syncState(): void {
    this.updateRadioDisplay();
    this.updateTrackDisplay();
    this.updateSceneDisplay();
  }

  private buildUI(): void {
    const style = document.createElement('style');
    style.textContent = `
      #device-hud-root {
        position: fixed;
        bottom: 14px;
        left: 50%;
        transform: translateX(-50%);
        width: calc(100% - 24px);
        max-width: 500px;
        z-index: 99999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #ffffff;
        box-sizing: border-box;
        user-select: none;
        -webkit-user-select: none;
      }
      .hud-container {
        background: rgba(16, 18, 24, 0.88);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 18px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
        overflow: hidden;
        transition: all 0.25s ease;
      }
      .hud-nav-bar {
        display: flex;
        align-items: center;
        background: rgba(0, 0, 0, 0.45);
        padding: 5px;
        gap: 4px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .hud-tab-btn {
        flex: 1;
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.65);
        padding: 8px 6px;
        border-radius: 10px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        transition: all 0.15s ease;
        touch-action: manipulation;
      }
      .hud-tab-btn:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.08);
      }
      .hud-tab-btn.active {
        background: rgba(255, 255, 255, 0.18);
        color: #ffffff;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      }
      .hud-collapse-btn {
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.6);
        padding: 6px 10px;
        border-radius: 8px;
        font-size: 14px;
        cursor: pointer;
      }
      .hud-collapse-btn:hover {
        color: #ffffff;
      }
      .hud-body {
        padding: 12px 14px;
        max-height: 48vh;
        overflow-y: auto;
      }
      .hud-body.collapsed {
        display: none;
      }
      /* Seccion Radio */
      .hud-card {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 10px;
        margin-bottom: 10px;
      }
      .hud-card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
      .hud-card-title {
        font-size: 13px;
        font-weight: 700;
        color: #f3f4f6;
      }
      .hud-card-subtitle {
        font-size: 11px;
        color: #9ca3af;
      }
      .hud-row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .hud-btn {
        flex: 1;
        padding: 8px 12px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.1);
        color: #ffffff;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all 0.12s ease;
        touch-action: manipulation;
      }
      .hud-btn:active {
        transform: scale(0.96);
      }
      .hud-btn-primary {
        background: #2563eb;
        border-color: #3b82f6;
      }
      .hud-btn-primary:active {
        background: #1d4ed8;
      }
      /* LaunchPad */
      .hud-section-title {
        font-size: 12px;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.75);
        margin: 10px 0 6px 0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .hud-pad-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        margin-bottom: 10px;
      }
      .hud-pad-btn {
        padding: 12px 6px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #ffffff;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        transition: transform 0.1s ease, filter 0.1s ease;
        touch-action: manipulation;
      }
      .hud-pad-btn:active {
        transform: scale(0.93);
        filter: brightness(1.3);
      }
      .pad-kick { background: linear-gradient(135deg, #dc2626, #991b1b); }
      .pad-snare { background: linear-gradient(135deg, #d97706, #b45309); }
      .pad-hihat { background: linear-gradient(135deg, #059669, #047857); }
      .pad-clap { background: linear-gradient(135deg, #7c3aed, #6d28d9); }
      .pad-drop { background: linear-gradient(135deg, #2563eb, #1d4ed8); }
      .pad-laser { background: linear-gradient(135deg, #db2777, #be185d); }

      /* Mini Piano */
      .hud-keyboard-row {
        display: flex;
        gap: 4px;
        margin-top: 4px;
      }
      .hud-key-btn {
        flex: 1;
        height: 44px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: #ffffff;
        color: #1f2937;
        font-size: 11px;
        font-weight: 700;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        padding-bottom: 6px;
        cursor: pointer;
        touch-action: manipulation;
        transition: transform 0.08s ease, background 0.08s ease;
      }
      .hud-key-btn:active {
        background: #3b82f6;
        color: #ffffff;
        transform: translateY(2px);
      }
      /* Sliders */
      .hud-slider-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
      }
      .hud-slider {
        flex: 1;
        accent-color: #3b82f6;
        cursor: pointer;
      }
      .hud-readout {
        font-size: 12px;
        font-weight: 700;
        color: #93c5fd;
        width: 44px;
        text-align: right;
      }
      .hud-xr-launch {
        width: 100%;
        padding: 12px;
        border-radius: 12px;
        border: none;
        background: linear-gradient(135deg, #2563eb, #7c3aed);
        color: #ffffff;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        box-shadow: 0 4px 16px rgba(37, 99, 235, 0.4);
      }
      .hud-xr-launch:hover {
        filter: brightness(1.1);
      }
      /* Panel de atajos de teclado en esquina inferior izquierda */
      #keyboard-shortcuts-panel {
        position: fixed;
        bottom: 14px;
        left: 14px;
        z-index: 99998;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #ffffff;
        box-sizing: border-box;
        user-select: none;
        max-width: 290px;
      }
      .kbd-container {
        background: rgba(16, 18, 24, 0.88);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 14px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
        overflow: hidden;
      }
      .kbd-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: rgba(0, 0, 0, 0.45);
        padding: 7px 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .kbd-title {
        font-size: 11px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 6px;
        color: #f3f4f6;
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }
      .kbd-collapse-btn {
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.6);
        cursor: pointer;
        font-size: 12px;
        padding: 0 4px;
      }
      .kbd-collapse-btn:hover {
        color: #ffffff;
      }
      .kbd-body {
        padding: 9px 12px;
      }
      .kbd-body.collapsed {
        display: none;
      }
      .kbd-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 5px 12px;
      }
      .kbd-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .kbd-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        padding: 2px 5px;
        background: rgba(255, 255, 255, 0.14);
        border: 1px solid rgba(255, 255, 255, 0.22);
        border-radius: 5px;
        font-size: 10px;
        font-weight: 700;
        color: #93c5fd;
        box-shadow: 0 2px 0 rgba(0,0,0,0.35);
        transition: all 0.1s ease;
      }
      .kbd-badge.kbd-active {
        background: #3b82f6 !important;
        color: #ffffff !important;
        transform: translateY(1px);
        box-shadow: none !important;
      }
      .kbd-desc {
        color: rgba(255, 255, 255, 0.85);
        font-size: 11px;
        font-weight: 500;
        white-space: nowrap;
      }
      @media (max-width: 768px) {
        #keyboard-shortcuts-panel {
          display: none !important;
        }
      }
    `;
    document.head.appendChild(style);

    this.buildKeyboardPanel();

    this.rootEl = document.createElement('div');
    this.rootEl.id = 'device-hud-root';
    this.render();
    document.body.appendChild(this.rootEl);
    this.bindEvents();
    this.syncState();
  }

  private render(): void {
    if (!this.rootEl) return;

    this.rootEl.innerHTML = `
      <div class="hud-container">
        <!-- Barra de Navegacion por Pestanas -->
        <div class="hud-nav-bar">
          <button class="hud-tab-btn ${this.activeTab === 'dj' ? 'active' : ''}" data-tab="dj">
            🎧 DJ & Radio
          </button>
          <button class="hud-tab-btn ${this.activeTab === 'tracks' ? 'active' : ''}" data-tab="tracks">
            🎵 Pistas
          </button>
          <button class="hud-tab-btn ${this.activeTab === 'scene' ? 'active' : ''}" data-tab="scene">
            ⚙️ Escena
          </button>
          <button class="hud-collapse-btn" id="hud-toggle-collapse" title="Minimizar">
            ${this.isMinimized ? '▲' : '▼'}
          </button>
        </div>

        <!-- Contenido segun pestana activa -->
        <div class="hud-body ${this.isMinimized ? 'collapsed' : ''}" id="hud-body-content">
          ${this.renderTabContent()}
        </div>
      </div>
    `;
  }

  private renderTabContent(): string {
    if (this.activeTab === 'dj') {
      return `
        <!-- Seccion Radio Web -->
        <div class="hud-card">
          <div class="hud-card-header">
            <div>
              <div id="device-radio-name" class="hud-card-title">Radio Web</div>
              <div id="device-radio-genre" class="hud-card-subtitle">Cargando...</div>
            </div>
            <button id="device-radio-play" class="hud-btn hud-btn-primary" style="flex: 0 0 110px;">
              ▶ Play Radio
            </button>
          </div>
          <div class="hud-row">
            <button id="device-radio-prev" class="hud-btn">◀ Anterior</button>
            <button id="device-radio-next" class="hud-btn">Siguiente ▶</button>
          </div>
        </div>

        <!-- Seccion Tornamesa (Scratch & Auto Beat) -->
        <div class="hud-row" style="margin-bottom: 10px;">
          <button id="device-btn-scratch" class="hud-btn hud-btn-primary" style="flex: 3; padding: 12px;">
            💽 SCRATCH!
          </button>
          <button id="device-btn-autobeat" class="hud-btn" style="flex: 2; padding: 12px;">
            ✨ Auto Beat
          </button>
        </div>

        <!-- LaunchPad (Drums & FX) -->
        <div class="hud-section-title">LaunchPad</div>
        <div class="hud-pad-grid">
          <button id="pad-kick" class="hud-pad-btn pad-kick"><span>🥁</span> Kick 808</button>
          <button id="pad-snare" class="hud-pad-btn pad-snare"><span>💥</span> Snare</button>
          <button id="pad-hihat" class="hud-pad-btn pad-hihat"><span>🔔</span> Hi-Hat</button>
          <button id="pad-clap" class="hud-pad-btn pad-clap"><span>👏</span> Clap</button>
          <button id="pad-drop" class="hud-pad-btn pad-drop"><span>💣</span> Bass Drop</button>
          <button id="pad-laser" class="hud-pad-btn pad-laser"><span>⚡</span> Laser</button>
        </div>

        <!-- Teclado Melodico -->
        <div class="hud-section-title">Teclado Melódico</div>
        <div class="hud-keyboard-row">
          ${NOTE_NAMES.map((n, i) => `<button class="hud-key-btn" data-note-index="${i}">${n}</button>`).join('')}
        </div>
      `;
    }

    if (this.activeTab === 'tracks') {
      return `
        <!-- Reproductor de Pistas Locales -->
        <div class="hud-card">
          <div class="hud-card-header">
            <div>
              <div id="device-track-name" class="hud-card-title">—</div>
              <div id="device-track-pos" class="hud-card-subtitle">—</div>
            </div>
            <button id="device-track-play" class="hud-btn hud-btn-primary" style="flex: 0 0 100px;">
              Play
            </button>
          </div>
          <div class="hud-row">
            <button id="device-track-prev" class="hud-btn">◀ Anterior</button>
            <button id="device-track-next" class="hud-btn">Siguiente ▶</button>
          </div>
        </div>

        <!-- Sensibilidad de la Esfera -->
        <div class="hud-section-title">Sensibilidad al Audio</div>
        <div class="hud-slider-row">
          <input id="device-sens-slider" class="hud-slider" type="range" min="0" max="3" step="0.05" value="1.2" />
          <span id="device-sens-readout" class="hud-readout">1.20x</span>
        </div>
      `;
    }

    // Escena & XR
    return `
      <!-- Tamano de la Esfera -->
      <div class="hud-section-title">Tamaño de la Esfera</div>
      <div class="hud-slider-row">
        <input id="device-scale-slider" class="hud-slider" type="range" min="0.4" max="1.8" step="0.05" value="${this.options.getScale()}" />
        <span id="device-scale-readout" class="hud-readout">${this.options.getScale().toFixed(2)}x</span>
      </div>

      <!-- Modo de Inmersion -->
      <div class="hud-section-title">Modo de Inmersión</div>
      <div class="hud-row" style="margin-bottom: 14px;">
        <button id="device-mode-ar" class="hud-btn ${this.options.getMode() === SessionMode.ImmersiveAR ? 'hud-btn-primary' : ''}">
          Passthrough
        </button>
        <button id="device-mode-vr" class="hud-btn ${this.options.getMode() === SessionMode.ImmersiveVR ? 'hud-btn-primary' : ''}">
          VR Inmersivo
        </button>
      </div>

      <!-- Lanzar XR -->
      <button id="device-enter-xr" class="hud-xr-launch">
        🥽 Entrar en Realidad Virtual / Mixta
      </button>
    `;
  }

  private bindEvents(): void {
    if (!this.rootEl) return;

    // Conmutador de pestanas
    this.rootEl.querySelectorAll('.hud-tab-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const tab = (e.currentTarget as HTMLElement).getAttribute('data-tab') as any;
        if (tab && this.activeTab !== tab) {
          this.activeTab = tab;
          this.isMinimized = false;
          this.render();
          this.bindEvents();
          this.syncState();
        }
      });
    });

    // Colapsar / Minimizar
    this.rootEl.querySelector('#hud-toggle-collapse')?.addEventListener('click', () => {
      this.isMinimized = !this.isMinimized;
      this.render();
      this.bindEvents();
      this.syncState();
    });

    // --- Eventos DJ & Radio ---
    if (this.activeTab === 'dj') {
      this.rootEl.querySelector('#device-radio-play')?.addEventListener('click', () => {
        void this.analyser.toggleRadio().then(() => this.updateRadioDisplay());
      });
      this.rootEl.querySelector('#device-radio-prev')?.addEventListener('click', () => {
        void this.analyser.skipRadio(-1).then(() => this.updateRadioDisplay());
      });
      this.rootEl.querySelector('#device-radio-next')?.addEventListener('click', () => {
        void this.analyser.skipRadio(1).then(() => this.updateRadioDisplay());
      });

      this.rootEl.querySelector('#device-btn-scratch')?.addEventListener('click', () => {
        this.analyser.synth.playScratch();
      });
      this.rootEl.querySelector('#device-btn-autobeat')?.addEventListener('click', (e) => {
        const playing = this.analyser.synth.toggleAutoBeat();
        (e.currentTarget as HTMLElement).textContent = playing ? '⏹ Parar Beat' : '✨ Auto Beat';
      });

      this.rootEl.querySelector('#pad-kick')?.addEventListener('click', () => this.analyser.synth.playKick());
      this.rootEl.querySelector('#pad-snare')?.addEventListener('click', () => this.analyser.synth.playSnare());
      this.rootEl.querySelector('#pad-hihat')?.addEventListener('click', () => this.analyser.synth.playHiHat());
      this.rootEl.querySelector('#pad-clap')?.addEventListener('click', () => this.analyser.synth.playClap());
      this.rootEl.querySelector('#pad-drop')?.addEventListener('click', () => this.analyser.synth.playBassDrop());
      this.rootEl.querySelector('#pad-laser')?.addEventListener('click', () => this.analyser.synth.playLaser());

      this.rootEl.querySelectorAll('.hud-key-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const idx = parseInt((e.currentTarget as HTMLElement).getAttribute('data-note-index') || '0', 10);
          this.analyser.synth.playNote(NOTE_FREQS[idx]);
        });
      });
    }

    // --- Eventos Pistas ---
    if (this.activeTab === 'tracks') {
      this.rootEl.querySelector('#device-track-play')?.addEventListener('click', () => {
        void this.analyser.toggle().then(() => this.updateTrackDisplay());
      });
      this.rootEl.querySelector('#device-track-prev')?.addEventListener('click', () => {
        void this.analyser.skip(-1).then(() => this.updateTrackDisplay());
      });
      this.rootEl.querySelector('#device-track-next')?.addEventListener('click', () => {
        void this.analyser.skip(1).then(() => this.updateTrackDisplay());
      });

      const sensSlider = this.rootEl.querySelector('#device-sens-slider') as HTMLInputElement;
      sensSlider?.addEventListener('input', (e) => {
        const val = parseFloat((e.target as HTMLInputElement).value);
        this.options.onSetSensitivity(val);
        const readout = this.rootEl?.querySelector('#device-sens-readout');
        if (readout) readout.textContent = `${val.toFixed(2)}x`;
      });
    }

    // --- Eventos Escena & XR ---
    if (this.activeTab === 'scene') {
      const scaleSlider = this.rootEl.querySelector('#device-scale-slider') as HTMLInputElement;
      scaleSlider?.addEventListener('input', (e) => {
        const val = parseFloat((e.target as HTMLInputElement).value);
        this.options.onSetScale(val);
        const readout = this.rootEl?.querySelector('#device-scale-readout');
        if (readout) readout.textContent = `${val.toFixed(2)}x`;
      });

      this.rootEl.querySelector('#device-mode-ar')?.addEventListener('click', () => {
        this.options.onSetMode(SessionMode.ImmersiveAR);
        this.updateSceneDisplay();
      });
      this.rootEl.querySelector('#device-mode-vr')?.addEventListener('click', () => {
        this.options.onSetMode(SessionMode.ImmersiveVR);
        this.updateSceneDisplay();
      });

      this.rootEl.querySelector('#device-enter-xr')?.addEventListener('click', () => {
        this.options.onLaunchXR();
      });
    }
  }

  private updateRadioDisplay(): void {
    if (!this.rootEl) return;
    const nameEl = this.rootEl.querySelector('#device-radio-name');
    const genreEl = this.rootEl.querySelector('#device-radio-genre');
    const playBtn = this.rootEl.querySelector('#device-radio-play');

    if (nameEl) nameEl.textContent = this.analyser.currentRadioStation.name;
    if (genreEl) genreEl.textContent = this.analyser.currentRadioStation.genre;
    if (playBtn) playBtn.textContent = this.analyser.isRadioPlaying ? '⏹ Pausar' : '▶ Play Radio';
  }

  private updateTrackDisplay(): void {
    if (!this.rootEl) return;
    const nameEl = this.rootEl.querySelector('#device-track-name');
    const posEl = this.rootEl.querySelector('#device-track-pos');
    const playBtn = this.rootEl.querySelector('#device-track-play');

    if (nameEl) nameEl.textContent = this.analyser.trackName;
    if (posEl) posEl.textContent = this.analyser.trackPosition;
    if (playBtn) playBtn.textContent = this.analyser.isPlaying ? 'Pausa' : 'Play';
  }

  private updateSceneDisplay(): void {
    if (!this.rootEl) return;
    const isAR = this.options.getMode() === SessionMode.ImmersiveAR;
    const arBtn = this.rootEl.querySelector('#device-mode-ar');
    const vrBtn = this.rootEl.querySelector('#device-mode-vr');

    if (arBtn) {
      if (isAR) arBtn.classList.add('hud-btn-primary');
      else arBtn.classList.remove('hud-btn-primary');
    }
    if (vrBtn) {
      if (!isAR) vrBtn.classList.add('hud-btn-primary');
      else vrBtn.classList.remove('hud-btn-primary');
    }
  }

  private buildKeyboardPanel(): void {
    this.kbdPanelEl = document.createElement('div');
    this.kbdPanelEl.id = 'keyboard-shortcuts-panel';
    this.kbdPanelEl.innerHTML = `
      <div class="kbd-container">
        <div class="kbd-header">
          <span class="kbd-title">⌨️ Atajos de Teclado (PC)</span>
          <button id="kbd-collapse-btn" class="kbd-collapse-btn" title="Minimizar">▼</button>
        </div>
        <div id="kbd-body" class="kbd-body">
          <div class="kbd-grid">
            <div class="kbd-row"><span class="kbd-badge" data-key=" ">Espacio</span><span class="kbd-desc">Kick 808</span></div>
            <div class="kbd-row"><span class="kbd-badge" data-key="c">C</span><span class="kbd-desc">Snare</span></div>
            <div class="kbd-row"><span class="kbd-badge" data-key="x">X</span><span class="kbd-desc">Hi-Hat</span></div>
            <div class="kbd-row"><span class="kbd-badge" data-key="v">V</span><span class="kbd-desc">Scratch</span></div>
            <div class="kbd-row"><span class="kbd-badge" data-key="z">Z</span><span class="kbd-desc">Clap</span></div>
            <div class="kbd-row"><span class="kbd-badge" data-key="d">D</span><span class="kbd-desc">Bass Drop</span></div>
            <div class="kbd-row"><span class="kbd-badge" data-key="l">L</span><span class="kbd-desc">Laser</span></div>
            <div class="kbd-row"><span class="kbd-badge" data-key="nums">1 - 8</span><span class="kbd-desc">Piano (Do..Do')</span></div>
            <div class="kbd-row"><span class="kbd-badge" data-key="r">R</span><span class="kbd-desc">Radio Web</span></div>
            <div class="kbd-row"><span class="kbd-badge" data-key="a">A</span><span class="kbd-desc">Auto Beat</span></div>
            <div class="kbd-row"><span class="kbd-badge" data-key="b">B</span><span class="kbd-desc">Panel Escena</span></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(this.kbdPanelEl);

    const collapseBtn = this.kbdPanelEl.querySelector('#kbd-collapse-btn');
    const body = this.kbdPanelEl.querySelector('#kbd-body');
    collapseBtn?.addEventListener('click', () => {
      this.isKbdMinimized = !this.isKbdMinimized;
      if (body) {
        if (this.isKbdMinimized) {
          body.classList.add('collapsed');
          collapseBtn.textContent = '▲';
        } else {
          body.classList.remove('collapsed');
          collapseBtn.textContent = '▼';
        }
      }
    });

    // Retroalimentacion visual al presionar teclas en PC
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      let selector = '';
      if (key >= '1' && key <= '8') {
        selector = '.kbd-badge[data-key="nums"]';
      } else {
        try {
          selector = `.kbd-badge[data-key="${CSS.escape(key)}"]`;
        } catch {
          return;
        }
      }
      try {
        const badge = this.kbdPanelEl?.querySelector(selector);
        if (badge) {
          badge.classList.add('kbd-active');
          setTimeout(() => badge.classList.remove('kbd-active'), 140);
        }
      } catch {
        // Ignorar posibles caracteres especiales no mapeados
      }
    };
    window.addEventListener('keydown', onKey);
  }

  dispose(): void {
    this.rootEl?.remove();
    this.rootEl = null;
    this.kbdPanelEl?.remove();
    this.kbdPanelEl = null;
  }
}
