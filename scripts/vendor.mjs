// Kopiert autoconsent (DuckDuckGo, MPL-2.0) unverändert nach extension/vendor/autoconsent/.
// Aufruf nach einem Update von @duckduckgo/autoconsent:  npm run vendor
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', '@duckduckgo', 'autoconsent');
const ziel = path.join(root, 'extension', 'vendor', 'autoconsent');
const version = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')).version;

fs.rmSync(ziel, { recursive: true, force: true });
fs.mkdirSync(ziel, { recursive: true });
const dateien = {
  'dist/addon-mv3/content.bundle.js': 'content.bundle.js', // Content Script von autoconsent (unverändert)
  'dist/autoconsent.esm.js': 'autoconsent.esm.js', // für den Service Worker: evalSnippets, filterCompactRules
  'rules/compact-rules.json': 'compact-rules.json',
  'rules/rules.json': 'rules.json', // vollständige Regeln mit Zustimmen-Schritten (für „Zustimmen“ je Seite)
  LICENSE: 'LICENSE',
};
for (const [von, nach] of Object.entries(dateien)) fs.copyFileSync(path.join(src, von), path.join(ziel, nach));
fs.writeFileSync(
  path.join(ziel, 'README.md'),
  `# autoconsent ${version}\n\nQuelle: https://github.com/duckduckgo/autoconsent (npm \`@duckduckgo/autoconsent@${version}\`)\n` +
    `Lizenz: Mozilla Public License 2.0 (siehe LICENSE). Dateien unverändert übernommen mit \`npm run vendor\`.\n`,
);
console.log(`autoconsent ${version} nach extension/vendor/autoconsent/ kopiert`);
