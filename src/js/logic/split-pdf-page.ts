import { showLoader, hideLoader, showAlert } from '../ui.js';
import { t } from '../i18n/i18n';
import { createIcons, icons } from 'lucide';
import * as pdfjsLib from 'pdfjs-dist';
import {
  downloadFile,
  getPDFDocument,
  formatBytes,
  initializeQpdf,
} from '../utils/helpers.js';
import { loadPdfWithPasswordPrompt } from '../utils/password-prompt.js';
import { state } from '../state.js';
import {
  renderPagesProgressively,
  cleanupLazyRendering,
  renderPageToCanvas,
} from '../utils/render-utils.js';
import { initPagePreview } from '../utils/page-preview.js';
import { showFilePreview } from '../utils/file-preview.js';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { isCpdfAvailable } from '../utils/cpdf-helper.js';
import { showWasmRequiredDialog } from '../utils/wasm-provider.js';
import JSZip from 'jszip';
import Sortable from 'sortablejs';
import { loadPdfDocument } from '../utils/load-pdf-document.js';
import type { QpdfInstanceExtended } from '@/types';
import {
  parseRangeGroups,
  evenOddIndices,
  allPagesIndices,
  nTimesGroups,
  bookmarkSplitGroups,
  groupFilename,
  uniqueZipName,
  extractPagesWithQpdf,
} from '../utils/split-pdf-helpers.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface SplitPiece {
  filename: string;
  blob: Blob;
  pages: number;
  size: number;
  doc?: PDFDocumentProxy;
}

let splitResultPieces: SplitPiece[] = [];
let splitThumbObserver: IntersectionObserver | null = null;
let splitResultsSortable: Sortable | null = null;

function destroySplitPieceDocs(): void {
  for (const p of splitResultPieces) {
    if (p.doc) {
      try {
        p.doc.destroy();
      } catch {
        /* noop */
      }
      p.doc = undefined;
    }
  }
}

// Nome de arquivo e nº de páginas descritivos a partir dos índices (0-based).
function pieceMeta(
  indices: number[],
  base: string
): { filename: string; pages: number } {
  const pages = [...indices].sort((a, b) => a - b).map((i) => i + 1);
  const start = pages[0];
  const end = pages[pages.length - 1];
  const contiguous = end - start + 1 === pages.length;
  if (pages.length === 1) {
    return { filename: `${base}_pagina_${start}.pdf`, pages: 1 };
  }
  if (contiguous) {
    return {
      filename: `${base}_paginas_${start}-${end}.pdf`,
      pages: pages.length,
    };
  }
  return {
    filename: `${base}_paginas_selecionadas_${start}.pdf`,
    pages: pages.length,
  };
}

async function downloadAllSplitPieces(): Promise<void> {
  const zip = new JSZip();
  for (const p of splitResultPieces) {
    zip.file(p.filename, await p.blob.arrayBuffer());
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadFile(blob, 'paginas-divididas.zip');
}

// Miniatura lazy da 1ª página de cada pedaço (mesmo padrão do Mesclar).
function createSplitThumbObserver(): IntersectionObserver {
  if (splitThumbObserver) splitThumbObserver.disconnect();
  splitThumbObserver = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const thumb = entry.target as HTMLElement;
        obs.unobserve(thumb);
        const idx = parseInt(thumb.dataset.idx || '-1', 10);
        const doc = splitResultPieces[idx]?.doc;
        if (!doc) return;
        renderPageToCanvas(doc, 1, 0.5)
          .then((canvas) => {
            canvas.className = 'w-full h-full object-contain';
            const badge = thumb.querySelector('.thumb-badge');
            thumb.textContent = '';
            thumb.appendChild(canvas);
            if (badge) thumb.appendChild(badge);
          })
          .catch((err) =>
            console.error('Erro ao renderizar miniatura do pedaço:', err)
          );
      });
    },
    { root: null, rootMargin: '300px', threshold: 0.01 }
  );
  return splitThumbObserver;
}

function initSplitResultsSortable(grid: HTMLElement): void {
  if (splitResultsSortable) splitResultsSortable.destroy();
  splitResultsSortable = Sortable.create(grid, {
    animation: 150,
    draggable: '.split-piece-card',
    filter: '.no-drag',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    onStart: (evt: Sortable.SortableEvent) => {
      evt.item.style.opacity = '0.5';
    },
    onEnd: (evt: Sortable.SortableEvent) => {
      evt.item.style.opacity = '1';
      const order = Array.from(grid.querySelectorAll('.split-piece-card')).map(
        (el) => parseInt((el as HTMLElement).dataset.idx || '0', 10)
      );
      splitResultPieces = order.map((i) => splitResultPieces[i]);
      renderSplitResults();
    },
  });
}

