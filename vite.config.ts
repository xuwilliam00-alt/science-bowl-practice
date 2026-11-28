import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

/** Lists every .json file in public/ (any subfolder) in banks-manifest.json, so the site can load them all as question banks.
 *  A browser cannot list a folder by itself, so this runs when the site is built (and in `npm run dev`). */
function jsonManifest(): Plugin {
  const list = () => {
    const dir = path.resolve('public'); if (!fs.existsSync(dir)) return []
    const out: string[] = []
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.json$/i.test(e.name) && e.name !== 'banks-manifest.json') out.push(path.relative(dir, p).split(path.sep).join('/')) } }
    walk(dir); return out.sort()
  }
  return {
    name: 'json-manifest',
    buildStart() { this.emitFile({ type: 'asset', fileName: 'banks-manifest.json', source: JSON.stringify({ files: list() }) }) },
    configureServer(server) { server.middlewares.use('/banks-manifest.json', (_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ files: list() })) }) },
  }
}
// base './' lets the build work under any GitHub Pages repo path.
export default defineConfig({ base: './', plugins: [react(), jsonManifest()] })
