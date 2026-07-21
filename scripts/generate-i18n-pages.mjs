import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIST_DIR = path.resolve(__dirname, '../dist');
const LOCALES_DIR = path.resolve(__dirname, '../public/locales');
const SITE_URL = (process.env.SITE_URL || 'https://www.bentopdf.com').replace(
  /\/+$/,
  ''
);
const BRAND_NAME = process.env.VITE_BRAND_NAME || 'BentoPDF';
const BASE_PATH = (process.env.BASE_URL || '/').replace(/\/$/, '');

const ORGANIZATION_LD_MARKER = 'data-bentopdf-organization';
const BREADCRUMB_MARKER = 'data-bentopdf-breadcrumb';

const KEY_MAPPING = {
  index: 'home',
  404: 'notFound',
};

const languages = fs
  .readdirSync(LOCALES_DIR)
  .filter((entry) => fs.statSync(path.join(LOCALES_DIR, entry)).isDirectory());

const toCamelCase = (str) =>
  str.replace(/-([a-z])/g, (match) => match[1].toUpperCase());

function readJson(filePath) {
  return fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    : {};
}

function loadAllTranslations() {
  const translations = {};
  for (const lang of languages) {
    if (lang === 'en') continue;
    translations[lang] = {
      common: readJson(path.join(LOCALES_DIR, `${lang}/common.json`)),
      tools: readJson(path.join(LOCALES_DIR, `${lang}/tools.json`)),
    };
  }
  return translations;
}

function loadEnglishTools() {
  const toolsPath = path.join(LOCALES_DIR, 'en/tools.json');
  return fs.existsSync(toolsPath)
    ? JSON.parse(fs.readFileSync(toolsPath, 'utf-8'))
    : {};
}

const ENGLISH_TOOLS = loadEnglishTools();

