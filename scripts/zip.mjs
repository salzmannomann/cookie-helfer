// Packt extension/ als dist/cookie-helfer-<version>.zip (Ordner „cookie-helfer“ im ZIP)
// und gibt den Terminal-Befehl zum Aktualisieren aus.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== version) throw new Error(`Version passt nicht: manifest ${version}, package.json ${pkg.version}`);

const dist = path.join(root, 'dist');
const tmp = path.join(dist, 'tmp');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
fs.cpSync(path.join(root, 'extension'), path.join(tmp, 'cookie-helfer'), { recursive: true });
const zip = path.join(dist, `cookie-helfer-${version}.zip`);
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-qr', '-X', zip, 'cookie-helfer'], { cwd: tmp });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${path.relative(root, zip)} (${Math.round(fs.statSync(zip).size / 1024)} KB)`);
console.log(`\nAktualisieren:\nf=$(ls -t ~/Downloads/cookie-helfer-*.zip | head -1) && rm -rf /tmp/ch && unzip -q "$f" -d /tmp/ch && rsync -a --delete /tmp/ch/cookie-helfer/ ~/Documents/Chrome/cookiehelfer/ && echo "Aktualisiert mit $f"`);
