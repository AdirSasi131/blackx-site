// Usage: npm run backup   -> writes data/backups/app-YYYY-MM-DD-HHMM.db (a consistent copy of the database)
import fs from 'node:fs';
import path from 'node:path';
try { process.loadEnvFile(path.resolve('.env')); } catch {}
const { db, DATA_DIR } = await import('../lib/db.js');
const dir = path.join(DATA_DIR, 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, (c) => (c === 'T' ? '-' : c === ':' ? '' : '-'));
const file = path.join(dir, `app-${stamp}.db`);
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
console.log(`Backup written: ${file}\nUploaded media lives in ${path.join(DATA_DIR, 'uploads')} (copy that folder too).`);
