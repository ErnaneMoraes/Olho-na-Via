const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ghpages = require('gh-pages');

const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectFilesByExt(dirPath, ext) {
  if (!fs.existsSync(dirPath)) return [];
  const results = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFilesByExt(fullPath, ext));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(ext.toLowerCase())) {
      results.push(fullPath);
    }
  }
  return results;
}

function flattenAndRewriteVectorIconFonts(baseUrl) {
  const vectorIconsAssetsDir = path.join(
    DIST_DIR,
    'assets',
    'node_modules',
    '@expo',
    'vector-icons'
  );
  const ttfFiles = collectFilesByExt(vectorIconsAssetsDir, '.ttf');
  if (ttfFiles.length === 0) {
    throw new Error(
      'Nenhum arquivo .ttf de ícone foi encontrado em dist/assets/node_modules/@expo/vector-icons.'
    );
  }

  const fontsOutDir = path.join(DIST_DIR, 'fonts');
  fs.mkdirSync(fontsOutDir, { recursive: true });

  for (const srcFile of ttfFiles) {
    const destFile = path.join(fontsOutDir, path.basename(srcFile));
    fs.copyFileSync(srcFile, destFile);
  }

  fs.rmSync(path.join(DIST_DIR, 'assets', 'node_modules'), { recursive: true, force: true });

  const webJsDir = path.join(DIST_DIR, '_expo', 'static', 'js', 'web');
  const jsFiles = collectFilesByExt(webJsDir, '.js');
  const fontUrlRegex = new RegExp(
    `(?:${escapeRegExp(baseUrl)})?/assets/node_modules/@expo/vector-icons/[^"'\\s\`]*?/([^/"'\\s\`]+\\.ttf)`,
    'g'
  );

  let totalRewrites = 0;
  for (const jsFile of jsFiles) {
    const original = fs.readFileSync(jsFile, 'utf8');
    let fileRewrites = 0;
    const updated = original.replace(fontUrlRegex, (_, fileName) => {
      fileRewrites += 1;
      return `${baseUrl}/fonts/${fileName}`;
    });

    if (fileRewrites > 0) {
      fs.writeFileSync(jsFile, updated, 'utf8');
      totalRewrites += fileRewrites;
    }

    if (/\/assets\/node_modules\/@expo\/vector-icons\/[^"'\s`]*\.ttf/i.test(updated)) {
      throw new Error(
        `Referências antigas de fontes @expo/vector-icons permaneceram em ${path.basename(jsFile)}.`
      );
    }
  }

  console.log(
    `[Olho na Via] Fontes de ícones preparadas em dist/fonts/ (${ttfFiles.length} arquivos .ttf, ${totalRewrites} referências reescritas).`
  );
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error('Arquivo .env não encontrado na raiz do projeto.');
  }

  const parsed = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function resolveGitHubRepoInfo() {
  let username = 'ErnaneMoraes';
  let repoSlug = 'Olho-na-Via';

  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/i);
    if (match) {
      username = match[1];
      repoSlug = match[2];
    }
  } catch {
    // Mantém fallback padrão do repositório configurado
  }

  return { username, repoSlug };
}

function publishToGhPages(distDir) {
  return new Promise((resolve, reject) => {
    ghpages.publish(
      distDir,
      {
        dotfiles: true,
        message: 'deploy: publicar Olho na Via Web no GitHub Pages',
      },
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

async function main() {
  const envFromFile = loadEnvFile(ENV_PATH);
  const mergedEnv = { ...process.env, ...envFromFile };

  if (
    !mergedEnv.EXPO_PUBLIC_SUPABASE_URL ||
    !mergedEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY
  ) {
    throw new Error(
      'Variáveis EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY são obrigatórias no arquivo .env.'
    );
  }

  const { username, repoSlug } = resolveGitHubRepoInfo();
  const baseUrl = `/${repoSlug}`;
  const liveUrl = `https://${username.toLowerCase()}.github.io/${repoSlug}/`;
  const supabaseRedirectUrl = `${liveUrl}**`;

  console.log(`[Olho na Via] Preparando build Web estático para GitHub Pages (${baseUrl})...`);

  fs.rmSync(DIST_DIR, { recursive: true, force: true });

  execSync('npx expo export --platform web', {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: true,
    env: {
      ...mergedEnv,
      GITHUB_PAGES: 'true',
      GITHUB_PAGES_BASE_URL: baseUrl,
    },
  });

  const indexHtmlPath = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error('Build Web concluído, mas dist/index.html não foi gerado.');
  }

  const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');
  if (!indexHtmlContent.includes(`${baseUrl}/_expo/`)) {
    console.warn(
      `[Olho na Via] Aviso: dist/index.html não contém referências com prefixo "${baseUrl}/_expo/". Verifique experiments.baseUrl.`
    );
  }

  fs.writeFileSync(path.join(DIST_DIR, '.nojekyll'), '');
  fs.copyFileSync(indexHtmlPath, path.join(DIST_DIR, '404.html'));

  flattenAndRewriteVectorIconFonts(baseUrl);

  console.log('[Olho na Via] Publicando arquivos estáticos na branch gh-pages...');
  await publishToGhPages(DIST_DIR);

  try {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  } catch {
    // Limpeza auxiliar não crítica
  }

  console.log('');
  console.log('[Olho na Via] Deploy no GitHub Pages concluído com sucesso!');
  console.log(`URL pública do app: ${liveUrl}`);
  console.log(`URL de redirecionamento no Supabase Auth: ${supabaseRedirectUrl}`);
}

main().catch((err) => {
  console.error(`[Olho na Via] Falha no deploy Web: ${err?.message || err}`);
  process.exit(1);
});
