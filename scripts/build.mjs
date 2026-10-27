import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const appVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const required = [
  'index.html',
  '404.html',
  'privacy-policy.html',
  'third-party-licenses.html',
  'THIRD_PARTY_LICENSES.md',
  'LICENSE',
  'ads.txt',
  'robots.txt',
  'sitemap.xml',
  'manifest.webmanifest',
  'server/provider-api.js',
  'functions/api/weather.js',
  'functions/api/news.js',
  'functions/api/status.js',
  'functions/api/[[path]].js',
  'assets/favicon.svg',
  'assets/social-preview.svg',
  'css/style.css',
  'js/script.js',
  'js/ads.js',
  '_headers',
  'sw.js'
];

const missing = required.filter(file => !existsSync(join(root, file)));
if (missing.length > 0) {
  console.error('Build validation failed:');
  for (const file of missing) console.error(`- Missing ${file}`);
  process.exit(1);
}

const configuredSiteUrl = process.env.SITE_URL || process.env.CF_PAGES_URL || 'https://skycast.pages.dev';
let siteUrl;
try {
  const parsedSiteUrl = new URL(configuredSiteUrl);
  if (parsedSiteUrl.protocol !== 'https:' || parsedSiteUrl.username || parsedSiteUrl.password) {
    throw new Error();
  }
  siteUrl = parsedSiteUrl.href.replace(/\/+$/, '');
} catch {
  console.error('Build validation failed: SITE_URL must be an absolute HTTPS URL.');
  process.exit(1);
}

const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
if (!indexHtml.includes('<title>SkyCast')) {
  console.error('Build validation failed: index.html does not contain the expected page title.');
  process.exit(1);
}

const output = join(root, 'dist');
mkdirSync(output, { recursive: true });
for (const file of [
  'index.html',
  '404.html',
  'privacy-policy.html',
  'third-party-licenses.html',
  'manifest.webmanifest',
  'sw.js',
  '_headers',
  'ads.txt',
  'robots.txt',
  'sitemap.xml',
  'LICENSE',
  'THIRD_PARTY_LICENSES.md'
]) {
  cpSync(join(root, file), join(output, file));
}
for (const directory of ['assets', 'css', 'js']) {
  cpSync(join(root, directory), join(output, directory), { recursive: true });
}

for (const file of ['index.html', '404.html', 'robots.txt', 'sitemap.xml']) {
  const path = join(output, file);
  const contents = readFileSync(path, 'utf8')
    .replaceAll('__SKYCAST_SITE_URL__', siteUrl)
    .replaceAll('__SKYCAST_VERSION__', appVersion);
  if (contents.includes('__SKYCAST_SITE_URL__')) {
    console.error(`Build validation failed: unresolved site URL in ${file}.`);
    process.exit(1);
  }
  writeFileSync(path, contents);
}

const secretNames = [
  'OPENWEATHER_API_KEY',
  'OPEN_METEO_API_KEY',
  'GNEWS_API_KEY',
  'MAP_API_KEY',
  'SATELLITE_API_KEY',
  'FIRMS_MAP_KEY'
];
const secrets = new Map(secretNames.map((name) => [name, process.env[name] || '']));
const dotenvPath = join(root, '.env');
if (existsSync(dotenvPath)) {
  for (const line of readFileSync(dotenvPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*)$/);
    if (!match || !secretNames.includes(match[1]) || process.env[match[1]]) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    if (value) secrets.set(match[1], value);
  }
}

function assertNoSecrets(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      assertNoSecrets(path);
      continue;
    }
    const contents = readFileSync(path);
    for (const [name, value] of secrets) {
      if (value && contents.includes(value)) {
        console.error(`Build validation failed: configured secret ${name} appears in generated file ${path.slice(output.length + 1)}.`);
        process.exit(1);
      }
    }
  }
}

assertNoSecrets(output);
console.log(`Production static build created in dist/ for ${siteUrl}.`);
