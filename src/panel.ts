/**
 * PanelSystem — Ciclo de vida de la sesion XR, seleccion de modo y visualizacion adaptativa.
 *
 * Diseno de Doble Visualizacion:
 * 1. MODO 2D (PC, Celular o Tablet):
 *    - Los paneles espaciales 3D dentro del mundo flotante se OCULTAN para no
 *      obstruir la vista plana de la esfera y evitar controles 3D incomodos.
 *    - Se despliega DeviceUI: una interfaz 2D responsive adaptada a pantallas
 *      tactiles y raton, con pestanas para Tornamesa, Pistas, Escena y entrada a XR.
 *
 * 2. MODO XR (Meta Quest / Lentes de Realidad Virtual):
 *    - La interfaz 2D se oculta por completo.
 *    - Los paneles espaciales 3D (welcome-panel y dj-panel) se hacen visibles en el entorno.
 *    - El panel de ajustes (scene-panel) se acopla a la muneca/control derecho
 *      (gripSpaces.right) y solo se muestra al presionar el boton fisico "B" del control.
 */

import {
  createSystem,
  SessionMode,
  UIKitMLAsset,
  VisibilityState,
} from '@iwsdk/core';
import { PointCloud } from './point-cloud-component.js';
import { DeviceUI } from './device-ui.js';

export class PanelSystem extends createSystem({
  clouds: { required: [PointCloud] },
}) {
  /** Modo elegido en el panel de escena. Arranca en passthrough. */
  private mode: SessionMode = SessionMode.ImmersiveAR;
  private currentScale = 1.0;

  // Interfaz adaptativa 2D para PC y moviles
  private deviceUI: DeviceUI | null = null;

  // Referencias a los paneles 3D del mundo
  private scenePanelObj: any = null;
  private modeReadout: any = null;
  private modeArButton: any = null;
  private modeVrButton: any = null;
  private sceneXrLabel: any = null;
  private scaleReadout: any = null;

  // Estado del boton "B" en XR
  private wasBPressedXR = false;
  private isVRPanelVisible = false;
  private isAttachedToGrip = false;

  init(): void {
    // Inicializar la interfaz 2D adaptativa para PC y moviles
    this.deviceUI = new DeviceUI({
      onSetScale: (scale) => this.setSphereScale(scale),
      onSetSensitivity: (sens) => this.setSensitivity(sens),
      onSetMode: (mode) => this.setMode(mode),
      onLaunchXR: () => this.launch(),
      getMode: () => this.mode,
      getScale: () => this.currentScale,
    });

    this.wireScenePanel();
    this.wireWelcomePanel();
    this.setupKeyboardShortcut();

    // Sincronizar visibilidad al cambiar entre 2D y XR
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        const isXR = state !== VisibilityState.NonImmersive;
        this.syncPanelsVisibility(isXR);
      }),
      () => this.deviceUI?.dispose(),
    );

    // Estado inicial en 2D
    this.syncPanelsVisibility(false);
  }

  update(): void {
    // Si scene-panel aun no se acoplo al mando derecho en init, reintentar
    if (!this.isAttachedToGrip) {
      this.attachScenePanelToRightGrip();
    }

    const isXR = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    this.syncPanelsVisibility(isXR);

    // En XR: detectar boton fisico "B" en el mando derecho
    if (isXR) {
      const session = this.world.session;
      if (session) {
        for (const source of session.inputSources) {
          if (source.handedness === 'right' && source.gamepad) {
            // buttons[5] es el boton "B" en mandos Oculus Touch de WebXR
            const bPressed = source.gamepad.buttons[5]?.pressed ?? false;
            if (bPressed && !this.wasBPressedXR) {
              this.toggleXRScenePanel();
            }
            this.wasBPressedXR = bPressed;
          }
        }
      }
    }
  }

  /**
   * Sincroniza la visibilidad de los paneles:
   * - En 2D (PC/Movil): Paneles 3D ocultos, UI 2D visible.
   * - En XR: Paneles 3D visibles en el mundo, UI 2D oculta.
   */
  private syncPanelsVisibility(isXR: boolean): void {
    const welcome = this.world.getSceneObject('welcome-panel');
    const dj = this.world.getSceneObject('dj-panel');
    const banner = this.world.getSceneObject('webxr-banner');
    const scene = this.world.getSceneObject('scene-panel');

    if (welcome) welcome.visible = isXR;
    if (dj) dj.visible = isXR;
    if (banner) banner.visible = isXR;

    if (scene) {
      // En XR se muestra solo si el usuario pulso "B"
      scene.visible = isXR ? this.isVRPanelVisible : false;
    }

    if (this.deviceUI) {
      if (isXR) {
        this.deviceUI.hide();
      } else {
        this.deviceUI.show();
        this.deviceUI.syncState();
      }
    }
  }

  /**
   * Acopla el scene-panel al control derecho del jugador para XR.
   */
  private attachScenePanelToRightGrip(): void {
    const panel = this.world.getSceneObject('scene-panel');
    const rightGrip = this.world.playerSpaceEntities.gripSpaces.right?.object3D;

    if (!panel || !rightGrip) {
      return;
    }

    this.scenePanelObj = panel;
    this.scenePanelObj.visible = false;
    this.isVRPanelVisible = false;

    // Emparentar al mando derecho
    rightGrip.add(this.scenePanelObj);

    // Posicionar justo arriba de la muneca / control con angulo comodo de lectura
    this.scenePanelObj.position.set(0, 0.12, -0.05);
    this.scenePanelObj.rotation.set(-Math.PI / 4, 0, 0);
    this.scenePanelObj.scale.setScalar(0.08);

    this.isAttachedToGrip = true;
  }

  /** Alterna visibilidad del panel 3D en el mando derecho (VR). */
  private toggleXRScenePanel(): void {
    if (!this.scenePanelObj) {
      this.attachScenePanelToRightGrip();
    }
    if (this.scenePanelObj) {
      this.isVRPanelVisible = !this.isVRPanelVisible;
      this.scenePanelObj.visible = this.isVRPanelVisible;
    }
  }

  private setupKeyboardShortcut(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'b' || e.key === 'B') {
        const isXR = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
        if (isXR) {
          this.toggleXRScenePanel();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    this.cleanupFuncs.push(() => window.removeEventListener('keydown', onKeyDown));
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
    this.scaleReadout = panel.getElementById('scale-readout');

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

  private setSphereScale(scale: number): void {
    this.currentScale = scale;
    for (const entity of this.queries.clouds.entities) {
      entity.setValue(PointCloud, 'scale', scale);
    }
    this.scaleReadout?.setProperties({ text: `${scale.toFixed(2)}x` });
    this.deviceUI?.syncState();
  }

  private setSensitivity(sensitivity: number): void {
    for (const entity of this.queries.clouds.entities) {
      entity.setValue(PointCloud, 'sensitivity', sensitivity);
    }
  }

  private refreshModeUI(): void {
    const isAR = this.mode === SessionMode.ImmersiveAR;
    this.modeArButton?.setProperties({
      variant: isAR ? 'primary' : 'secondary',
    });
    this.modeVrButton?.setProperties({
      variant: isAR ? 'secondary' : 'primary',
    });
    this.modeReadout?.setProperties({
      text: isAR ? 'Passthrough' : 'VR inmersivo',
    });
    this.deviceUI?.syncState();
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
