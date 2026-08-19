import { showLoader, hideLoader, showAlert } from '../ui.js';
import { downloadFile } from '../utils/helpers.js';
import { withPdfSuffix } from '../utils/output-name.js';
import { state } from '../state.js';
import { batchDecryptIfNeeded } from '../utils/password-prompt.js';
import {
  renderPagesProgressively,
  cleanupLazyRendering,
  renderPageToCanvas,
} from '../utils/render-utils.js';
import { initPagePreview } from '../utils/page-preview.js';
import { showFilePreview } from '../utils/file-preview.js';
import { isCpdfAvailable } from '../utils/cpdf-helper.js';
import {
  showWasmRequiredDialog,
  WasmProvider,
} from '../utils/wasm-provider.js';

import { createIcons, icons } from 'lucide';
import * as pdfjsLib from 'pdfjs-dist';
import Sortable from 'sortablejs';
import type { MergeJob, MergeFile, MergeMessage, MergeResponse } from '@/types';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface MergeState {
  pdfDocs: Record<string, pdfjsLib.PDFDocumentProxy>;
  pdfBytes: Record<string, ArrayBuffer>;
  activeMode: 'file' | 'page';
  sortableInstances: {
    fileList?: Sortable;
    pageThumbnails?: Sortable;
  };
  isRendering: boolean;
  cachedThumbnails: boolean | null;
  lastFileHash: string | null;
  mergeSuccess: boolean;
}

const mergeState: MergeState = {
  pdfDocs: {},
  pdfBytes: {},
  activeMode: 'file',
  sortableInstances: {},
  isRendering: false,
  cachedThumbnails: null,
  lastFileHash: null,
  mergeSuccess: false,
};

const mergeWorker = new Worker(
  import.meta.env.BASE_URL + 'workers/merge.worker.js'
);

let fileThumbObserver: IntersectionObserver | null = null;

function createFileThumbObserver(): IntersectionObserver {
  if (fileThumbObserver) fileThumbObserver.disconnect();

  fileThumbObserver = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const thumb = entry.target as HTMLElement;
        obs.unobserve(thumb);

        const key = thumb.dataset.key;
        const doc = key ? mergeState.pdfDocs[key] : undefined;
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
            console.error('Erro ao renderizar a miniatura do arquivo:', err)
          );
      });
    },
    { root: null, rootMargin: '300px', threshold: 0.01 }
  );
  return fileThumbObserver;
}

function initializeFileListSortable() {
  const fileList = document.getElementById('file-list');
  if (!fileList) return;

  if (mergeState.sortableInstances.fileList) {
    mergeState.sortableInstances.fileList.destroy();
  }

  mergeState.sortableInstances.fileList = Sortable.create(fileList, {
    animation: 150,
    draggable: '.merge-file-card',
    filter: '.no-drag',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    onStart: function (evt: Sortable.SortableEvent) {
      evt.item.style.opacity = '0.5';
    },
    onEnd: function (evt: Sortable.SortableEvent) {
      evt.item.style.opacity = '1';
      const addTile = fileList.querySelector('.add-tile');
      if (addTile) fileList.appendChild(addTile);
    },
  });
}

function initializePageThumbnailsSortable() {
  const container = document.getElementById('page-merge-preview');
  if (!container) return;

  if (mergeState.sortableInstances.pageThumbnails) {
    mergeState.sortableInstances.pageThumbnails.destroy();
  }

  mergeState.sortableInstances.pageThumbnails = Sortable.create(container, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    onStart: function (evt: Sortable.SortableEvent) {
      evt.item.style.opacity = '0.5';
    },
    onEnd: function (evt: Sortable.SortableEvent) {
      evt.item.style.opacity = '1';
    },
  });
}

function generateFileHash() {
  return (state.files as File[])
    .map((f) => `${f.name}-${f.size}-${f.lastModified}`)
    .join('|');
}

