const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const APP_JSON_PATH = path.join(ROOT_DIR, 'app.json');
const APP_VERSION_PATH = path.join(ROOT_DIR, 'src', 'constants', 'appVersion.js');
const BUILDS_DIR = path.join(ROOT_DIR, 'builds');

function readAppVersion() {
  try {
    const appJson = JSON.parse(fs.readFileSync(APP_JSON_PATH, 'utf8'));
    if (appJson?.expo?.version) return String(appJson.expo.version).trim();
  } catch {
    // Fallback para appVersion.js
  }
  try {
    const content = fs.readFileSync(APP_VERSION_PATH, 'utf8');
    const match = content.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (match?.[1]) return match[1].trim();
  } catch {
    // Ignora falha de leitura
  }
  return '1.3.0';
}

function parseJsonOutput(rawOutput) {
  const trimmed = String(rawOutput || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const startIdx = Math.min(
      ...[trimmed.indexOf('['), trimmed.indexOf('{')].filter((n) => n >= 0)
    );
    if (Number.isFinite(startIdx)) {
      try {
        return JSON.parse(trimmed.slice(startIdx));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function extractBuildUrl(parsed) {
  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  return (
    item?.artifacts?.buildUrl ||
    item?.artifacts?.applicationArchiveUrl ||
    null
  );
}

function downloadFile(url, destinationPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https://') ? https : http;
    const req = client.get(url, (res) => {
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location &&
        redirectsLeft > 0
      ) {
        res.resume();
        return resolve(downloadFile(res.headers.location, destinationPath, redirectsLeft - 1));
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Falha ao baixar APK (HTTP ${res.statusCode}).`));
      }

      const fileStream = fs.createWriteStream(destinationPath);
      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close(() => resolve(destinationPath));
      });
      fileStream.on('error', (err) => {
        fs.unlink(destinationPath, () => {});
        reject(err);
      });
    });

    req.on('error', (err) => reject(err));
  });
}

async function main() {
  const version = readAppVersion();
  fs.mkdirSync(BUILDS_DIR, { recursive: true });
  const targetApkPath = path.join(BUILDS_DIR, `olho-na-via-v${version}.apk`);

  console.log(`[Olho na Via] Iniciando build EAS Android (preview APK) v${version}...`);

  let rawBuildOut = '';
  try {
    rawBuildOut = execSync(
      'npx eas-cli build -p android --profile preview --wait --json',
      { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] }
    );
  } catch (err) {
    console.error('[Olho na Via] Falha ao executar eas-cli build:', err.message);
    process.exit(1);
  }

  let buildUrl = extractBuildUrl(parseJsonOutput(rawBuildOut));

  if (!buildUrl) {
    console.log('[Olho na Via] Buscando URL do último artefato via eas-cli build:list...');
    const listOut = execSync(
      'npx eas-cli build:list --platform android --profile preview --limit 1 --json --non-interactive',
      { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
    );
    buildUrl = extractBuildUrl(parseJsonOutput(listOut));
  }

  if (!buildUrl) {
    console.error(
      '[Olho na Via] Não foi possível localizar a URL do APK gerado no retorno do EAS.'
    );
    process.exit(1);
  }

  console.log(`[Olho na Via] Baixando APK para ${targetApkPath}...`);
  await downloadFile(buildUrl, targetApkPath);

  const stats = fs.statSync(targetApkPath);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`[Olho na Via] APK salvo com sucesso: ${targetApkPath} (${sizeMb} MB)`);
}

main().catch((err) => {
  console.error('[Olho na Via] Erro inesperado ao gerar/baixar APK:', err.message);
  process.exit(1);
});
