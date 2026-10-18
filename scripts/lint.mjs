import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const required = ['index.html', 'privacy-policy.html', 'third-party-licenses.html', 'LICENSE', 'ads.txt', 'robots.txt', 'sitemap.xml', 'THIRD_PARTY_LICENSES.md'];
const problems = [];

for (const file of required) {
  const path = join(root, file);
  if (!existsSync(path)) {
    problems.push(`Missing required file: ${file}`);
  }
}

const indexHtml = existsSync(join(root, 'index.html')) ? readFileSync(join(root, 'index.html'), 'utf8') : '';
const privacyHtml = existsSync(join(root, 'privacy-policy.html')) ? readFileSync(join(root, 'privacy-policy.html'), 'utf8') : '';
const licensesHtml = existsSync(join(root, 'third-party-licenses.html')) ? readFileSync(join(root, 'third-party-licenses.html'), 'utf8') : '';
const robotsTxt = existsSync(join(root, 'robots.txt')) ? readFileSync(join(root, 'robots.txt'), 'utf8') : '';

if (!indexHtml.includes('<meta name="description"')) problems.push('index.html is missing a meta description tag.');
if (indexHtml.includes('G-PLACEHOLDER')) problems.push('index.html still contains the placeholder Google Analytics ID.');
if (privacyHtml.includes('about.html') || privacyHtml.includes('contact.html')) problems.push('privacy-policy.html still contains broken about/contact links.');
if (!indexHtml.includes('privacy-policy.html')) problems.push('index.html does not include the privacy policy link.');
if (!indexHtml.includes('third-party-licenses.html')) problems.push('index.html does not include the third-party licenses page link.');
if (!licensesHtml.includes('Third-Party Licenses and Notices')) problems.push('third-party-licenses.html is missing the licenses page heading.');
if (!existsSync(join(root, 'assets/social-preview.svg'))) problems.push('Missing social preview image: assets/social-preview.svg.');
if (indexHtml.includes('netlify.app') || robotsTxt.includes('netlify.app')) problems.push('SEO metadata still contains the old Netlify domain.');
if (/Disallow:\s*\/(?:css|js)\/?/i.test(robotsTxt)) problems.push('robots.txt must allow search engines to fetch CSS and JavaScript assets.');

if (problems.length > 0) {
  console.error('Lint failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log('Lint passed.');