async function renderPageMergeThumbnails() {
  const container = document.getElementById('page-merge-preview');
  if (!container) return;

  const currentFileHash = generateFileHash();
  const filesChanged = currentFileHash !== mergeState.lastFileHash;

  if (!filesChanged && mergeState.cachedThumbnails !== null) {
    // Simple check to see if it's already rendered to avoid flicker.
    if (container.firstChild) {
      initializePageThumbnailsSortable();
      return;
    }
  }

  if (mergeState.isRendering) {
    return;
  }

  mergeState.isRendering = true;
  container.textContent = '';

  cleanupLazyRendering();

  let totalPages = 0;
  for (let i = 0; i < state.files.length; i++) {
    const fileKey = `${i}_${state.files[i].name}`;
    const doc = mergeState.pdfDocs[fileKey];
    if (doc) totalPages += doc.numPages;
  }

  try {
    let currentPageNumber = 0;

    // Function to create wrapper element for each page
    const createWrapper = (
      canvas: HTMLCanvasElement,
      pageNumber: number,
      fileKey: string,
      displayName: string
    ) => {
      const wrapper = document.createElement('div');
      wrapper.className =
        'page-thumbnail relative cursor-move flex flex-col items-center gap-1 p-2 border-2 border-gray-600 hover:border-indigo-500 rounded-lg bg-gray-700 transition-colors';
      wrapper.dataset.fileName = fileKey;
      wrapper.dataset.pageIndex = (pageNumber - 1).toString();

      const imgContainer = document.createElement('div');
      imgContainer.className = 'relative';

      const img = document.createElement('img');
      img.src = canvas.toDataURL();
      img.className = 'rounded-md shadow-md max-w-full h-auto';

      const pageNumDiv = document.createElement('div');
      pageNumDiv.className =
        'absolute top-1 left-1 bg-indigo-600 text-white text-xs px-2 py-1 rounded-md font-semibold shadow-lg';
      pageNumDiv.textContent = pageNumber.toString();

      imgContainer.append(img, pageNumDiv);

      const fileNamePara = document.createElement('p');
      fileNamePara.className =
        'text-xs text-gray-400 truncate w-full text-center';
      const fullTitle = displayName
        ? `${displayName} (página ${pageNumber})`
        : `Página ${pageNumber}`;
      fileNamePara.title = fullTitle;
      fileNamePara.textContent = displayName
        ? `${displayName.substring(0, 10)}... (p${pageNumber})`
        : `Página ${pageNumber}`;

      wrapper.append(imgContainer, fileNamePara);
      return wrapper;
    };

    for (let idx = 0; idx < state.files.length; idx++) {
      const file = state.files[idx];
      const fileKey = `${idx}_${file.name}`;
      const pdfjsDoc = mergeState.pdfDocs[fileKey];
      if (!pdfjsDoc) continue;

      const createWrapperWithFileName = (
        canvas: HTMLCanvasElement,
        pageNumber: number
      ) => {
        return createWrapper(canvas, pageNumber, fileKey, file.name);
      };

      // Render pages progressively with lazy loading
      await renderPagesProgressively(
        pdfjsDoc,
        container,
        createWrapperWithFileName,
        {
          batchSize: 8,
          useLazyLoading: true,
          lazyLoadMargin: '300px',
          onProgress: () => {
            currentPageNumber++;
            showLoader(`Renderizando prévias das páginas...`);
          },
          onBatchComplete: () => {
            createIcons({ icons });
          },
        }
      );

      initPagePreview(container, pdfjsDoc);
    }

    mergeState.cachedThumbnails = true;
    mergeState.lastFileHash = currentFileHash;

    initializePageThumbnailsSortable();
  } catch (error) {
    console.error('Error rendering page thumbnails:', error);
    showAlert('Erro', 'Falha ao renderizar as miniaturas das páginas');
  } finally {
    hideLoader();
    mergeState.isRendering = false;
  }
}

