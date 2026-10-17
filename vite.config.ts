import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * index.html's CSP only names the bridge at localhost. When the browser is told
 * to reach it by a network address instead (phone mode), allow that origin too,
 * or the health probe and the ElevenLabs /stt and /tts calls are blocked and the
 * phone silently falls back to browser speech.
 */
function bridgeCsp(bridgeUrl: string | undefined): Plugin {
  const origin = bridgeUrl ? new URL(bridgeUrl.replace(/^ws/, 'http')).origin : null
  const local = 'http://127.0.0.1:8787'
  return {
    name: 'jarvis-bridge-csp',
    transformIndexHtml: (html) =>
      origin && origin !== 'http://localhost:8787' && origin !== local
        ? html.replaceAll(local, `${local} ${origin}`)
        : html,
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // GitHub Pages serves a project site from /<repo>/, set by the Pages workflow.
  base: process.env.VITE_BASE || '/',
  plugins:[react(), bridgeCsp(loadEnv(mode, process.cwd(), 'VITE_').VITE_BRIDGE_URL)],
  server: {
    // Honour PORT so a second instance can run alongside the first. The bridge
    // only accepts sockets from localhost:5173-5199, so stay inside that range
    // or set JARVIS_ALLOWED_ORIGINS to match.
    port: Number(process.env.PORT) || 5173,
    // JARVIS_LAN=1 (set by scripts/start-phone.ps1) listens on the network as
    // well, so a phone on the same Wi-Fi can open the face.
    host: process.env.JARVIS_LAN === '1' ? true : undefined,
    // `tailscale serve` (phone mode on iPhone) reaches Vite as
    // <pc>.<tailnet>.ts.net, which Vite refuses unless it is listed.
    allowedHosts: ['.ts.net'],
    // Safari only allows the microphone on https, and an https page may not
    // open a plain ws:// socket. So over Tailscale the page reaches the bridge
    // through this server at /bridge: one secure origin, nothing mixed.
    proxy: {
      '/bridge': {
        target: 'http://127.0.0.1:8787',
        ws: true,
        rewrite: (path) => path.replace(/^\/bridge/, '') || '/',
      },
    },
  },
  optimizeDeps: {
    // kokoro-js pulls in `phonemizer`, which carries espeak-ng as inline WASM.
    // Vite's dependency pre-bundler rewrites that initialisation and the
    // language table ends up empty — the symptom is
    // `Invalid language identifier: "en". Should be one of: .` at generate()
    // time, long after the model has loaded successfully. Serving these
    // untouched fixes it.
    exclude: ['kokoro-js', 'phonemizer', '@huggingface/transformers'],
  },
}))
