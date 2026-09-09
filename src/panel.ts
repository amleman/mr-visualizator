/**
 * PanelSystem — ciclo de vida de la sesion XR y seleccion de modo.
 *
 * Passthrough vs VR no es un switch dentro de la sesion: son dos session modes
 * distintos de WebXR ('immersive-ar' e 'immersive-vr'). Cambiar de uno a otro
 * obliga a cerrar la sesion y pedir una nueva.
 */

import {
  createSystem,
  SessionMode,
  UIKitMLAsset,
  VisibilityState,
} from '@iwsdk/core';

export class PanelSystem extends createSystem({}) {
  /** Modo elegido en el panel de escena. Arranca en passthrough. */
  private mode: SessionMode = SessionMode.ImmersiveAR;

  private modeReadout: any = null;
  private modeArButton: any = null;
  private modeVrButton: any = null;
  private sceneXrLabel: any = null;

  init(): void {
    this.wireScenePanel();
    this.wireWelcomePanel();
  }

  /** Lanza XR con el modo actualmente elegido. */
  private launch(): void {
    this.world.launchXR({ sessionMode: this.mode });
  }

  private wireScenePanel(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('scene-panel');
    if (panel == null) {
      return;
    }

    this.modeReadout = panel.getElementById('mode-readout');
    this.modeArButton = panel.getElementById('mode-ar');
    this.modeVrButton = panel.getElementById('mode-vr');
    this.sceneXrLabel = panel.getElementById('scene-xr-label');

    const pickAR = () => this.setMode(SessionMode.ImmersiveAR);
    const pickVR = () => this.setMode(SessionMode.ImmersiveVR);

    this.modeArButton?.addEventListener('click', pickAR);
    this.modeVrButton?.addEventListener('click', pickVR);
    this.cleanupFuncs.push(
      () => this.modeArButton?.removeEventListener('click', pickAR),
      () => this.modeVrButton?.removeEventListener('click', pickVR),
    );

    const xrButton = panel.getElementById('scene-xr-button');
    const toggleSession = () => {
      if (this.world.visibilityState.peek() === VisibilityState.NonImmersive) {
        this.launch();
      } else {
        this.world.exitXR();
      }
    };
    xrButton?.addEventListener('click', toggleSession);
    this.cleanupFuncs.push(
      () => xrButton?.removeEventListener('click', toggleSession),
    );

    this.refreshModeUI();
  }

  /**
   * Cambia el modo elegido. Si ya hay una sesion corriendo la cierra y pide una
   * nueva con el modo nuevo.
   *
   * El relanzado va dentro del callback de 'visibilitychange' y no justo despues
   * de exitXR(): requestSession necesita que la sesion anterior este realmente
   * cerrada. Aun asi puede fallar por falta de user gesture — algunos
   * navegadores consumen el gesto del click en el exit. Si pasa, el usuario ve
   * el panel 2D y vuelve a entrar con un toque.
   */
  private setMode(mode: SessionMode): void {
    if (this.mode === mode) {
      return;
    }
    this.mode = mode;
    this.refreshModeUI();

    const inSession =
      this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (!inSession) {
      return;
    }

    const relaunch = () => {
      if (this.world.visibilityState.peek() === VisibilityState.NonImmersive) {
        unsubscribe();
        this.launch();
      }
    };
    const unsubscribe = this.world.visibilityState.subscribe(relaunch);
    this.cleanupFuncs.push(unsubscribe);

    this.world.exitXR();
  }

  private refreshModeUI(): void {
    const isAR = this.mode === SessionMode.ImmersiveAR;
    // El kit Horizon no expone un estado "seleccionado", asi que el variant
    // hace de indicador: primary es el activo, secondary el inactivo.
    this.modeArButton?.setProperties({
      variant: isAR ? 'primary' : 'secondary',
    });
    this.modeVrButton?.setProperties({
      variant: isAR ? 'secondary' : 'primary',
    });
    this.modeReadout?.setProperties({
      text: isAR ? 'Passthrough' : 'VR inmersivo',
    });
  }

  private wireWelcomePanel(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('welcome-panel');
    const xrButton = panel?.getElementById('xr-button');
    const exitButton = panel?.getElementById('exit-button');
    if (xrButton == null || exitButton == null) {
      return;
    }

    if (!this.world.xrEnabled) {
      xrButton.setProperties({ display: 'none' });
      exitButton.setProperties({ display: 'none' });
      return;
    }

    const launchXR = () => this.launch();
    const exitXR = () => this.world.exitXR();
    xrButton.addEventListener('click', launchXR);
    exitButton.addEventListener('click', exitXR);
    this.cleanupFuncs.push(
      () => xrButton.removeEventListener('click', launchXR),
      () => exitButton.removeEventListener('click', exitXR),
      this.world.visibilityState.subscribe((visibilityState) => {
        const is2D = visibilityState === VisibilityState.NonImmersive;
        xrButton.setProperties({ display: is2D ? 'flex' : 'none' });
        exitButton.setProperties({ display: is2D ? 'none' : 'flex' });
        this.sceneXrLabel?.setProperties({ text: is2D ? 'Entrar' : 'Salir' });
      }),
    );
  }
}