const updateUI = async () => {
  const fileControls = document.getElementById('file-controls');
  const mergeOptions = document.getElementById('merge-options');
  const dropZone = document.getElementById('drop-zone');

  if (state.files.length > 0) {
    if (fileControls) fileControls.classList.remove('hidden');
    if (mergeOptions) mergeOptions.classList.remove('hidden');
    if (dropZone) dropZone.classList.add('hidden');
    await refreshMergeUI();
  } else {
    if (fileControls) fileControls.classList.add('hidden');
    if (mergeOptions) mergeOptions.classList.add('hidden');
    if (dropZone) dropZone.classList.remove('hidden');
    // Clear file list UI
    const fileList = document.getElementById('file-list');
    if (fileList) fileList.innerHTML = '';
  }
};

const resetState = async () => {
  state.files = [];
  state.pdfDoc = null;

  mergeState.pdfDocs = {};
  mergeState.pdfBytes = {};
  mergeState.activeMode = 'file';
  mergeState.cachedThumbnails = null;
  mergeState.lastFileHash = null;
  mergeState.mergeSuccess = false;

  if (fileThumbObserver) {
    fileThumbObserver.disconnect();
    fileThumbObserver = null;
  }

  const fileList = document.getElementById('file-list');
  if (fileList) fileList.innerHTML = '';

  const pageMergePreview = document.getElementById('page-merge-preview');
  if (pageMergePreview) pageMergePreview.innerHTML = '';

  const fileModeBtn = document.getElementById('file-mode-btn');
  const pageModeBtn = document.getElementById('page-mode-btn');
  const filePanel = document.getElementById('file-mode-panel');
  const pagePanel = document.getElementById('page-mode-panel');

  if (fileModeBtn && pageModeBtn && filePanel && pagePanel) {
    fileModeBtn.classList.add('bg-indigo-600', 'text-white');
    fileModeBtn.classList.remove('bg-gray-700', 'text-gray-300');
    pageModeBtn.classList.remove('bg-indigo-600', 'text-white');
    pageModeBtn.classList.add('bg-gray-700', 'text-gray-300');

    filePanel.classList.remove('hidden');
    pagePanel.classList.add('hidden');
  }

  await updateUI();
};

