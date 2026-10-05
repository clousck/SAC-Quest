// Copia de seguridad: una instantanea consistente de la base (VACUUM INTO,
// funciona con el servidor andando) y una copia incremental de las fotos.
//   npm run backup -- /media/usb/sac-quest-backup
// Pensado para cron (ver docs/docker.md).
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { loadConfig } from '../src/config.js'

try {
  process.loadEnvFile()
} catch {
  // sin .env
}

const KEEP = 48 // instantaneas de la base que se conservan
const target = resolve(process.argv[2] || process.env.BACKUP_DIR || '')
if (!process.argv[2] && !process.env.BACKUP_DIR) {
  console.error('Uso: npm run backup -- <carpeta destino>   (o BACKUP_DIR)')
  process.exit(1)
}

const config = loadConfig()
const dbDir = join(target, 'db')
await mkdir(dbDir, { recursive: true })

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const snapshot = join(dbDir, `quest-${stamp}.db`)
const db = new DatabaseSync(join(config.dataDir, 'quest.db'), { readOnly: true })
db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`)
db.close()

// Fotos: solo copia las nuevas (nunca se modifican una vez escritas).
await cp(join(config.dataDir, 'files'), join(target, 'files'), {
  recursive: true,
  force: false,
  errorOnExist: false,
}).catch((e) => {
  if (e.code !== 'ENOENT') throw e
})

const old = (await readdir(dbDir)).filter((f) => f.startsWith('quest-')).sort().slice(0, -KEEP)
await Promise.all(old.map((f) => rm(join(dbDir, f))))

console.log(`Backup listo: ${snapshot}`)
