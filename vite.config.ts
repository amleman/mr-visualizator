/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig, type Plugin } from 'vite';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const port = parseInt(process.env.PORT || '8082', 10);

/**
 * Dominio permitido para streaming de radio.
 * Previene ataques de SSRF (Server-Side Request Forgery) y redirecciones arbitrarias.
 */
const ALLOWED_STREAM_HOST_REGEX = /^([a-zA-Z0-9-]+\.)*somafm\.com$/i;

/**
 * Rangos y direcciones IP privadas/restringidas bloqueadas para mitigar SSRF.
 */
function isRestrictedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '0.0.0.0' ||
    lower === '::1' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }

  // Comprobar si coincide con IPv4 privada o de enlace local / metadata
  const ipv4Match = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const a = parseInt(ipv4Match[1], 10);
    const b = parseInt(ipv4Match[2], 10);
    // 10.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16 (metadata), 172.16.0.0/12, 192.168.0.0/16
    if (a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
  }

  return false;
}

/**
 * Plugin de Vite para retransmitir streams de radio con validaciones de seguridad:
 * - Prevencion estricta de SSRF (solo hosts autorizados de somaFM).
 * - Restriccion de protocolo (solo HTTPS o HTTP seguro permitido).
 * - Bloqueo de redirecciones circulares o a hosts internos / metadata de nube.
 * - Cabeceras de seguridad HTTP y control de metodos HTTP (solo GET/HEAD).
 * - Timeouts en conexiones para evitar agotamiento de sockets (Slowloris).
 */
function radioStreamProxy(): Plugin {
  const stationMap: Readonly<Record<string, string>> = Object.freeze({
    '/vaporwaves': 'https://ice2.somafm.com/vaporwaves-128-mp3',
    '/groovesalad': 'https://ice2.somafm.com/groovesalad-128-mp3',
    '/defcon': 'https://ice2.somafm.com/defcon-128-mp3',
  });

  function validateTargetUrl(targetUrl: string): URL | null {
    try {
      const parsed = new URL(targetUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return null;
      }
      if (isRestrictedHost(parsed.hostname)) {
        return null;
      }
      if (!ALLOWED_STREAM_HOST_REGEX.test(parsed.hostname)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function streamFromUrl(targetUrl: string, res: http.ServerResponse, redirectCount = 0): void {
    if (redirectCount > 2) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Demasiados redireccionamientos en el stream');
      return;
    }

    const parsed = validateTargetUrl(targetUrl);
    if (!parsed) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Destino de stream no permitido o invalido por politica de seguridad');
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;

    const clientReq = client.get(
      parsed.href,
      {
        headers: {
          'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
          'Accept': '*/*',
        },
        timeout: 10000,
      },
      (proxyRes) => {
        // Seguir redirecciones 301 / 302 con validacion estricta
        if (
          proxyRes.statusCode &&
          proxyRes.statusCode >= 300 &&
          proxyRes.statusCode < 400 &&
          proxyRes.headers.location
        ) {
          const nextLocation = new URL(proxyRes.headers.location, parsed.href).href;
          streamFromUrl(nextLocation, res, redirectCount + 1);
          return;
        }

        const contentType = proxyRes.headers['content-type'] || 'audio/mpeg';
        res.writeHead(proxyRes.statusCode || 200, {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Connection': 'keep-alive',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'SAMEORIGIN',
        });

        proxyRes.pipe(res);
      },
    );

    clientReq.on('timeout', () => {
      clientReq.destroy(new Error('Timeout esperando respuesta de la estacion'));
    });

    clientReq.on('error', (err) => {
      console.warn('[Radio Proxy] Error conectando con el stream:', err.message);
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Error de conexion con la estacion');
      }
    });

    res.on('close', () => {
      clientReq.destroy();
    });
  }

  return {
    name: 'radio-stream-proxy',
    configureServer(server) {
      server.middlewares.use('/api/radio', (req, res) => {
        // Solo permitir metodos GET o HEAD
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET, HEAD');
          res.end('Metodo no permitido');
          return;
        }

        const cleanPath = (req.url || '').split('?')[0];
        // Proteccion contra acceso a propiedades de prototipo
        if (!Object.prototype.hasOwnProperty.call(stationMap, cleanPath)) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Estacion no encontrada o no autorizada');
          return;
        }

        const targetUrl = stationMap[cleanPath];
        streamFromUrl(targetUrl, res);
      });
    },
  };
}

export default defineConfig({
  plugins: [iwsdkDev(), radioStreamProxy()],
  server: {
    host: '0.0.0.0',
    port,
    open: false,
    strictPort: false,
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'no-referrer',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
