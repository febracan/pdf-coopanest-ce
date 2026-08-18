import { createIcons, icons } from 'lucide';
import { showAlert, showLoader, hideLoader } from '../ui.js';
import { downloadFile, formatBytes } from '../utils/helpers.js';
import { loadPyMuPDF } from '../utils/pymupdf-loader.js';
import type { PyMuPDFInstance } from '@/types';
import {
  getSelectedQuality,
  compressImageFile,
} from '../utils/image-compress.js';
import { showImagePreview } from '../utils/image-preview.js';
import Sortable from 'sortablejs';

const SUPPORTED_FORMATS = '.jpg,.jpeg,.jp2,.jpx';
const SUPPORTED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/jp2'];

let files: File[] = [];
let pymupdf: PyMuPDFInstance | null = null;
let gridSortable: Sortable | null = null;
const objectUrls = new Map<File, string>();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePage);
} else {
  initializePage();
}

function initializePage() {
  createIcons({ icons });

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const addMoreBtn = document.getElementById('add-more-btn');
  const clearFilesBtn = document.getElementById('clear-files-btn');
  const processBtn = document.getElementById('process-btn');

  if (fileInput) {
    fileInput.addEventListener('change', handleFileUpload);
  }

  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('bg-gray-700');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('bg-gray-700');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
      const droppedFiles = e.dataTransfer?.files;
      if (droppedFiles && droppedFiles.length > 0) {
        // Arrastar-e-soltar preserva a ordem original.
        handleFiles(Array.from(droppedFiles));
      }
    });

    fileInput?.addEventListener('click', () => {
      if (fileInput) fileInput.value = '';
    });
  }

  if (addMoreBtn) {
    addMoreBtn.addEventListener('click', () => {
      fileInput?.click();
    });
  }

  if (clearFilesBtn) {
    clearFilesBtn.addEventListener('click', resetState);
  }

  if (processBtn) {
    processBtn.addEventListener('click', convertToPdf);
  }

  document.getElementById('back-to-tools')?.addEventListener('click', () => {
    window.location.href = import.meta.env.BASE_URL;
  });
}

function handleFileUpload(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    // O seletor de arquivos do Windows devolve a seleção múltipla na ordem
    // inversa à dos cliques; invertemos para respeitar a sequência escolhida.
    handleFiles(Array.from(input.files).reverse());
  }
}

function getFileExtension(filename: string): string {
  return '.' + (filename.split('.').pop()?.toLowerCase() || '');
}

function isValidImageFile(file: File): boolean {
  const ext = getFileExtension(file.name);
  const validExtensions = SUPPORTED_FORMATS.split(',');
  return (
    validExtensions.includes(ext) || SUPPORTED_MIME_TYPES.includes(file.type)
  );
}

function handleFiles(incoming: File[]) {
  const validFiles = incoming.filter(isValidImageFile);

  if (validFiles.length < incoming.length) {
    showAlert(
      'Arquivos inválidos',
      'Alguns arquivos foram ignorados. Apenas arquivos JPG, JPEG, JP2 e JPX são permitidos.'
    );
  }

  if (validFiles.length > 0) {
    files = [...files, ...validFiles];
    updateUI();
  }
}

function urlFor(file: File): string {
  let url = objectUrls.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    objectUrls.set(file, url);
  }
  return url;
}

function pruneObjectUrls() {
  for (const [file, url] of objectUrls) {
    if (!files.includes(file)) {
      URL.revokeObjectURL(url);
      objectUrls.delete(file);
    }
  }
}

const resetState = () => {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
  files = [];
  updateUI();
};

function initializeGridSortable() {
  const container = document.getElementById('file-display-area');
  if (!container) return;

  if (gridSortable) gridSortable.destroy();

  gridSortable = Sortable.create(container, {
    animation: 150,
    draggable: '.img-card',
    filter: '.no-drag',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    onStart: function (evt: Sortable.SortableEvent) {
      evt.item.style.opacity = '0.5';
    },
    onEnd: function (evt: Sortable.SortableEvent) {
      evt.item.style.opacity = '1';
      // Reordena o array `files` conforme a nova ordem visual dos cards.
      const order = Array.from(container.querySelectorAll('.img-card')).map(
        (el) => parseInt((el as HTMLElement).dataset.idx || '0', 10)
      );
      files = order.map((i) => files[i]);
      updateUI();
    },
  });
}