function buildUrl(langPrefix, pagePath) {
  const parts = [SITE_URL];
  if (BASE_PATH) parts.push(BASE_PATH.replace(/^\//, ''));
  if (langPrefix) parts.push(langPrefix);
  if (pagePath) parts.push(pagePath.replace(/^\//, ''));
  return parts.filter(Boolean).join('/').replace(/\/+$/, '') || SITE_URL;
}

function injectOrganizationLd(document) {
  if (document.querySelector(`script[${ORGANIZATION_LD_MARKER}]`)) return;

  for (const node of document.querySelectorAll(
    'script[type="application/ld+json"]'
  )) {
    try {
      const parsed = JSON.parse(node.textContent || '');
      if (parsed && parsed['@type'] === 'Organization') return;
    } catch {
      continue;
    }
  }

  const data = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: BRAND_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/images/favicon.svg`,
  };

  const script = document.createElement('script');
  script.setAttribute('type', 'application/ld+json');
  script.setAttribute(ORGANIZATION_LD_MARKER, '');
  script.textContent = JSON.stringify(data, null, 2);
  document.body.appendChild(script);
}

function injectToolBreadcrumb(document, lang, toolName, toolUrl) {
  const h1 = document.querySelector('h1[data-i18n^="tools:"]');
  if (!h1) return;
  if (document.querySelector(`[${BREADCRUMB_MARKER}]`)) return;

  const homeUrl = buildUrl(lang === 'en' ? '' : lang, '');

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Breadcrumb');
  nav.setAttribute(BREADCRUMB_MARKER, '');
  nav.className = 'text-sm text-gray-400 mb-4';

  const homeLink = document.createElement('a');
  homeLink.href = homeUrl;
  homeLink.className = 'hover:text-indigo-300';
  homeLink.textContent = BRAND_NAME;

  const sep = document.createElement('span');
  sep.setAttribute('aria-hidden', 'true');
  sep.className = 'mx-2';
  sep.textContent = '›';

  const current = document.createElement('span');
  current.className = 'text-gray-300';
  current.setAttribute('aria-current', 'page');
  current.textContent = toolName;

  nav.appendChild(homeLink);
  nav.appendChild(sep);
  nav.appendChild(current);

  h1.parentNode.insertBefore(nav, h1);

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: BRAND_NAME,
        item: homeUrl,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: toolName,
        item: toolUrl,
      },
    ],
  };

  const script = document.createElement('script');
  script.setAttribute('type', 'application/ld+json');
  script.setAttribute(BREADCRUMB_MARKER, '');
  script.textContent = JSON.stringify(ld, null, 2);
  document.body.appendChild(script);
}

function resolveToolName(translationKey, langTools) {
  const langEntry = langTools && langTools[translationKey];
  if (langEntry && langEntry.name) return langEntry.name;
  const enEntry = ENGLISH_TOOLS[translationKey];
  return enEntry && enEntry.name ? enEntry.name : null;
}

function applyAlternateLinks(document, pagePath) {
  document
    .querySelectorAll('link[rel="alternate"][hreflang]')
    .forEach((el) => el.remove());

  for (const lang of languages) {
    const link = document.createElement('link');
    link.rel = 'alternate';
    link.hreflang = lang;
    link.href = buildUrl(lang === 'en' ? '' : lang, pagePath);
    document.head.appendChild(link);
  }
}

function ensureCanonical(document, canonicalUrl) {
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  canonical.href = canonicalUrl;
}

function setMetaContent(document, selector, value) {
  const meta = document.querySelector(selector);
  if (meta) meta.content = value;
}

function processFileForLanguage(
  originalContent,
  file,
  lang,
  translations,
  langDir
) {
  const filenameNoExt = file.replace('.html', '');
  const translationKey =
    KEY_MAPPING[filenameNoExt] || toCamelCase(filenameNoExt);

  const { tools } = translations[lang];
  const dom = new JSDOM(originalContent);
  const { document } = dom.window;

  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

  const toolEntry = tools[translationKey];
  let title = null;
  let description = null;

  if (toolEntry) {
    title =
      toolEntry.pageTitle ||
      (toolEntry.name ? `${toolEntry.name} - ${BRAND_NAME}` : null);
    description = toolEntry.subtitle;
  }

  if (title) {
    document.title = title;
    setMetaContent(document, 'meta[property="og:title"]', title);
    setMetaContent(document, 'meta[name="twitter:title"]', title);
  }

  if (description) {
    setMetaContent(document, 'meta[name="description"]', description);
    setMetaContent(document, 'meta[property="og:description"]', description);
    setMetaContent(document, 'meta[name="twitter:description"]', description);
  }

  const pagePath = filenameNoExt === 'index' ? '' : filenameNoExt;

  applyAlternateLinks(document, pagePath);

  const defaultLink = document.createElement('link');
  defaultLink.rel = 'alternate';
  defaultLink.hreflang = 'x-default';
  defaultLink.href = buildUrl('', pagePath);
  document.head.appendChild(defaultLink);

  const localizedUrl = buildUrl(lang, pagePath);
  const canonicalUrl = buildUrl('', pagePath);
  ensureCanonical(document, canonicalUrl);

  setMetaContent(document, 'meta[property="og:url"]', localizedUrl);
  setMetaContent(document, 'meta[name="twitter:url"]', localizedUrl);

  injectOrganizationLd(document);

  const localizedToolName = resolveToolName(translationKey, tools);
  if (localizedToolName) {
    injectToolBreadcrumb(document, lang, localizedToolName, localizedUrl);
  }

  const langPrefixRegex = new RegExp(
    `^(${BASE_PATH})?/(${languages.join('|')})(/|$)`
  );

  document.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;

    if (
      href.startsWith('http') ||
      href.startsWith('//') ||
      href.startsWith('#') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('javascript:') ||
      href.startsWith('data:') ||
      href.startsWith('vbscript:')
    ) {
      return;
    }

    if (href.startsWith('/assets/') || href.includes('/assets/')) return;
    if (langPrefixRegex.test(href)) return;

    let newHref;
    if (href.startsWith('/')) {
      const pathWithoutBase = href.startsWith(BASE_PATH)
        ? href.slice(BASE_PATH.length)
        : href;
      newHref = `${BASE_PATH}/${lang}${pathWithoutBase}`;
    } else {
      newHref = `${BASE_PATH}/${lang}/${href}`;
    }

    link.setAttribute('href', newHref);
  });

  const result = dom.serialize();
  dom.window.close();

  fs.writeFileSync(path.join(langDir, file), result);
}

function updateEnglishFile(filePath, originalContent) {
  const filenameNoExt = path.basename(filePath, '.html');
  const dom = new JSDOM(originalContent);
  const { document } = dom.window;

  const pagePath = filenameNoExt === 'index' ? '' : filenameNoExt;
  const canonicalUrl = buildUrl('', pagePath);

  applyAlternateLinks(document, pagePath);

  const defaultLink = document.createElement('link');
  defaultLink.rel = 'alternate';
  defaultLink.hreflang = 'x-default';
  defaultLink.href = canonicalUrl;
  document.head.appendChild(defaultLink);

  ensureCanonical(document, canonicalUrl);

  setMetaContent(document, 'meta[property="og:url"]', canonicalUrl);
  setMetaContent(document, 'meta[name="twitter:url"]', canonicalUrl);

  injectOrganizationLd(document);

  const enTranslationKey =
    KEY_MAPPING[filenameNoExt] || toCamelCase(filenameNoExt);
  const enToolName = resolveToolName(enTranslationKey, ENGLISH_TOOLS);
  if (enToolName) {
    injectToolBreadcrumb(document, 'en', enToolName, canonicalUrl);
  }

  const result = dom.serialize();
  dom.window.close();

  fs.writeFileSync(filePath, result);
}

async function generateI18nPages() {
  console.log('🌍 Generating i18n pages...');
  console.log(`   SITE_URL: ${SITE_URL}`);
  console.log(`   BASE_PATH: ${BASE_PATH || '/'}`);
  console.log(`   Languages: ${languages.length} (${languages.join(', ')})`);

  if (!fs.existsSync(DIST_DIR)) {
    console.error('❌ dist directory not found. Please run build first.');
    process.exit(1);
  }

  console.log('   Loading translations...');
  const translations = loadAllTranslations();

  const htmlFiles = fs
    .readdirSync(DIST_DIR)
    .filter((file) => file.endsWith('.html'));

  console.log(`   Processing ${htmlFiles.length} HTML files...`);

  for (const lang of languages) {
    if (lang === 'en') continue;
    const langDir = path.join(DIST_DIR, lang);
    if (!fs.existsSync(langDir)) {
      fs.mkdirSync(langDir, { recursive: true });
    }
  }

  let processed = 0;
  const total = htmlFiles.length * (languages.length - 1);

  for (const file of htmlFiles) {
    const filePath = path.join(DIST_DIR, file);
    const originalContent = fs.readFileSync(filePath, 'utf-8');

    for (const lang of languages) {
      if (lang === 'en') continue;

      const langDir = path.join(DIST_DIR, lang);
      processFileForLanguage(
        originalContent,
        file,
        lang,
        translations,
        langDir
      );

      processed++;
      if (processed % 10 === 0 || processed === total) {
        console.log(`   Progress: ${processed}/${total} pages`);
      }

      await new Promise((resolve) => setImmediate(resolve));
    }

    updateEnglishFile(filePath, originalContent);
  }

  console.log('✅ i18n pages generated successfully!');
}

generateI18nPages().catch((err) => {
  console.error('❌ i18n page generation failed:', err);
  process.exit(1);
});