// Painel de resultados: grade de cards com miniatura da 1ª página, nº de páginas
// + tamanho, arrastar-para-reordenar, duplo-clique -> pré-visualização e botão de
// baixar por peça (ou todas em .zip). Segue o padrão do Mesclar/Comprimir.
function renderSplitResults(): void {
  const el = document.getElementById('split-results');
  if (!el) return;
  el.innerHTML = '';

  if (splitResultPieces.length === 0) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');

  const header = document.createElement('div');
  header.className = 'flex items-center justify-between mb-3';
  const title = document.createElement('p');
  title.className = 'text-sm font-semibold text-white';
  title.textContent = `${splitResultPieces.length} arquivo(s) gerado(s)`;
  header.appendChild(title);
  if (splitResultPieces.length > 1) {
    const dlAll = document.createElement('button');
    dlAll.className =
      'text-indigo-400 hover:text-indigo-300 text-xs font-semibold';
    dlAll.textContent = 'Baixar todos (.zip)';
    dlAll.addEventListener('click', () => void downloadAllSplitPieces());
    header.appendChild(dlAll);
  }
  el.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3';
  const observer = createSplitThumbObserver();

  splitResultPieces.forEach((p, index) => {
    const card = document.createElement('div');
    card.className =
      'split-piece-card group relative flex flex-col gap-2 p-2 border-2 border-gray-600 hover:border-indigo-500 rounded-lg bg-gray-700 transition-colors cursor-move select-none';
    card.dataset.idx = String(index);

    const dlBtn = document.createElement('button');
    dlBtn.className =
      'no-drag absolute top-1 right-1 z-10 bg-gray-900/80 hover:bg-indigo-600 text-white/80 hover:text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-colors';
    dlBtn.title = 'Baixar este arquivo';
    dlBtn.innerHTML =
      '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"/></svg>';
    dlBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadFile(p.blob, p.filename);
    });

    const thumb = document.createElement('div');
    thumb.className =
      'thumb relative rounded-md overflow-hidden bg-gray-800 flex items-center justify-center w-full';
    thumb.style.aspectRatio = '3 / 4';
    thumb.dataset.idx = String(index);

    const skeleton = document.createElement('span');
    skeleton.className = 'text-gray-500 text-xs animate-pulse';
    skeleton.textContent = 'Carregando…';
    thumb.appendChild(skeleton);

    const badge = document.createElement('span');
    badge.className =
      'thumb-badge absolute bottom-1 left-1 bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded font-semibold shadow';
    badge.textContent = p.pages === 1 ? '1 página' : `${p.pages} páginas`;
    thumb.appendChild(badge);

    if (p.doc) {
      card.title = 'Arraste para reordenar · dois cliques para pré-visualizar';
      // Duplo-clique manual: o SortableJS suprime o "dblclick" nativo do item.
      let lastCardClick = 0;
      card.addEventListener('click', () => {
        const now = Date.now();
        if (now - lastCardClick < 350) {
          lastCardClick = 0;
          if (p.doc) showFilePreview(p.doc, p.filename);
        } else {
          lastCardClick = now;
        }
      });
      observer.observe(thumb);
    }

    const nameEl = document.createElement('p');
    nameEl.className = 'text-xs text-gray-300 truncate w-full text-center';
    nameEl.title = p.filename;
    nameEl.textContent = p.filename;

    const metaEl = document.createElement('p');
    metaEl.className = 'text-[10px] text-gray-500 truncate w-full text-center';
    metaEl.textContent = formatBytes(p.size);

    card.append(dlBtn, thumb, nameEl, metaEl);
    grid.appendChild(card);
  });

  el.appendChild(grid);

  if (splitResultPieces.length > 1) initSplitResultsSortable(grid);
}

