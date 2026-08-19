// UI compartilhada dos conversores "documento -> PDF" (Word, Excel, PowerPoint,
// etc.). Sem miniatura (não dá para pré-visualizar sem converter): cada arquivo
// vira um card com ícone do tipo + nome + tamanho, arrastável para reordenar,
// com tile "+" e nome de saída com sufixo. Um arquivo -> PDF; vários -> .zip.
// Cada ferramenta fornece só validação, ícone e a conversão de UM arquivo.
import { createIcons, icons } from 'lucide';
import { showAlert, showLoader, hideLoader } from '../ui.js';
import { downloadFile, formatBytes } from './helpers.js';
import { withPdfSuffix } from './output-name.js';
import { deduplicateFileName } from './deduplicate-filename.js';
import Sortable from 'sortablejs';

export interface DocToPdfConfig {
  isValid: (file: File) => boolean;
  invalidMessage: string;
  emptyMessage: string;
  suffix: string;
  optionsSelector: string;
  icon: string; // nome do ícone lucide (ex.: 'file-text')
  accent: string; // classe de cor do ícone (ex.: 'text-blue-400')
  successMessage: string;
  loadingMessage?: string;
  timeoutMs?: number; // limite por arquivo; default 120000
  prepare?: (
    onProgress: (message: string, percent?: number) => void
  ) => Promise<void>;
  convertOne: (file: File) => Promise<Blob>;
}

function zipName(name: string, suffix: string): string {
  const base = (name || 'arquivo').replace(/\.[^./\\]+$/, '');
  const clean = suffix.replace(/^_+/, '').trim();
  return clean ? `${base}_${clean}.zip` : `${base}.zip`;
}

