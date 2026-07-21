#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function originOf(urlStr) {
  if (!urlStr) return null;
  try {
    const { protocol, host } = new URL(urlStr);
    if (protocol !== 'https:' && protocol !== 'http:') return null;
    return `${protocol}//${host}`;
  } catch {
    return null;
  }
}

function uniq(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

const DEFAULT_WASM_ORIGINS = {
  pymupdf: 'https://cdn.jsdelivr.net',
  gs: 'https://cdn.jsdelivr.net',
  cpdf: 'https://cdn.jsdelivr.net',
};
const DEFAULT_CORS_PROXY_ORIGIN =
  'https://bentopdf-cors-proxy.bentopdf.workers.dev';
const DEFAULT_OCR_FONT_CDN_ORIGIN = 'https://rawcdn.githack.com';

// When HEADERS_AIRGAP=true every asset is served same-origin, so the CSP
// collapses to essentially 'self' with no external origins.
const AIRGAP = process.env.HEADERS_AIRGAP === 'true';

const wasmOrigins = AIRGAP
  ? []
  : [
      originOf(process.env.VITE_WASM_PYMUPDF_URL) ||
        DEFAULT_WASM_ORIGINS.pymupdf,
      originOf(process.env.VITE_WASM_GS_URL) || DEFAULT_WASM_ORIGINS.gs,
      originOf(process.env.VITE_WASM_CPDF_URL) || DEFAULT_WASM_ORIGINS.cpdf,
    ];

const tesseractOrigins = AIRGAP
  ? []
  : uniq([
      originOf(process.env.VITE_TESSERACT_WORKER_URL),
      originOf(process.env.VITE_TESSERACT_CORE_URL),
      originOf(process.env.VITE_TESSERACT_LANG_URL),
    ]);

const corsProxyOrigin = AIRGAP
  ? null
  : originOf(process.env.VITE_CORS_PROXY_URL) || DEFAULT_CORS_PROXY_ORIGIN;

const ocrFontOrigin = AIRGAP
  ? null
  : originOf(process.env.VITE_OCR_FONT_BASE_URL) || DEFAULT_OCR_FONT_CDN_ORIGIN;

const scriptOrigins = uniq([...wasmOrigins, ...tesseractOrigins]);
const connectOrigins = uniq([
  ...wasmOrigins,
  ...tesseractOrigins,
  corsProxyOrigin,
  ocrFontOrigin,
]);
const fontOrigins = uniq([ocrFontOrigin].filter(Boolean));

const gFontsStyle = AIRGAP ? '' : ' https://fonts.googleapis.com';
const gFontsFont = AIRGAP ? '' : ' https://fonts.gstatic.com';
const githubApi = AIRGAP ? '' : ' https://api.github.com';
const imgRemote = AIRGAP ? '' : ' https:';

const directives = [
  `default-src 'self'`,
  `script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' blob: ${scriptOrigins.join(' ')}`.trim(),
  `worker-src 'self' blob:`,
  `style-src 'self' 'unsafe-inline'${gFontsStyle}`,
  `img-src 'self' data: blob:${imgRemote}`,
  `font-src 'self' data:${gFontsFont} ${fontOrigins.join(' ')}`.trim(),
  `connect-src 'self' blob:${githubApi}${gFontsFont} ${connectOrigins.join(' ')}`.trim(),
  `object-src 'none'`,
  `base-uri 'self'`,
  `frame-src 'self' blob:`,
  `frame-ancestors 'self'`,
  `form-action 'self'`,
];

const docsDirectives = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' ${scriptOrigins.join(' ')}`.trim(),
  `style-src 'self' 'unsafe-inline'${gFontsStyle}`,
  `img-src 'self' data: blob:${imgRemote}`,
  `font-src 'self' data:${gFontsFont} ${fontOrigins.join(' ')}`.trim(),
  `connect-src 'self'${githubApi}${gFontsFont} ${connectOrigins.join(' ')}`.trim(),
  `object-src 'none'`,
  `base-uri 'self'`,
  `frame-ancestors 'self'`,
  `form-action 'self'`,
];

const csp = directives.join('; ');
const docsCsp = docsDirectives.join('; ');

const commonHeaders = `add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "credentialless" always;
add_header Cross-Origin-Resource-Policy "cross-origin" always;
`;

const contents = `add_header Content-Security-Policy "${csp}" always;
${commonHeaders}`;

const docsContents = `add_header Content-Security-Policy "${docsCsp}" always;
${commonHeaders}`;

const outPath = join(repoRoot, 'security-headers.conf');
const docsOutPath = join(repoRoot, 'security-headers-docs.conf');
writeFileSync(outPath, contents);
writeFileSync(docsOutPath, docsContents);
console.log(
  `[security-headers] wrote ${outPath} with ${scriptOrigins.length} script-src / ${connectOrigins.length} connect-src origin(s)`
);
console.log(`[security-headers] wrote ${docsOutPath} (docs CSP)`);