// Extrai cada grupo, dá nome descritivo, baixa (arquivo único ou .zip) e
// popula o painel de resultados.
async function finalizeSplitPieces(
  groups: number[][],
  zipName: string,
  extractPages: (indices: number[]) => Promise<Uint8Array>
): Promise<void> {
  destroySplitPieceDocs();
  splitResultPieces = [];
  const usedNames = new Map<string, number>();
  const base =
    (state.files[0] as File | undefined)?.name.replace(/\.[^./\\]+$/, '') ||
    'documento';

  for (const group of groups) {
    const bytes = await extractPages(group);
    const meta = pieceMeta(group, base);
    const filename = uniqueZipName(meta.filename, usedNames);
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    // Doc pdf.js do pedaço para miniatura + pré-visualização (cópia dos bytes,
    // pois getDocument pode destacar o buffer).
    let doc: PDFDocumentProxy | undefined;
    try {
      doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    } catch (err) {
      console.error('Erro ao carregar a pré-visualização do pedaço:', err);
    }
    splitResultPieces.push({
      filename,
      blob,
      pages: meta.pages,
      size: bytes.length,
      doc,
    });
  }

  if (splitResultPieces.length === 1) {
    downloadFile(splitResultPieces[0].blob, splitResultPieces[0].filename);
  } else {
    const zip = new JSZip();
    for (const p of splitResultPieces) zip.file(p.filename, p.blob);
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadFile(zipBlob, zipName);
  }

  renderSplitResults();
}

