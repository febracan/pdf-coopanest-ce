# Headers PDF — Plano de Customização (baseado no BentoPDF)

> Fork interno, self-hosted e privado do **BentoPDF** (https://github.com/alam00000/bentopdf),
> licenciado sob **AGPL-3.0-only**. Este documento consolida a análise do código e as alterações
> recomendadas, priorizadas para a infra padrão da Headers (Docker + nginx-proxy compartilhado +
> Cloudflare Full + separação homolog/produção + PT-BR + air-gap).

Data da análise: 2026-07-17 · Versão do upstream analisada: BentoPDF `2.8.6`.

---

## 0. Contexto técnico apurado no código

- **100% client-side.** Não há backend. Todo processamento de PDF roda no browser (WASM). nginx
  serve estáticos em `:8080` (HTTP puro — sem TLS no container, o que é o certo: TLS termina no
  proxy/Cloudflare). Ver `nginx.conf` (`listen 8080`, sem `ssl_certificate`).
- **White-label nativo, mas parcial.** As envs `VITE_BRAND_NAME`, `VITE_BRAND_LOGO`,
  `VITE_FOOTER_TEXT` só alcançam os 4 partials (`navbar*.html`, `footer*.html`) e o `<title>` no
  Simple Mode. **NÃO** cobrem: `<title>`/meta/OG/Twitter das páginas, `public/site.webmanifest`,
  favicons, o sufixo `- BentoPDF` gerado em `scripts/generate-i18n-pages.mjs:195`, nem o
  `SITE_URL` default (`https://www.bentopdf.com`). Há **~2100 ocorrências literais** de "BentoPDF"
  no código.
- **Todas as envs de marca/idioma/air-gap são BUILD-TIME.** `entrypoint.sh` não reinjeta nada em
  runtime. Trocar marca = **rebuild da imagem**, não env no compose. O `docker-compose.yml` de
  origem só faz `image:` de uma imagem pré-buildada — precisa virar `build:`.
- **Mecanismos de customização já existentes (confirmados):**
  - `SIMPLE_MODE=true` (build arg) → remove todo o "chrome" de marketing (hero, FAQ, testimonials,
    footer, donation ribbon) e desliga o contador de estrelas do GitHub. Mantém **todas** as ferramentas.
  - `DISABLE_TOOLS="id1,id2,..."` (build arg) → remove ferramentas do bundle (`__DISABLED_TOOLS__`).
  - `config.json` montado em runtime (`disabledTools`, `editorDisabledCategories`) → esconde
    ferramentas **sem rebuild** (gate de UI, client-side).
  - `VITE_DEFAULT_LANGUAGE=pt`, `SITE_URL=...`, `BASE_URL=...`, `DISABLE_IPV6`, `ROBOTS_NOINDEX`.
  - **`scripts/prepare-airgap.sh`** → automatiza self-host de WASM/OCR/fonts (existe no repo!).

---

## 1. ⚖️ Licença AGPL-3.0 — LER PRIMEIRO (bloqueia go-live)

Rebrandar para "Headers PDF" é **permitido** (o nome é marca, não copyright — a AGPL §7(e) até
permite exigir a remoção da marca do upstream). Mas **duas obrigações continuam valendo** e são
frequentemente ignoradas:

1. **Cláusula de uso em rede (§13).** No momento em que o app fica acessível por rede a mais de uma
   pessoa (exatamente o seu caso: subdomínio público atrás do Cloudflare), você deve **oferecer o
   código-fonte modificado** (o do _seu_ fork, no commit exato em produção) aos usuários. "É uso
   interno, não distribuí binário" **não** isenta — a `docs/licensing.md:18` do upstream afirma o
   contrário e está **errada** para este cenário.
2. **Preservar avisos (§5).** Manter o `LICENSE` intacto e os avisos de copyright existentes
   (ex.: `src/types/coherentpdf.global.d.ts`). Adicione seus avisos de modificação; não apague os deles.

> ⚠️ **Armadilha do Simple Mode:** ele remove o footer, e o footer é o **único** link de fonte
> visível. Um build interno em Simple Mode hoje ficaria com **zero** oferta de fonte → precisa
> injetar o link em `footer-simple.html`/`navbar-simple.html` na mão.

**Três componentes WASM também são AGPL** (PyMuPDF, Ghostscript, CoherentPDF). A licença comercial
do BentoPDF (US$79) tira a obrigação **do código do BentoPDF**, mas **não** desses três.

**Checklist de conformidade:**

- [ ] Manter `LICENSE` byte-a-byte.
- [ ] Link "Código-fonte" visível em **todas** as páginas (inclusive Simple Mode) → repo do fork no commit deployado.
- [ ] Crédito "Baseado no BentoPDF (AGPL-3.0)" no footer (`VITE_FOOTER_TEXT`) e página de créditos.
- [ ] Página "Créditos/Licenças" listando BentoPDF + PyMuPDF/Ghostscript/CoherentPDF.
- [ ] Corrigir/remover a afirmação enganosa em `docs/licensing.md` e `licensing.html`.
- [ ] (Opcional) Teste de CI que falha o build se o `dist/` não contiver LICENSE + link de fonte + crédito.

**Decisão necessária:** publicar a fonte do fork (git interno acessível aos usuários) **vs** comprar
licença comercial **vs** manter instância single-user. Ver seção 10.

---

## 2. Branding → "Headers PDF"

| #   | Ação                                                                                                                                                                             | Prioridade | Esforço     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------- | ------ | --- |
| 2.1 | Setar `VITE_BRAND_NAME="Headers PDF"`, `VITE_BRAND_LOGO`, `VITE_FOOTER_TEXT` (build args)                                                                                        | must       | S           |
| 2.2 | Find/replace `Bento ?PDF → Headers PDF` em `*.html` e `src/pages/*.html` (title/OG/Twitter/author/app-title) — **preservando** as frases de atribuição                           | must       | M           |
| 2.3 | Reescrever `public/site.webmanifest` (name/short_name/description) e `theme_color`/`background_color` para a paleta Headers                                                      | must       | S           |
| 2.4 | Trocar favicons/logo/OG em `public/` e `public/images/` (mesmos nomes de arquivo). **Criar** `og-home.png` e `twitter-home.png` (1200×630) — hoje referenciados mas inexistentes | must       | M           |
| 2.5 | Corrigir sufixo hardcoded `- BentoPDF` em `scripts/generate-i18n-pages.mjs:195` → `process.env.VITE_BRAND_NAME                                                                   |            | 'BentoPDF'` | should | S   |
| 2.6 | Corrigir nome "BentoPDF" no JSON-LD Organization/breadcrumb de `generate-i18n-pages.mjs`                                                                                         | should     | S           |
| 2.7 | Repointar/remover links sociais/docs/doação (ou usar Simple Mode, que já remove a maioria)                                                                                       | nice       | S           |

`theme-color` só existe no `site.webmanifest` (não há meta tag) → para cor no chrome mobile, adicione
`<meta name="theme-color">` no `index.html`.

---

## 3. PT-BR como padrão

A tradução `pt` é **Brasileira e completa** (266/266 chaves comuns; 880 chaves de tools). Pontos:

- **must (S):** `VITE_DEFAULT_LANGUAGE=pt` no build. (Requer trocar o compose para `build:`.)
- **should (S):** Tornar o default **forte**. Hoje `getLanguageFromUrl()` (`src/js/i18n/i18n.ts`)
  respeita o idioma do browser **antes** da env → um browser em `en` cai em inglês. Mover o check da
  env para antes do `navigator.languages`, **ou** redirecionar `/` → `/pt/` no nginx. Ajustar
  `src/tests/i18n.test.ts`.
- **should (S):** Corrigir 6 strings pt-PT ("ficheiro" → "arquivo", "Os meus/seus" → "Meus/Seus") e o
  typo "ferrament" → "ferramenta" em `public/locales/pt/tools.json`.
- **should (M):** Build enxuto só com `pt` (+`en`) — hoje gera ~2500 HTMLs de 20 idiomas. Filtrar em
  `generate-i18n-pages.mjs` (há `TODO@ALAM` para isso) **e** alinhar as listas de idioma duplicadas em
  `i18n.ts`, `vite.config.ts` e `nginx.conf` (senão prefixos advertidos dão 404).

---

## 4. Simple Mode + curadoria de ferramentas

- **must (S):** `SIMPLE_MODE=true` no build interno (troca `index.html`→`simple-index.html`, remove marketing).
- **Curadoria — 2 níveis:**
  - **Runtime (`config.json`, sem rebuild)** — ideal para iterar em homolog. Montar
    `-v ./config.json:/usr/share/nginx/html/config.json:ro` com `{"disabledTools":[...]}`. É gate de
    UI (client-side), não segurança.
  - **Build-time (`DISABLE_TOOLS`)** — para produção travada; some do bundle.
- **Conjunto sugerido para escritório PT-BR (manter ~30):** `merge-pdf, split-pdf, extract-pages,
delete-pages, organize-pdf, rotate-pdf, compress-pdf, edit-pdf, sign-pdf, digital-sign-pdf,
validate-signature-pdf, ocr-pdf, add-watermark, header-footer, page-numbers, encrypt-pdf,
decrypt-pdf, change-permissions, sanitize-pdf, flatten-pdf, remove-metadata, form-filler,
form-creator, crop-pdf, word-to-pdf, excel-to-pdf, powerpoint-to-pdf, pdf-to-docx, pdf-to-jpg,
jpg-to-pdf, image-to-pdf, pdf-to-text, edit-metadata, compare-pdfs`.
- **Esconder (niche):** conversores de e-book/legado (`wpd/wps/vsd/pub/psd/xps/mobi/epub/fb2/cbz/pages/odg...`),
  `prepare-pdf-for-ai`, e cosméticos (`scanner-effect, invert-colors, posterize-pdf, n-up-pdf, pdf-booklet...`).
- **Editor:** dá para desligar sub-recursos (ex.: redação/forms) via `editorDisabledCategories` no `config.json`.
- ⚠️ `wasm-preloader.ts` **pré-carrega PyMuPDF + Ghostscript no idle** mesmo sem uso → relevante para air-gap.

---

## 5. 🔒 Air-gap / privacidade (inventário de chamadas externas)

Hosts externos reais que o app contata (fora placeholders de teste/namespaces XML):

| Host                                                               | Para quê                                            | Como internalizar                                        |
| ------------------------------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------- |
| `cdn.jsdelivr.net`                                                 | WASM: PyMuPDF, Ghostscript, CoherentPDF             | `prepare-airgap.sh` → serve em `/wasm/` mesma origem     |
| `rawcdn.githack.com`                                               | Fontes OCR CJK/Noto (`font-mappings.ts`)            | idem (script baixa e reescreve URLs)                     |
| _(tesseract.js CDN)_                                               | OCR core/lang quando `VITE_TESSERACT_*` vazio       | setar `VITE_TESSERACT_WORKER/CORE/LANG_URL`              |
| `bentopdf-cors-proxy.bentopdf.workers.dev`                         | Cadeia de cert p/ validação de assinatura digital   | `VITE_CORS_PROXY_URL=""` (perde só fetch remoto de cert) |
| `api.github.com`                                                   | Contador de estrelas (`main.ts:549`)                | Simple Mode já desliga                                   |
| `fonts.googleapis.com` / `fonts.gstatic.com`                       | Só na CSP; fontes UI já são `@fontsource` bundladas | remover da CSP (seção 7)                                 |
| `simpleanalytics.com`                                              | **Verificar** onde é referenciado antes de assumir  | inspecionar e remover se ativo                           |
| TSA (`digicert/freetsa/sectigo/ssl.com`)                           | Timestamp de assinatura (só se o usuário pedir)     | opcional; só dispara em ação do usuário                  |
| Sociais (`github/ko-fi/discord/x/linkedin/instagram/digitalocean`) | Links/badges                                        | Simple Mode remove a maioria                             |

**Ação principal (must, M):**

```bash
bash scripts/prepare-airgap.sh \
  --wasm-base-url https://<host>/wasm \
  --brand-name "Headers PDF" --simple-mode
```

Servindo os assets **na mesma origem** (`/wasm/`), o gerador de CSP colapsa `script-src`/`connect-src`
para `'self'` automaticamente (o `originOf()` retorna a mesma origem). O `nginx.conf` já tem cache de
1 ano para `.wasm/.data`.

> ⚠️ **A CSP é gerada em BUILD-TIME** (`scripts/generate-security-headers.mjs` → `security-headers.conf`,
> incluído pelo nginx). Apontar as URLs de WASM para self-host **sem rebuildar** = a CSP continua só
> permitindo jsdelivr e o browser **bloqueia** seu WASM. Sempre rebuild.

---

## 6. Deploy na infra Headers (nginx-proxy + Cloudflare Full + homolog/prod)

Criar **novos** compose (não editar o de origem):

**`docker-compose.prod.yml`:**

```yaml
services:
  headerspdf:
    image: ghcr.io/headers/headers-pdf:prod # imagem rebuildada e marcada
    container_name: headerspdf-prod
    restart: unless-stopped
    expose: ['8080'] # SEM ports: — o proxy alcança pela rede interna
    environment:
      - VIRTUAL_HOST=pdf.headers.com.br
      - VIRTUAL_PORT=8080 # OBRIGATÓRIO: o container escuta 8080, não 80
      - DISABLE_IPV6=true
    networks: [proxy]
networks:
  proxy:
    external: true
    name: nginx-proxy # == nome REAL da rede do proxy (docker network ls)
```

**`docker-compose.homolog.yml`:** cópia com `image: :homolog`, `container_name: headerspdf-homolog`,
`VIRTUAL_HOST=homologpdf.headers.com.br` e `ROBOTS_NOINDEX=true`.

**Cuidados (do seu histórico):**

- **Gotcha do NAT reverso:** nunca publicar porta no host nem criar `server{}` avulso em `conf.d` —
  roteie **só** via `VIRTUAL_HOST` no proxy compartilhado. Acesso direto fora do Cloudflare dá timeout.
- Cloudflare **Full** (não Full-Strict — origem self-signed). TLS termina no proxy; container é HTTP.
- Teste de dentro do box: `docker exec <proxy> wget -qO- http://headerspdf-prod:8080/` deve dar 200.
- **`SITE_URL`**: default é `https://www.bentopdf.com` → sem `--build-arg SITE_URL=...` seu `rel=canonical`
  aponta para o bentopdf.com. Sempre setar.
- Pinar tag imutável (`:prod-2026-07-17`) em vez de `:latest` no box compartilhado.

---

## 7. Segurança / CSP endurecida

- **must (M):** Fazer o gerador emitir CSP **self-only** para air-gap. `generate-security-headers.mjs`
  hardcoda **3 origens** que nunca caem: `fonts.googleapis.com`, `fonts.gstatic.com`, `api.github.com`.
  Nenhuma é usada no build air-gapped. Adicionar gate `HEADERS_AIRGAP=true` que remove essas 3 e
  aperta `img-src` para `'self' data: blob:`.
- **must (S):** Commitar um `security-headers` de referência **versionado** (o gerado é git-ignored) como
  fixture de QA. Manter `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`.
- ⚠️ **Não** remover `'unsafe-eval'`/`'wasm-unsafe-eval'` — os WASM (pymupdf/gs/cpdf) exigem.
- ⚠️ **COEP divergente:** o gerador usa `credentialless`, o `.htaccess` usa `require-corp`. Alinhar
  (require-corp é mais estrito e necessário p/ SharedArrayBuffer) e re-testar OCR/pymupdf.
- **HSTS no Cloudflare, nunca na origem.** O box é multi-tenant; HSTS com includeSubDomains
  contaminaria os vizinhos em `headers.com.br`. Ligar HSTS só no edge, escopado ao host.
- **should (M):** `scripts/csp-airgap-check.mjs` que falha o build se a CSP tiver qualquer `https://`
  externo → encaixar no `security:audit` existente (que já roda `npm audit` + `lint:security` + `security:patterns`).

---

## 8. QA harness (alinhado ao seu go-live: vitest + smoke + k6)

Existe suíte vitest (40 arquivos, threshold 80%) e scripts `security:*`, mas **nada roda em CI**.

- **must (S):** `.github/workflows/ci.yml` → `npm ci` → `test:run` → `lint` → `security:audit`.
- **must (M):** Smoke containerizado: `docker build` → `docker run` → `curl -sf :8080/` (200) →
  Playwright abre 2-3 tools e checa ausência de erro no console.
- **should (S):** `HEALTHCHECK` no Dockerfile (`wget -qO- http://127.0.0.1:8080/`) + healthcheck no compose.
- **should (M):** `loadtest/smoke.js` (k6) contra a origem, com variante Host-header p/ bypass do
  Cloudflare (seu padrão), thresholds `p(95)<300ms`, `http_req_failed<1%`.
- **must (M):** Re-escopar o pipeline de publish — hoje é guardado por
  `github.repository == 'alam00000/bentopdf'` e num fork **não roda nada** (você acha que publicou e não). Retargetar para seu registry.
- **should (M):** `build:internal` sem SEO: `tsc && vite build && node scripts/generate-security-headers.mjs`
  (dropar `generate-sitemap`/`seo-audit`/`generate-i18n-pages`). ⚠️ **Não** dropar
  `generate-security-headers.mjs` (o nginx faz `include` dele; sem ele o nginx não sobe). ⚠️ `seo-audit.mjs`
  **quebra o build** ao rebrandar se `SITE_URL` não bater — set ou remova.

---

## 9. Acesso / gate (tool interno em subdomínio público)

Zero auth nativa (é estático). Gate no **edge/proxy**, nunca no container:

- **Recomendado (must, S):** basic-auth no nginx-proxy compartilhado. htpasswd com nome ==
  `VIRTUAL_HOST` (`/etc/nginx/htpasswd/pdf.headers.com.br`). Container intocado.
- **Alternativa (should, M):** Cloudflare Access (Zero Trust) — SSO/OTP, log de quem abriu, redirect
  full-page (não conflita com a CSP `frame-ancestors 'self'`). Melhor se quiser identidade por usuário.
- **Não** adicionar auth dentro do container/sidecar (forkaria `nginx.conf`, dívida a cada bump).
- Gate = só restringe **quem carrega a UI**; como o processamento é client-side, não protege conteúdo
  de arquivo (que nunca sai do browser de qualquer forma).
- `ROBOTS_NOINDEX=true` em homolog (e prod se não-público).

---

## 10. Decisões (definidas em 2026-07-17)

1. **Caminho AGPL:** ⏸️ **decidir depois.** Implementação técnica segue; conformidade AGPL fica como
   pendência **explícita de go-live** (seção 1). Já embutimos crédito no footer e mantemos `LICENSE`
   intacto para não fechar nenhuma porta.
2. **Gate de acesso:** ✅ **basic-auth no nginx-proxy** compartilhado.
3. **Profundidade air-gap:** ✅ **self-host total** (WASM/OCR/fontes na mesma origem, CSP self-only,
   `VITE_CORS_PROXY_URL=""`).
4. **Domínios:** a confirmar — proposta `pdf.headers.com.br` (prod) / `homologpdf.headers.com.br` (homolog).
5. **Curadoria:** proposta = conjunto ~30 da seção 4 (ajustável).

---

## 11. Comando de build de referência (produção, air-gapped, PT-BR, Simple Mode)

```bash
docker build -t ghcr.io/headers/headers-pdf:prod \
  --build-arg SIMPLE_MODE=true \
  --build-arg VITE_DEFAULT_LANGUAGE=pt \
  --build-arg SITE_URL=https://pdf.headers.com.br \
  --build-arg VITE_BRAND_NAME="Headers PDF" \
  --build-arg VITE_BRAND_LOGO=headers-logo.svg \
  --build-arg VITE_FOOTER_TEXT="Headers PDF — baseado no BentoPDF (AGPL-3.0)" \
  --build-arg DISABLE_TOOLS="wpd-to-pdf,wps-to-pdf,vsd-to-pdf,pub-to-pdf,psd-to-pdf,xps-to-pdf,mobi-to-pdf,epub-to-pdf,fb2-to-pdf,cbz-to-pdf,pdf-to-cbz,pages-to-pdf,odg-to-pdf,prepare-pdf-for-ai,scanner-effect,invert-colors,posterize-pdf,pdf-booklet,n-up-pdf" \
  --build-arg VITE_WASM_PYMUPDF_URL=/wasm/pymupdf/ \
  --build-arg VITE_WASM_GS_URL=/wasm/gs/ \
  --build-arg VITE_WASM_CPDF_URL=/wasm/cpdf/ \
  --build-arg VITE_CORS_PROXY_URL= \
  .
# (rodar prepare-airgap.sh antes para popular public/wasm/ e reescrever fontes OCR)
```

---

## Ordem de execução sugerida (blocos)

1. ✅ **Bloco A — Marca + PT-BR + Simple Mode** (FEITO em 2026-07-17): kit de ícones/OG gerado do
   símbolo Headers (`scripts`/sharp); tema remapeado (rampa `indigo-*`→azul `#0460D9` no `@theme` +
   hexes custom); `BentoPDF→Headers PDF` em 131 HTML; crédito AGPL fixo no rodapé (inclui o inline do
   `simple-index.html` e o `footer-simple`); `VITE_DEFAULT_LANGUAGE` vence o browser (`i18n.ts` +
   testes); fixes pt-BR no locale; `.env.production` + `docker-compose.{homolog,prod}.yml`.
   Validado: `vitest i18n` (12/12) e `vite build` (SIMPLE_MODE) OK; `curl` confirma título/tema/marca/
   crédito no `dist`. Assets reais em `public/images/` (favicon.svg/ico/192/512, apple-touch, og-home).
2. **Bloco B — Air-gap + CSP** (`prepare-airgap.sh`, gate `HEADERS_AIRGAP`, CSP self-only, fixture).
3. **Bloco C — Deploy** (compose homolog/prod, rebuild da imagem, subir homolog primeiro).
4. **Bloco D — Gate de acesso** (basic-auth ou CF Access) + `ROBOTS_NOINDEX`.
5. **Bloco E — QA/CI** (vitest+security em CI, smoke, healthcheck, k6, re-escopar publish).
6. **Bloco F — Conformidade AGPL** (página de créditos, link de fonte no Simple Mode, corrigir docs).