export async function merge() {
  // Check if CPDF is configured
  if (!isCpdfAvailable()) {
    showWasmRequiredDialog('cpdf');
    return;
  }

  showLoader('Mesclando PDFs...');
  try {
    const jobs: MergeJob[] = [];
    const filesToMerge: MergeFile[] = [];
    const uniqueFileNames = new Set<string>();

    if (mergeState.activeMode === 'file') {
      const fileList = document.getElementById('file-list');
      if (!fileList) throw new Error('File list not found');

      const sortedFileKeys = Array.from(fileList.children)
        .map((li) => (li as HTMLElement).dataset.fileName)
        .filter((key): key is string => !!key);

      for (const fileKey of sortedFileKeys) {
        const safeFileName = fileKey.replace(/[^a-zA-Z0-9]/g, '_');
        const rangeInput = document.getElementById(
          `range-${safeFileName}`
        ) as HTMLInputElement;

        uniqueFileNames.add(fileKey);

        if (rangeInput && rangeInput.value.trim()) {
          jobs.push({
            fileName: fileKey,
            rangeType: 'specific',
            rangeString: rangeInput.value.trim(),
          });
        } else {
          jobs.push({
            fileName: fileKey,
            rangeType: 'all',
          });
        }
      }
    } else {
      // Page Mode
      const pageContainer = document.getElementById('page-merge-preview');
      if (!pageContainer) throw new Error('Page container not found');
      const pageElements = Array.from(pageContainer.children);

      const rawPages: { fileName: string; pageIndex: number }[] = [];
      for (const el of pageElements) {
        const element = el as HTMLElement;
        const fileName = element.dataset.fileName;
        const pageIndex = parseInt(element.dataset.pageIndex || '', 10); // 0-based index from dataset

        if (fileName && !isNaN(pageIndex)) {
          uniqueFileNames.add(fileName);
          rawPages.push({ fileName, pageIndex });
        }
      }

      // Group contiguous pages
      for (let i = 0; i < rawPages.length; i++) {
        const current = rawPages[i];
        let endPage = current.pageIndex;

        while (
          i + 1 < rawPages.length &&
          rawPages[i + 1].fileName === current.fileName &&
          rawPages[i + 1].pageIndex === endPage + 1
        ) {
          endPage++;
          i++;
        }

        if (endPage === current.pageIndex) {
          // Single page
          jobs.push({
            fileName: current.fileName,
            rangeType: 'single',
            pageIndex: current.pageIndex,
          });
        } else {
          // Range of pages
          jobs.push({
            fileName: current.fileName,
            rangeType: 'range',
            startPage: current.pageIndex + 1,
            endPage: endPage + 1,
          });
        }
      }
    }

    if (jobs.length === 0) {
      showAlert('Erro', 'Nenhum arquivo ou página selecionado para mesclar.');
      hideLoader();
      return;
    }

    for (const name of uniqueFileNames) {
      const bytes = mergeState.pdfBytes[name];
      if (bytes) {
        filesToMerge.push({ name, data: bytes });
      }
    }

    const retainCheckbox = document.getElementById(
      'retain-page-labels'
    ) as HTMLInputElement | null;

    const message: MergeMessage = {
      command: 'merge',
      files: filesToMerge,
      jobs: jobs,
      cpdfUrl: WasmProvider.getUrl('cpdf')! + 'coherentpdf.browser.min.js',
      retainPageLabels: retainCheckbox?.checked ?? false,
    };

    mergeWorker.postMessage(
      message,
      filesToMerge.map((f) => f.data)
    );

    mergeWorker.onmessage = (e: MessageEvent<MergeResponse>) => {
      hideLoader();
      if (e.data.status === 'success') {
        const blob = new Blob([e.data.pdfBytes], { type: 'application/pdf' });
        downloadFile(
          blob,
          withPdfSuffix(
            (state.files[0] as File)?.name || 'mesclado',
            'mesclado'
          )
        );
        mergeState.mergeSuccess = true;
        showAlert(
          'Sucesso',
          'PDFs mesclados com sucesso!',
          'success',
          async () => {
            await resetState();
          }
        );
      } else {
        console.error('Worker merge error:', e.data.message);
        showAlert('Erro', e.data.message || 'Falha ao mesclar os PDFs.');
      }
    };

    mergeWorker.onerror = (e) => {
      hideLoader();
      console.error('Worker error:', e);
      showAlert('Erro', 'Ocorreu um erro inesperado no worker de mesclagem.');
    };
  } catch (e) {
    console.error('Merge error:', e);
    showAlert(
      'Erro',
      'Falha ao mesclar os PDFs. Verifique se todos os arquivos são válidos e não estão protegidos por senha.'
    );
    hideLoader();
  }
}