document.addEventListener('DOMContentLoaded', () => {
  let visualSelectorRendered = false;
  let isSplitting = false;
  let splitPreviewDoc: PDFDocumentProxy | null = null;

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById('process-btn');
  const fileDisplayArea = document.getElementById('file-display-area');
  const splitOptions = document.getElementById('split-options');
  const backBtn = document.getElementById('back-to-tools');

  // Split Mode Elements
  const splitModeSelect = document.getElementById(
    'split-mode'
  ) as HTMLSelectElement;
  const rangePanel = document.getElementById('range-panel');
  const visualPanel = document.getElementById('visual-select-panel');
  const evenOddPanel = document.getElementById('even-odd-panel');
  const outputModeWrapper = document.getElementById('output-mode-wrapper');
  const outputSeparateLabel = document.getElementById('output-separate-label');
  const allPagesPanel = document.getElementById('all-pages-panel');
  const bookmarksPanel = document.getElementById('bookmarks-panel');
  const nTimesPanel = document.getElementById('n-times-panel');
  const nTimesWarning = document.getElementById('n-times-warning');

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = import.meta.env.BASE_URL;
    });
  }

  const destroyPreviewDoc = () => {
    if (splitPreviewDoc) {
      try {
        splitPreviewDoc.destroy();
      } catch {
        /* noop */
      }
      splitPreviewDoc = null;
    }
  };

  const updateUI = async () => {
    if (state.files.length > 0) {
      // Ao subir o arquivo, o dropzone some e mostramos o preview grande.
      dropZone?.classList.add('hidden');
      const file = state.files[0];
      if (fileDisplayArea) {
        fileDisplayArea.className = 'mt-4';
        fileDisplayArea.innerHTML = '';

        const card = document.createElement('div');
        card.className =
          'group relative mx-auto w-full max-w-xs flex flex-col gap-2 p-3 border-2 border-gray-600 hover:border-indigo-500 rounded-lg bg-gray-700 transition-colors';

        const removeBtn = document.createElement('button');
        removeBtn.className =
          'absolute top-2 right-2 z-10 bg-gray-900/80 hover:bg-red-600 text-white/80 hover:text-white rounded-full w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-colors';
        removeBtn.title = 'Remover arquivo';
        removeBtn.innerHTML =
          '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          destroyPreviewDoc();
          state.files = [];
          state.pdfDoc = null;
          updateUI();
        });

        const thumb = document.createElement('div');
        thumb.className =
          'thumb relative rounded-md overflow-hidden bg-gray-800 flex items-center justify-center w-full cursor-zoom-in';
        thumb.style.aspectRatio = '3 / 4';
        thumb.title = 'Clique para pré-visualizar';
        const thumbSkeleton = document.createElement('span');
        thumbSkeleton.className = 'text-gray-500 text-xs animate-pulse';
        thumbSkeleton.textContent = 'Carregando…';
        thumb.appendChild(thumbSkeleton);

        const nameEl = document.createElement('p');
        nameEl.className =
          'text-sm font-medium text-gray-200 truncate w-full text-center';
        nameEl.title = file.name;
        nameEl.textContent = file.name;

        const metaEl = document.createElement('p');
        metaEl.className = 'text-xs text-gray-400 truncate w-full text-center';
        metaEl.textContent = `${formatBytes(file.size)} • ${t('common.loadingPageCount')}`;

        card.append(removeBtn, thumb, nameEl, metaEl);
        fileDisplayArea.appendChild(card);

        // Load PDF Document
        try {
          const result = await loadPdfWithPasswordPrompt(file);
          if (!result) {
            state.files = [];
            updateUI();
            return;
          }
          const pageCount = result.pdf.numPages;
          state.files[0] = result.file;
          state.pdfDoc = await loadPdfDocument(result.bytes);
          metaEl.textContent = `${formatBytes(file.size)} • ${pageCount} páginas`;

          // Mantém o doc pdf.js para a miniatura e a pré-visualização.
          destroyPreviewDoc();
          splitPreviewDoc = result.pdf;
          thumb.addEventListener('click', () => {
            if (splitPreviewDoc) showFilePreview(splitPreviewDoc, file.name);
          });

          const badge = document.createElement('span');
          badge.className =
            'absolute bottom-1 left-1 bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded font-semibold shadow';
          badge.textContent =
            pageCount === 1 ? '1 página' : `${pageCount} páginas`;

          try {
            const canvas = await renderPageToCanvas(splitPreviewDoc, 1, 0.9);
            canvas.className = 'w-full h-full object-contain';
            thumb.textContent = '';
            thumb.appendChild(canvas);
            thumb.appendChild(badge);
          } catch (err) {
            console.error('Erro ao renderizar miniatura:', err);
          }
        } catch (error) {
          console.error('Error loading PDF:', error);
          showAlert('Erro', 'Falha ao carregar o arquivo PDF.');
          state.files = [];
          updateUI();
          return;
        }
      }

      if (splitOptions) splitOptions.classList.remove('hidden');
    } else {
      dropZone?.classList.remove('hidden');
      if (fileDisplayArea) {
        fileDisplayArea.className = 'mt-4 space-y-2';
        fileDisplayArea.innerHTML = '';
      }
      if (splitOptions) splitOptions.classList.add('hidden');
      state.pdfDoc = null;
      destroyPreviewDoc();
      destroySplitPieceDocs();
      splitResultPieces = [];
      renderSplitResults();
    }
  };

  const renderVisualSelector = async () => {
    if (visualSelectorRendered) return;

    const container = document.getElementById('page-selector-grid');
    if (!container) return;

    visualSelectorRendered = true;
    container.textContent = '';

    // Cleanup any previous lazy loading observers
    cleanupLazyRendering();

    showLoader('Renderizando prévias das páginas...');

    try {
      if (!state.pdfDoc) {
        // If pdfDoc is not loaded yet (e.g. page refresh), try to load it from the first file
        if (state.files.length > 0) {
          const file = state.files[0];
          hideLoader();
          const result = await loadPdfWithPasswordPrompt(file);
          if (!result) {
            showLoader('Renderizando prévias das páginas...');
            throw new Error('No PDF document loaded');
          }
          result.pdf.destroy();
          state.files[0] = result.file;
          state.pdfDoc = await loadPdfDocument(result.bytes);
          showLoader('Renderizando prévias das páginas...');
        } else {
          throw new Error('No PDF document loaded');
        }
      }

      const pdfData = await state.pdfDoc.save();
      const pdf = await getPDFDocument({ data: pdfData }).promise;

      // Function to create wrapper element for each page
      const createWrapper = (canvas: HTMLCanvasElement, pageNumber: number) => {
        const wrapper = document.createElement('div');
        wrapper.className =
          'page-thumbnail-wrapper p-2 border-2 border-gray-600 rounded-lg cursor-pointer hover:border-indigo-500 bg-gray-700 transition-colors relative group flex flex-col items-center gap-1';
        wrapper.dataset.pageIndex = (pageNumber - 1).toString();
        wrapper.dataset.pageNumber = pageNumber.toString();

        const imgContainer = document.createElement('div');
        imgContainer.className = 'relative';

        const img = document.createElement('img');
        img.src = canvas.toDataURL();
        img.className = 'rounded-md shadow-md max-w-full h-auto';

        const pageNumDiv = document.createElement('div');
        pageNumDiv.className =
          'absolute top-1 left-1 bg-indigo-600 text-white text-xs px-2 py-1 rounded-md font-semibold shadow-lg z-10 pointer-events-none';
        pageNumDiv.textContent = pageNumber.toString();

        imgContainer.append(img, pageNumDiv);
        wrapper.appendChild(imgContainer);

        const handleSelection = (e: Event) => {
          e.preventDefault();
          e.stopPropagation();

          const isSelected = wrapper.classList.contains('selected');

          if (isSelected) {
            wrapper.classList.remove('selected', 'border-indigo-500');
            wrapper.classList.add('border-gray-600');
          } else {
            wrapper.classList.add('selected', 'border-indigo-500');
            wrapper.classList.remove('border-gray-600');
          }
        };

        wrapper.addEventListener('click', handleSelection);
        wrapper.addEventListener('touchend', handleSelection);

        wrapper.addEventListener('touchstart', (e) => {
          e.preventDefault();
        });

        return wrapper;
      };

      // Render pages progressively with lazy loading
      await renderPagesProgressively(pdf, container, createWrapper, {
        batchSize: 8,
        useLazyLoading: true,
        lazyLoadMargin: '400px',
        onProgress: (current, total) => {
          showLoader(`Renderizando prévias das páginas: ${current}/${total}`);
        },
        onBatchComplete: () => {
          createIcons({ icons });
        },
      });

      initPagePreview(container, pdf);
    } catch (error) {
      console.error('Error rendering visual selector:', error);
      showAlert('Erro', 'Falha ao renderizar as prévias das páginas.');
      // Reset the flag on error so the user can try again.
      visualSelectorRendered = false;
    } finally {
      hideLoader();
    }
  };

  const resetState = () => {
    state.files = [];
    state.pdfDoc = null;

    // Reset visual selection
    document
      .querySelectorAll('.page-thumbnail-wrapper.selected')
      .forEach((el) => {
        el.classList.remove('selected', 'border-indigo-500');
        el.classList.add('border-transparent');
      });
    visualSelectorRendered = false;
    const container = document.getElementById('page-selector-grid');
    if (container) container.innerHTML = '';

    // Reset inputs
    const pageRangeInput = document.getElementById(
      'page-range'
    ) as HTMLInputElement;
    if (pageRangeInput) pageRangeInput.value = '';

    const nValueInput = document.getElementById(
      'split-n-value'
    ) as HTMLInputElement;
    if (nValueInput) nValueInput.value = '5';

    const combineRadio = document.getElementById(
      'output-combine'
    ) as HTMLInputElement;
    if (combineRadio) combineRadio.checked = true;

    // Reset radio buttons to default (range)
    const rangeRadio = document.querySelector(
      'input[name="split-mode"][value="range"]'
    ) as HTMLInputElement;
    if (rangeRadio) {
      rangeRadio.checked = true;
      rangeRadio.dispatchEvent(new Event('change'));
    }

    // Reset split mode select
    if (splitModeSelect) {
      splitModeSelect.value = 'range';
      splitModeSelect.dispatchEvent(new Event('change'));
    }

    updateUI();
  };

  const split = async () => {
    if (isSplitting) return;
    isSplitting = true;
    if (processBtn) (processBtn as HTMLButtonElement).disabled = true;

    destroySplitPieceDocs();
    splitResultPieces = [];
    renderSplitResults();

    const splitMode = splitModeSelect.value;
    const oneFilePerUnit =
      (
        document.querySelector(
          'input[name="split-output-mode"]:checked'
        ) as HTMLInputElement | null
      )?.value === 'separate';

    showLoader('Dividindo PDF...');

    let qpdf: QpdfInstanceExtended | null = null;
    const inputPath = '/split-input.pdf';

    try {
      if (!state.pdfDoc) throw new Error('Nenhum documento PDF carregado.');
      const srcDoc = state.pdfDoc;

      const totalPages = srcDoc.getPageCount();
      let indicesToExtract: number[] = [];
      let outputGroups: number[][] | null = null;

      let sourceBytes: Uint8Array | null = null;
      const getSourceBytes = async (): Promise<Uint8Array> => {
        if (sourceBytes) return sourceBytes;
        sourceBytes = new Uint8Array(await srcDoc.save());
        return sourceBytes;
      };

      const ensureQpdf = async (): Promise<QpdfInstanceExtended> => {
        if (qpdf) return qpdf;
        const instance = await initializeQpdf();
        instance.FS.writeFile(inputPath, await getSourceBytes());
        qpdf = instance;
        return instance;
      };

      const extractPages = async (indices: number[]): Promise<Uint8Array> => {
        const instance = await ensureQpdf();
        return extractPagesWithQpdf(instance, inputPath, indices);
      };

      switch (splitMode) {
        case 'range': {
          const pageRangeInput = (
            document.getElementById('page-range') as HTMLInputElement
          ).value;
          if (!pageRangeInput)
            throw new Error('Escolha um intervalo de páginas válido.');

          const { groups: rangeGroups, indices: rangeIndices } =
            parseRangeGroups(pageRangeInput, totalPages);
          indicesToExtract.push(...rangeIndices);

          if (oneFilePerUnit) outputGroups = rangeGroups;
          break;
        }

        case 'even-odd': {
          const choiceElement = document.querySelector(
            'input[name="even-odd-choice"]:checked'
          ) as HTMLInputElement;
          if (!choiceElement)
            throw new Error('Selecione páginas pares ou ímpares.');
          const choice = choiceElement.value === 'even' ? 'even' : 'odd';
          indicesToExtract = evenOddIndices(choice, totalPages);
          break;
        }
        case 'all':
          indicesToExtract = allPagesIndices(totalPages);
          outputGroups = indicesToExtract.map((i) => [i]);
          break;
        case 'visual':
          indicesToExtract = Array.from(
            document.querySelectorAll('.page-thumbnail-wrapper.selected')
          ).map((el) => parseInt((el as HTMLElement).dataset.pageIndex || '0'));
          if (oneFilePerUnit)
            outputGroups = [...new Set(indicesToExtract)].map((i) => [i]);
          break;
        case 'bookmarks': {
          if (!isCpdfAvailable()) {
            showWasmRequiredDialog('cpdf');
            hideLoader();
            return;
          }
          const { getCpdf } = await import('../utils/cpdf-helper.js');
          const cpdf = await getCpdf();
          const pdf = cpdf.fromMemory(
            new Uint8Array(await getSourceBytes()),
            ''
          );

          cpdf.startGetBookmarkInfo(pdf);
          const bookmarkCount = cpdf.numberBookmarks();
          const bookmarkLevel = (
            document.getElementById('bookmark-level') as HTMLSelectElement
          )?.value;

          const splitPages: number[] = [];
          for (let i = 0; i < bookmarkCount; i++) {
            const level = cpdf.getBookmarkLevel(i);
            const page = cpdf.getBookmarkPage(pdf, i);

            if (bookmarkLevel === 'all' || level === parseInt(bookmarkLevel)) {
              if (page > 1 && !splitPages.includes(page - 1)) {
                splitPages.push(page - 1);
              }
            }
          }
          cpdf.endGetBookmarkInfo();
          cpdf.deletePdf(pdf);

          if (splitPages.length === 0) {
            throw new Error('Nenhum marcador encontrado no nível selecionado.');
          }

          const bookmarkGroups = bookmarkSplitGroups(splitPages, totalPages);
          await finalizeSplitPieces(
            bookmarkGroups,
            'dividido-por-marcadores.zip',
            extractPages
          );
          hideLoader();
          showAlert(
            'PDF dividido ✓',
            `Gerados ${bookmarkGroups.length} arquivo(s). Veja abaixo as páginas e o tamanho de cada um.`,
            'success'
          );
          return;
        }

        case 'n-times': {
          const nValue = parseInt(
            (document.getElementById('split-n-value') as HTMLInputElement)
              ?.value || '5'
          );
          if (nValue < 1) throw new Error('N deve ser no mínimo 1.');

          const chunks = nTimesGroups(nValue, totalPages);
          await finalizeSplitPieces(
            chunks,
            'paginas-divididas.zip',
            extractPages
          );
          hideLoader();
          showAlert(
            'PDF dividido ✓',
            `Gerados ${chunks.length} arquivo(s). Veja abaixo as páginas e o tamanho de cada um — dá para baixar tudo ou cada parte separadamente.`,
            'success'
          );
          return;
        }
      }

      const uniqueIndices = [...new Set(indicesToExtract)];
      if (
        uniqueIndices.length === 0 &&
        splitMode !== 'bookmarks' &&
        splitMode !== 'n-times'
      ) {
        throw new Error('Nenhuma página foi selecionada para divisão.');
      }

      const finalGroups =
        outputGroups && outputGroups.length > 0
          ? outputGroups
          : [uniqueIndices];

      if (outputGroups && outputGroups.length > 1) {
        showLoader('Criando arquivos...');
      }
      await finalizeSplitPieces(
        finalGroups,
        'paginas-divididas.zip',
        extractPages
      );

      if (splitMode === 'visual') {
        visualSelectorRendered = false;
      }

      hideLoader();
      showAlert(
        'PDF dividido ✓',
        `Divisão concluída (${finalGroups.length} arquivo(s)). Veja abaixo as páginas e o tamanho de cada um.`,
        'success'
      );
    } catch (e: unknown) {
      console.error(e);
      showAlert(
        'Erro',
        e instanceof Error
          ? e.message
          : 'Falha ao dividir o PDF. Verifique sua seleção.'
      );
    } finally {
      if (qpdf) {
        try {
          qpdf.FS.unlink(inputPath);
        } catch (cleanupError) {
          console.warn('Failed to clean up qpdf input file:', cleanupError);
        }
      }
      isSplitting = false;
      if (processBtn) (processBtn as HTMLButtonElement).disabled = false;
      hideLoader();
    }
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (files && files.length > 0) {
      // Split tool only supports one file at a time
      state.files = [files[0]];
      await updateUI();
    }
  };

  if (fileInput && dropZone) {
    fileInput.addEventListener('change', (e) => {
      handleFileSelect((e.target as HTMLInputElement).files);
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('bg-gray-700');
    });

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
      const files = e.dataTransfer?.files;
      if (files) {
        const pdfFiles = Array.from(files).filter(
          (f) =>
            f.type === 'application/pdf' ||
            f.name.toLowerCase().endsWith('.pdf')
        );
        if (pdfFiles.length > 0) {
          // Take only the first PDF
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(pdfFiles[0]);
          handleFileSelect(dataTransfer.files);
        }
      }
    });

    // Clear value on click to allow re-selecting the same file
    fileInput.addEventListener('click', () => {
      fileInput.value = '';
    });
  }

  if (splitModeSelect) {
    splitModeSelect.addEventListener('change', (e) => {
      const mode = (e.target as HTMLSelectElement).value;

      if (mode !== 'visual') {
        visualSelectorRendered = false;
        const container = document.getElementById('page-selector-grid');
        if (container) container.innerHTML = '';
      }

      rangePanel?.classList.add('hidden');
      visualPanel?.classList.add('hidden');
      evenOddPanel?.classList.add('hidden');
      allPagesPanel?.classList.add('hidden');
      bookmarksPanel?.classList.add('hidden');
      nTimesPanel?.classList.add('hidden');
      outputModeWrapper?.classList.add('hidden');
      if (nTimesWarning) nTimesWarning.classList.add('hidden');

      if (mode === 'range') {
        rangePanel?.classList.remove('hidden');
        outputModeWrapper?.classList.remove('hidden');
        if (outputSeparateLabel)
          outputSeparateLabel.textContent = 'Um PDF por intervalo';
      } else if (mode === 'visual') {
        visualPanel?.classList.remove('hidden');
        outputModeWrapper?.classList.remove('hidden');
        if (outputSeparateLabel)
          outputSeparateLabel.textContent = 'Um PDF por página';
        renderVisualSelector();
      } else if (mode === 'even-odd') {
        evenOddPanel?.classList.remove('hidden');
      } else if (mode === 'all') {
        allPagesPanel?.classList.remove('hidden');
      } else if (mode === 'bookmarks') {
        bookmarksPanel?.classList.remove('hidden');
      } else if (mode === 'n-times') {
        nTimesPanel?.classList.remove('hidden');

        const updateWarning = () => {
          if (!state.pdfDoc) return;
          const totalPages = state.pdfDoc.getPageCount();
          const nValue = parseInt(
            (document.getElementById('split-n-value') as HTMLInputElement)
              ?.value || '5'
          );
          const remainder = totalPages % nValue;
          if (remainder !== 0 && nTimesWarning) {
            nTimesWarning.classList.remove('hidden');
            const warningText = document.getElementById('n-times-warning-text');
            if (warningText) {
              warningText.textContent = `O PDF tem ${totalPages} páginas, que não são divisíveis igualmente por ${nValue}. O último PDF conterá ${remainder} página(s).`;
            }
          } else if (nTimesWarning) {
            nTimesWarning.classList.add('hidden');
          }
        };

        updateWarning();
        document
          .getElementById('split-n-value')
          ?.addEventListener('input', updateWarning);
      }
    });
  }

  if (processBtn) {
    processBtn.addEventListener('click', split);
  }
});
