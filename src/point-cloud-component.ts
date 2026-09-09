/**
 * Declaracion del componente PointCloud.
 *
 * Va en su propio modulo, sin systems ni imports de render, porque el editor
 * importa este manifest para construir su inspector. Los systems importan la
 * declaracion, nunca al reves.
 */

import { createComponent, Types } from '@iwsdk/core';

export const PointCloud = createComponent('PointCloud', {
  /**
   * Multiplicador de sensibilidad al audio. Lo escribe el slider del panel de
   * audio y lo lee el PointCloudSystem en cada frame.
   */
  sensitivity: { type: Types.Float32, default: 1.2 },

  /**
   * Multiplicador de tamano de la esfera. Lo escribe el slider del panel de
   * escena; el sistema lo pasa al shader como uniform.
   */
  scale: { type: Types.Float32, default: 1 },
});
