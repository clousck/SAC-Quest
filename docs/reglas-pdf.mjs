// Genera docs/reglas.pdf a partir de docs/reglas.md, para compartirlo.
//   node docs/reglas-pdf.mjs
// Usa `npx marked` (se descarga la primera vez) y Edge o Chrome sin ventana.
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const BROWSERS = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
]
const browser = BROWSERS.find((p) => p && existsSync(p))
if (!browser) {
  console.error('No se encontró Edge ni Chrome. Indica la ruta con BROWSER_PATH.')
  process.exit(1)
}

const body = execSync('npx --yes marked --gfm', { input: readFileSync(join(here, 'reglas.md')), encoding: 'utf8' })
const logo = readFileSync(join(here, '..', 'public', 'icon-192.png')).toString('base64')
const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>SAC Quest: cómo se juega</title>
<style>
  @page { size: A4; margin: 18mm 17mm; }
  body { font: 10.5pt/1.5 'Segoe UI', system-ui, sans-serif; color: #1a1d24; margin: 0; }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 4mm; }
  header img { width: 46px; height: 46px; }
  h1 { font-size: 20pt; margin: 0; color: #00679a; }
  h2 { font-size: 12.5pt; margin: 6mm 0 2mm; color: #00679a; border-bottom: 1px solid #c9d6de; padding-bottom: 1mm; break-after: avoid; }
  p, ul, ol { margin: 0 0 2.5mm; }
  ul, ol { padding-left: 5.5mm; }
  li { margin-bottom: 1mm; }
  code { font: inherit; font-weight: 600; color: #00679a; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 3mm; break-inside: avoid; }
  th, td { text-align: left; padding: 1.6mm 2.2mm; border: 1px solid #c9d6de; vertical-align: top; }
  th { background: #eaf2f6; }
</style>
</head>
<body>
<header><img src="data:image/png;base64,${logo}" alt=""><div></div></header>
${body}
<script>
  // La primera linea del .md es una nota para organizadores, no para el PDF.
  // El titulo va junto al logo.
  const h1 = document.querySelector('h1')
  h1.nextElementSibling.remove()
  document.querySelector('header div').append(h1)
</script>
</body>
</html>`

const dir = mkdtempSync(join(tmpdir(), 'reglas-'))
const page = join(dir, 'reglas.html')
const out = join(here, 'reglas.pdf')
writeFileSync(page, html)
try {
  execFileSync(
    browser,
    ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--user-data-dir=${join(dir, 'perfil')}`, `--print-to-pdf=${out}`, pathToFileURL(page).href],
    { stdio: 'ignore' },
  )
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(`Listo: ${out}`)