function updateUI() {
  const fileDisplayArea = document.getElementById('file-display-area');
  const fileControls = document.getElementById('file-controls');
  const optionsDiv = document.getElementById('jpg-to-pdf-options');
  const instructions = document.getElementById('jpg-instructions');
  const dropZone = document.getElementById('drop-zone');

  if (!fileDisplayArea || !fileControls || !optionsDiv) return;

  pruneObjectUrls();
  fileDisplayArea.innerHTML = '';

  if (files.length === 0) {
    fileControls.classList.add('hidden');
    optionsDiv.classList.add('hidden');
    if (instructions) instructions.classList.add('hidden');
    if (dropZone) dropZone.classList.remove('hidden');
    return;
  }

  fileControls.classList.remove('hidden');
  optionsDiv.classList.remove('hidden');
  if (instructions) instructions.classList.remove('hidden');
  if (dropZone) dropZone.classList.add('hidden');

  files.forEach((file, index) => {
    const card = document.createElement('div');
    card.className =
      'img-card group relative flex flex-col gap-2 p-2 border-2 border-gray-600 hover:border-indigo-500 rounded-lg bg-gray-700 transition-colors cursor-move select-none';
    card.dataset.idx = String(index);

    const deleteBtn = document.createElement('button');
    deleteBtn.className =
      'no-drag absolute top-1 right-1 z-10 bg-gray-900/80 hover:bg-red-600 text-white/80 hover:text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-colors';
    deleteBtn.title = 'Remover imagem';
    deleteBtn.innerHTML =
      '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      files = files.filter((_, i) => i !== index);
      updateUI();
    });

    const thumb = document.createElement('div');
    thumb.className =
      'thumb relative rounded-md overflow-hidden bg-gray-800 flex items-center justify-center w-full';
    thumb.style.aspectRatio = '3 / 4';

    const img = document.createElement('img');
    img.src = urlFor(file);
    img.alt = file.name;
    img.draggable = false;
    img.className = 'w-full h-full object-contain';
    thumb.appendChild(img);

    const badge = document.createElement('span');
    badge.className =
      'absolute bottom-1 left-1 bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded font-semibold shadow';
    badge.textContent = formatBytes(file.size);
    thumb.appendChild(badge);

    // Detecção manual de duplo-clique (o SortableJS suprime o "dblclick"
    // nativo do item arrastável).
    card.title = 'Arraste para reordenar · dois cliques para ampliar';
    let lastCardClick = 0;
    card.addEventListener('click', () => {
      const now = Date.now();
      if (now - lastCardClick < 350) {
        lastCardClick = 0;
        showImagePreview(urlFor(file), file.name);
      } else {
        lastCardClick = now;
      }
    });

    const nameEl = document.createElement('p');
    nameEl.className = 'text-xs text-gray-300 truncate w-full text-center';
    nameEl.title = file.name;
    nameEl.textContent = file.name;

    card.append(deleteBtn, thumb, nameEl);
    fileDisplayArea.appendChild(card);
  });

  const addTile = document.createElement('div');
  addTile.className =
    'add-tile flex flex-col items-center justify-center gap-1 min-h-[8rem] p-2 border-2 border-dashed border-gray-600 hover:border-indigo-500 rounded-lg bg-gray-800/40 text-gray-400 hover:text-indigo-400 cursor-pointer transition-colors';
  addTile.title = 'Adicionar mais imagens';
  addTile.innerHTML =
    '<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg><span class="text-xs">Adicionar</span>';
  addTile.addEventListener('click', () => {
    const fi = document.getElementById('file-input') as HTMLInputElement | null;
    if (fi) {
      fi.value = '';
      fi.click();
    }
  });
  fileDisplayArea.appendChild(addTile);

  createIcons({ icons });
  initializeGridSortable();
}

async function ensurePyMuPDF(): Promise<PyMuPDFInstance> {
  if (!pymupdf) {
    pymupdf = (await loadPyMuPDF()) as PyMuPDFInstance;
  }
  return pymupdf;
}

async function convertToPdf() {
  if (files.length === 0) {
    showAlert(
      'Nenhum arquivo',
      'Selecione pelo menos uma imagem JPG ou JPEG2000.'
    );
    return;
  }

  showLoader('Carregando mecanismo...');

  try {
    const mupdf = await ensurePyMuPDF();

    showLoader('Convertendo imagens para PDF...');
    const quality = getSelectedQuality();
    const compressedFiles: File[] = [];
    for (const file of files) {
      compressedFiles.push(await compressImageFile(file, quality));
    }

    const pdfBlob = await mupdf.imagesToPdf(compressedFiles);

    downloadFile(pdfBlob, 'from_jpgs.pdf');

    showAlert('Sucesso', 'PDF criado com sucesso!', 'success', () => {
      resetState();
    });
  } catch (e: unknown) {
    console.error('[JpgToPdf]', e);
    showAlert(
      'Erro de conversão',
      e instanceof Error ? e.message : 'Falha ao converter imagens para PDF.'
    );
  } finally {
    hideLoader();
  }
}