export async function refreshMergeUI() {
  document.getElementById('merge-options')?.classList.remove('hidden');
  const processBtn = document.getElementById(
    'process-btn'
  ) as HTMLButtonElement;
  if (processBtn) processBtn.disabled = false;

  const wasInPageMode = mergeState.activeMode === 'page';

  showLoader('Carregando documentos PDF...');
  try {
    mergeState.pdfDocs = {};
    mergeState.pdfBytes = {};

    hideLoader();
    state.files = await batchDecryptIfNeeded(state.files);
    showLoader('Carregando documentos PDF...');

    for (let i = 0; i < state.files.length; i++) {
      const file = state.files[i];
      const fileKey = `${i}_${file.name}`;

      const bytes = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      mergeState.pdfBytes[fileKey] = bytes;
      mergeState.pdfDocs[fileKey] = pdf;
    }

    if (state.files.length === 0) {
      hideLoader();
      return;
    }
  } catch (error) {
    console.error('Error loading PDFs:', error);
    showAlert('Erro', 'Falha ao carregar um ou mais arquivos PDF');
    return;
  } finally {
    hideLoader();
  }

  const fileModeBtn = document.getElementById('file-mode-btn');
  const pageModeBtn = document.getElementById('page-mode-btn');
  const filePanel = document.getElementById('file-mode-panel');
  const pagePanel = document.getElementById('page-mode-panel');
  const fileList = document.getElementById('file-list');

  if (!fileModeBtn || !pageModeBtn || !filePanel || !pagePanel || !fileList)
    return;

  fileList.textContent = ''; // Clear list safely
  const thumbObserver = createFileThumbObserver();

  (state.files as File[]).forEach((f, index) => {
    const fileKey = `${index}_${f.name}`;
    const doc = mergeState.pdfDocs[fileKey];
    const pageCount = doc ? doc.numPages : 0;

    const card = document.createElement('li');
    card.className =
      'merge-file-card group relative flex flex-col gap-2 p-2 border-2 border-gray-600 hover:border-indigo-500 rounded-lg bg-gray-700 transition-colors cursor-move select-none';
    card.dataset.fileName = fileKey;

    const deleteBtn = document.createElement('button');
    deleteBtn.className =
      'no-drag absolute top-1 right-1 z-10 bg-gray-900/80 hover:bg-red-600 text-white/80 hover:text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-colors';
    deleteBtn.title = 'Remover arquivo';
    deleteBtn.innerHTML =
      '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.files = state.files.filter((_, i) => i !== index);
      updateUI();
    });

    const thumb = document.createElement('div');
    thumb.className =
      'thumb relative rounded-md overflow-hidden bg-gray-800 flex items-center justify-center w-full';
    thumb.style.aspectRatio = '3 / 4';
    thumb.dataset.key = fileKey;

    const skeleton = document.createElement('span');
    skeleton.className = 'text-gray-500 text-xs animate-pulse';
    skeleton.textContent = 'Carregando…';
    thumb.appendChild(skeleton);

    if (doc) {
      const badge = document.createElement('span');
      badge.className =
        'thumb-badge absolute bottom-1 left-1 bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded font-semibold shadow';
      badge.textContent = pageCount === 1 ? '1 página' : `${pageCount} páginas`;
      thumb.appendChild(badge);

      card.title = 'Arraste para reordenar · dois cliques para pré-visualizar';
      // Detecção manual de duplo-clique: o SortableJS suprime o evento
      // "dblclick" nativo do item arrastável, então contamos os cliques.
      let lastCardClick = 0;
      card.addEventListener('click', () => {
        const now = Date.now();
        if (now - lastCardClick < 350) {
          lastCardClick = 0;
          showFilePreview(doc, f.name);
        } else {
          lastCardClick = now;
        }
      });
      thumbObserver.observe(thumb);
    }

    const nameEl = document.createElement('p');
    nameEl.className = 'text-xs text-gray-300 truncate w-full text-center';
    nameEl.title = f.name;
    nameEl.textContent = f.name;

    card.append(deleteBtn, thumb, nameEl);
    fileList.appendChild(card);
  });

  const addTile = document.createElement('li');
  addTile.className =
    'add-tile flex flex-col items-center justify-center gap-1 min-h-[8rem] p-2 border-2 border-dashed border-gray-600 hover:border-indigo-500 rounded-lg bg-gray-800/40 text-gray-400 hover:text-indigo-400 cursor-pointer transition-colors';
  addTile.title = 'Adicionar mais arquivos';
  addTile.innerHTML =
    '<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg><span class="text-xs">Adicionar</span>';
  addTile.addEventListener('click', () => {
    const fi = document.getElementById('file-input') as HTMLInputElement | null;
    if (fi) {
      fi.value = '';
      fi.click();
    }
  });
  fileList.appendChild(addTile);

  createIcons({ icons });
  initializeFileListSortable();

  const newFileModeBtn = fileModeBtn.cloneNode(true) as HTMLElement;
  const newPageModeBtn = pageModeBtn.cloneNode(true) as HTMLElement;
  fileModeBtn.replaceWith(newFileModeBtn);
  pageModeBtn.replaceWith(newPageModeBtn);

  newFileModeBtn.addEventListener('click', () => {
    if (mergeState.activeMode === 'file') return;

    mergeState.activeMode = 'file';
    filePanel.classList.remove('hidden');
    pagePanel.classList.add('hidden');

    newFileModeBtn.classList.add('bg-indigo-600', 'text-white');
    newFileModeBtn.classList.remove('bg-gray-700', 'text-gray-300');
    newPageModeBtn.classList.remove('bg-indigo-600', 'text-white');
    newPageModeBtn.classList.add('bg-gray-700', 'text-gray-300');
  });

  newPageModeBtn.addEventListener('click', async () => {
    if (mergeState.activeMode === 'page') return;

    mergeState.activeMode = 'page';
    filePanel.classList.add('hidden');
    pagePanel.classList.remove('hidden');

    newPageModeBtn.classList.add('bg-indigo-600', 'text-white');
    newPageModeBtn.classList.remove('bg-gray-700', 'text-gray-300');
    newFileModeBtn.classList.remove('bg-indigo-600', 'text-white');
    newFileModeBtn.classList.add('bg-gray-700', 'text-gray-300');

    await renderPageMergeThumbnails();
  });

  if (wasInPageMode) {
    mergeState.activeMode = 'page';
    filePanel.classList.add('hidden');
    pagePanel.classList.remove('hidden');

    newPageModeBtn.classList.add('bg-indigo-600', 'text-white');
    newPageModeBtn.classList.remove('bg-gray-700', 'text-gray-300');
    newFileModeBtn.classList.remove('bg-indigo-600', 'text-white');
    newFileModeBtn.classList.add('bg-gray-700', 'text-gray-300');

    await renderPageMergeThumbnails();
  } else {
    newFileModeBtn.classList.add('bg-indigo-600', 'text-white');
    newPageModeBtn.classList.add('bg-gray-700', 'text-gray-300');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById('process-btn');

  const fileControls = document.getElementById('file-controls');
  const addMoreBtn = document.getElementById('add-more-btn');
  const clearFilesBtn = document.getElementById('clear-files-btn');
  const backBtn = document.getElementById('back-to-tools');
  const mergeOptions = document.getElementById('merge-options');

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = import.meta.env.BASE_URL;
    });
  }

  if (fileInput && dropZone) {
    fileInput.addEventListener('change', async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        // O seletor de arquivos do Windows devolve a seleção múltipla na
        // ordem inversa à dos cliques; invertemos para respeitar a sequência
        // em que o usuário escolheu os arquivos.
        state.files = [...state.files, ...Array.from(files).reverse()];
        await updateUI();
      }
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('bg-gray-700');
    });

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
    });

    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const pdfFiles = Array.from(files).filter(
          (f) =>
            f.type === 'application/pdf' ||
            f.name.toLowerCase().endsWith('.pdf')
        );
        if (pdfFiles.length > 0) {
          state.files = [...state.files, ...pdfFiles];
          await updateUI();
        }
      }
    });

    fileInput.addEventListener('click', () => {
      fileInput.value = '';
    });
  }

  if (addMoreBtn) {
    addMoreBtn.addEventListener('click', () => {
      fileInput.value = '';
      fileInput.click();
    });
  }

  if (clearFilesBtn) {
    clearFilesBtn.addEventListener('click', async () => {
      state.files = [];
      await updateUI();
    });
  }

  if (processBtn) {
    processBtn.addEventListener('click', async () => {
      await merge();
    });
  }
});
