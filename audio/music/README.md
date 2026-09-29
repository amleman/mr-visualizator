# Pistas de audio

Esta carpeta está vacía a propósito: las pistas usadas durante el desarrollo son
material con copyright y no se versionan.

Para hacer andar el visualizador:

1. Copiá uno o más archivos `.mp3` en esta carpeta.
2. Actualizá el array `TRACKS` en [`src/audio-analyser.ts`](../../../src/audio-analyser.ts)
   con los nombres exactos de los archivos, con extensión incluida.

```ts
export const TRACKS = [
  'mi-cancion.mp3',
  'otra-cancion.mp3',
];
```

Los nombres pueden tener espacios, comas y paréntesis — la URL se arma con
`encodeURI`, que los maneja bien. Cualquier formato que reproduzca el navegador
sirve; `.mp3` es la opción más segura.