// Evita spinner infinito quando a conversão trava (ex.: CSV exige filtro de
// import interativo no LibreOffice WASM, ou arquivo corrompido/nao suportado).
function withTimeout<T>(p: Promise<T>, ms: number, name: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () =>
        reject(
          new Error(
            `Tempo esgotado ao converter "${name}". O formato pode não ser suportado por esta ferramenta.`
          )
        ),
      ms
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export function setupDocToPdfPage(config: DocToPdfConfig): void {
  let files: File[] = [];
  let gridSortable: Sortable | null = null;

  const $ = (id: string) => document.getElementById(id);

  function reset() {
    files = [];
    updateUI();
  }

  function addFiles(incoming: File[]) {
    const valid = incoming.filter(config.isValid);
    if (valid.length < incoming.length) {
      showAlert('Arquivos inválidos', config.invalidMessage);
    }
    if (valid.length > 0) {
      files = [...files, ...valid];
      updateUI();
    }
  }

  function initSortable(container: HTMLElement) {
    if (gridSortable) gridSortable.destroy();
    gridSortable = Sortable.create(container, {
      animation: 150,
      draggable: '.doc-card',
      filter: '.no-drag',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onStart: (evt: Sortable.SortableEvent) => {
        evt.item.style.opacity = '0.5';
      },
      onEnd: (evt: Sortable.SortableEvent) => {
        evt.item.style.opacity = '1';
        const order = Array.from(container.querySelectorAll('.doc-card')).map(
          (el) => parseInt((el as HTMLElement).dataset.idx || '0', 10)
        );
        files = order.map((i) => files[i]);
        updateUI();
      },
    });
  }

  function ensureInstructions(): HTMLElement | null {
    const area = $('file-display-area');
    if (!area || !area.parentElement) return null;
    let box = document.getElementById('doc-tool-instructions');
    if (!box) {
      box = document.createElement('div');
      box.id = 'doc-tool-instructions';
      box.className =
        'hidden p-3 bg-gray-900 rounded-lg border border-gray-700 mt-4';
      box.innerHTML =
        '<ul class="list-disc list-inside text-xs text-gray-400 space-y-1"><li>Arraste os cards para reordenar os documentos.</li><li>Um arquivo gera um PDF; vários geram um <strong>.zip</strong> com um PDF por documento.</li></ul>';
      area.parentElement.insertBefore(box, area);
    }
    return box;
  }

  function updateUI() {
    const fileDisplayArea = $('file-display-area');
    const fileControls = $('file-controls');
    const optionsDiv = document.querySelector(config.optionsSelector);
    const dropZone = $('drop-zone');
    const addMoreBtn = $('add-more-btn');
    const instructions = ensureInstructions();
    if (!fileDisplayArea) return;

    if (addMoreBtn) addMoreBtn.classList.add('hidden');
    fileDisplayArea.className = 'mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3';

    fileDisplayArea.innerHTML = '';

    if (files.length === 0) {
      fileControls?.classList.add('hidden');
      optionsDiv?.classList.add('hidden');
      instructions?.classList.add('hidden');
      dropZone?.classList.remove('hidden');
      return;
    }

    fileControls?.classList.remove('hidden');
    optionsDiv?.classList.remove('hidden');
    instructions?.classList.remove('hidden');
    dropZone?.classList.add('hidden');

    files.forEach((file, index) => {
      const card = document.createElement('div');
      card.className =
        'doc-card group relative flex items-center gap-3 p-3 pr-9 border-2 border-gray-600 hover:border-indigo-500 rounded-lg bg-gray-700 transition-colors cursor-move select-none';
      card.dataset.idx = String(index);
      card.title = 'Arraste para reordenar';

      const iconWrap = document.createElement('div');
      iconWrap.className = `flex-shrink-0 ${config.accent}`;
      iconWrap.innerHTML = `<i data-lucide="${config.icon}" class="w-8 h-8"></i>`;

      const info = document.createElement('div');
      info.className = 'flex flex-col overflow-hidden min-w-0';
      const nameEl = document.createElement('div');
      nameEl.className = 'truncate font-medium text-gray-200 text-sm';
      nameEl.title = file.name;
      nameEl.textContent = file.name;
      const metaEl = document.createElement('div');
      metaEl.className = 'text-xs text-gray-400';
      metaEl.textContent = formatBytes(file.size);
      info.append(nameEl, metaEl);

      const deleteBtn = document.createElement('button');
      deleteBtn.className =
        'no-drag absolute top-1 right-1 z-10 bg-gray-900/80 hover:bg-red-600 text-white/80 hover:text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-colors';
      deleteBtn.title = 'Remover documento';
      deleteBtn.innerHTML =
        '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        files = files.filter((_, i) => i !== index);
        updateUI();
      });

      card.append(iconWrap, info, deleteBtn);
      fileDisplayArea.appendChild(card);
    });

    const addTile = document.createElement('div');
    addTile.className =
      'add-tile flex items-center justify-center gap-1 min-h-[4rem] p-3 border-2 border-dashed border-gray-600 hover:border-indigo-500 rounded-lg bg-gray-800/40 text-gray-400 hover:text-indigo-400 cursor-pointer transition-colors';
    addTile.title = 'Adicionar mais documentos';
    addTile.innerHTML =
      '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg><span class="text-xs">Adicionar</span>';
    addTile.addEventListener('click', () => {
      const fi = $('file-input') as HTMLInputElement | null;
      if (fi) {
        fi.value = '';
        fi.click();
      }
    });
    fileDisplayArea.appendChild(addTile);

    createIcons({ icons });
    initSortable(fileDisplayArea);
  }

  async function process() {
    if (files.length === 0) {
      showAlert('Nenhum arquivo', config.emptyMessage);
      return;
    }
    showLoader(config.loadingMessage || 'Processando...');
    try {
      await config.prepare?.((message, percent) =>
        showLoader(message, percent)
      );
      const limit = config.timeoutMs ?? 120000;

      if (files.length === 1) {
        const blob = await withTimeout(
          config.convertOne(files[0]),
          limit,
          files[0].name
        );
        downloadFile(blob, withPdfSuffix(files[0].name, config.suffix));
      } else {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        const used = new Set<string>();
        for (let i = 0; i < files.length; i++) {
          showLoader(
            `Convertendo ${i + 1}/${files.length}: ${files[i].name}...`
          );
          const blob = await withTimeout(
            config.convertOne(files[i]),
            limit,
            files[i].name
          );
          const entry = deduplicateFileName(
            withPdfSuffix(files[i].name, config.suffix),
            used
          );
          zip.file(entry, await blob.arrayBuffer());
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        downloadFile(zipBlob, zipName(files[0].name, config.suffix));
      }

      showAlert('Conversão concluída', config.successMessage, 'success', () =>
        reset()
      );
    } catch (e: unknown) {
      console.error('[DocToPdf]', e);
      showAlert(
        'Erro de conversão',
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      hideLoader();
    }
  }

  function init() {
    createIcons({ icons });
    const fileInput = $('file-input') as HTMLInputElement | null;
    const dropZone = $('drop-zone');
    const addMoreBtn = $('add-more-btn');
    const clearFilesBtn = $('clear-files-btn');
    const processBtn = $('process-btn');

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const picked = (e.target as HTMLInputElement).files;
        if (picked && picked.length > 0) {
          // Seletor do Windows devolve invertido — reverte p/ ordem de clique.
          addFiles(Array.from(picked).reverse());
        }
      });
      fileInput.addEventListener('click', () => {
        fileInput.value = '';
      });
    }
    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('bg-gray-700');
      });
      dropZone.addEventListener('dragleave', () =>
        dropZone.classList.remove('bg-gray-700')
      );
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('bg-gray-700');
        const dropped = e.dataTransfer?.files;
        if (dropped && dropped.length > 0) addFiles(Array.from(dropped));
      });
    }
    if (addMoreBtn)
      addMoreBtn.addEventListener('click', () => fileInput?.click());
    if (clearFilesBtn) clearFilesBtn.addEventListener('click', reset);
    if (processBtn) processBtn.addEventListener('click', process);
    $('back-to-tools')?.addEventListener('click', () => {
      window.location.href = import.meta.env.BASE_URL;
    });

    updateUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
