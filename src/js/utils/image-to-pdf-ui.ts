// UI compartilhada dos conversores "imagem -> PDF": grade de cards com
// miniatura, arrastar-para-reordenar, duplo-clique -> pré-visualização,
// botão de girar 90°, tile "+", inversão da ordem do seletor do Windows e
// nome de saída com sufixo. Cada ferramenta só fornece a validação e a
// função de conversão (que recebe os arquivos já rotacionados).
import { createIcons, icons } from 'lucide';
import { showAlert, showLoader, hideLoader } from '../ui.js';
import { downloadFile, formatBytes } from './helpers.js';
import { showImagePreview } from './image-preview.js';
import { withPdfSuffix } from './output-name.js';
import Sortable from 'sortablejs';

export interface ImageToPdfConfig {
  isValid: (file: File) => boolean;
  invalidMessage: string;
  emptyMessage: string;
  suffix: string;
  optionsSelector: string;
  convert: (files: File[]) => Promise<Blob>;
  loadingMessage?: string;
  enableRotate?: boolean;
  setup?: () => void;
}

export function setupImageToPdfPage(config: ImageToPdfConfig): void {
  let files: File[] = [];
  let gridSortable: Sortable | null = null;
  const objectUrls = new Map<File, string>();
  const rotations = new Map<File, number>();
  const enableRotate = config.enableRotate !== false;

  const $ = (id: string) => document.getElementById(id);

  function urlFor(file: File): string {
    let url = objectUrls.get(file);
    if (!url) {
      url = URL.createObjectURL(file);
      objectUrls.set(file, url);
    }
    return url;
  }

  function prune() {
    for (const [file, url] of objectUrls) {
      if (!files.includes(file)) {
        URL.revokeObjectURL(url);
        objectUrls.delete(file);
        rotations.delete(file);
      }
    }
  }

  function reset() {
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
    objectUrls.clear();
    rotations.clear();
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

  async function renderRotated(
    file: File,
    deg: number,
    maxDim: number
  ): Promise<HTMLCanvasElement> {
    const bmp = await createImageBitmap(file);
    const rot = ((deg % 360) + 360) % 360;
    let w = bmp.width;
    let h = bmp.height;
    if (maxDim && Math.max(w, h) > maxDim) {
      const s = maxDim / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    }
    const swap = rot === 90 || rot === 270;
    const canvas = document.createElement('canvas');
    canvas.width = swap ? h : w;
    canvas.height = swap ? w : h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
    }
    if ('close' in bmp) bmp.close();
    return canvas;
  }

  async function setThumbImage(thumb: HTMLElement, file: File): Promise<void> {
    const deg = rotations.get(file) || 0;
    let el: HTMLElement;
    try {
      if (deg % 360 === 0) {
        const img = document.createElement('img');
        img.src = urlFor(file);
        img.alt = file.name;
        img.draggable = false;
        img.className = 'thumb-img w-full h-full object-contain';
        // Se o navegador não decodificar (ex.: formato exótico), mostra ícone.
        img.onerror = () => {
          const ph = document.createElement('div');
          ph.className =
            'thumb-img w-full h-full flex items-center justify-center text-gray-500 text-3xl';
          ph.textContent = '🖼️';
          img.replaceWith(ph);
        };
        el = img;
      } else {
        const canvas = await renderRotated(file, deg, 480);
        canvas.className = 'thumb-img w-full h-full object-contain';
        el = canvas;
      }
    } catch {
      const ph = document.createElement('div');
      ph.className =
        'thumb-img w-full h-full flex items-center justify-center text-gray-500 text-3xl';
      ph.textContent = '🖼️';
      el = ph;
    }
    const old = thumb.querySelector('.thumb-img');
    if (old) old.replaceWith(el);
    else thumb.insertBefore(el, thumb.firstChild);
  }

  function initSortable(container: HTMLElement) {
    if (gridSortable) gridSortable.destroy();
    gridSortable = Sortable.create(container, {
      animation: 150,
      draggable: '.img-card',
      filter: '.no-drag',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onStart: (evt: Sortable.SortableEvent) => {
        evt.item.style.opacity = '0.5';
      },
      onEnd: (evt: Sortable.SortableEvent) => {
        evt.item.style.opacity = '1';
        const order = Array.from(container.querySelectorAll('.img-card')).map(
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
    let box = document.getElementById('img-tool-instructions');
    if (!box) {
      box = document.createElement('div');
      box.id = 'img-tool-instructions';
      box.className =
        'hidden p-3 bg-gray-900 rounded-lg border border-gray-700 mt-4';
      const rotateLine = enableRotate
        ? '<li>Use o botão <strong>↻</strong> (canto superior esquerdo) para girar imagens verticais.</li>'
        : '';
      box.innerHTML = `<ul class="list-disc list-inside text-xs text-gray-400 space-y-1"><li>Arraste as miniaturas para reorganizar as imagens.</li><li>Dê <strong>dois cliques</strong> na miniatura para ampliar.</li>${rotateLine}</ul>`;
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
    fileDisplayArea.className =
      'mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3';

    prune();
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

      const badge = document.createElement('span');
      badge.className =
        'absolute bottom-1 left-1 bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded font-semibold shadow';
      badge.textContent = formatBytes(file.size);
      thumb.appendChild(badge);
      void setThumbImage(thumb, file);

      card.append(deleteBtn);

      if (enableRotate) {
        const rotateBtn = document.createElement('button');
        rotateBtn.className =
          'no-drag absolute top-1 left-1 z-10 bg-gray-900/80 hover:bg-indigo-600 text-white/80 hover:text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-colors';
        rotateBtn.title = 'Girar 90°';
        rotateBtn.innerHTML =
          '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v6h6M20 20v-6h-6M20 9A8 8 0 006 5.3M4 15a8 8 0 0014 3.7"/></svg>';
        rotateBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          rotations.set(file, ((rotations.get(file) || 0) + 90) % 360);
          void setThumbImage(thumb, file);
        });
        card.append(rotateBtn);
      }

      card.title = 'Arraste para reordenar · dois cliques para ampliar';
      let lastCardClick = 0;
      card.addEventListener('click', () => {
        const now = Date.now();
        if (now - lastCardClick < 350) {
          lastCardClick = 0;
          const deg = rotations.get(file) || 0;
          if (deg % 360 === 0) {
            showImagePreview(urlFor(file), file.name);
          } else {
            renderRotated(file, deg, 2000)
              .then((c) =>
                showImagePreview(c.toDataURL('image/png'), file.name)
              )
              .catch(() => showImagePreview(urlFor(file), file.name));
          }
        } else {
          lastCardClick = now;
        }
      });

      const nameEl = document.createElement('p');
      nameEl.className = 'text-xs text-gray-300 truncate w-full text-center';
      nameEl.title = file.name;
      nameEl.textContent = file.name;

      card.append(thumb, nameEl);
      fileDisplayArea.appendChild(card);
    });

    const addTile = document.createElement('div');
    addTile.className =
      'add-tile flex flex-col items-center justify-center gap-1 min-h-[8rem] p-2 border-2 border-dashed border-gray-600 hover:border-indigo-500 rounded-lg bg-gray-800/40 text-gray-400 hover:text-indigo-400 cursor-pointer transition-colors';
    addTile.title = 'Adicionar mais imagens';
    addTile.innerHTML =
      '<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg><span class="text-xs">Adicionar</span>';
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

  async function convert() {
    if (files.length === 0) {
      showAlert('Nenhum arquivo', config.emptyMessage);
      return;
    }
    showLoader(config.loadingMessage || 'Criando PDF...');
    try {
      const prepared: File[] = [];
      for (const f of files) {
        const deg = rotations.get(f) || 0;
        if (enableRotate && deg % 360 !== 0) {
          try {
            const canvas = await renderRotated(f, deg, 0);
            const rotatedBlob = await new Promise<Blob>((res) =>
              canvas.toBlob((b) => res(b as Blob), 'image/png')
            );
            prepared.push(
              new File([rotatedBlob], f.name, { type: 'image/png' })
            );
          } catch {
            prepared.push(f);
          }
        } else {
          prepared.push(f);
        }
      }
      const pdfBlob = await config.convert(prepared);
      downloadFile(pdfBlob, withPdfSuffix(files[0].name, config.suffix));
      showAlert('Sucesso', 'PDF criado com sucesso!', 'success', () => reset());
    } catch (e: unknown) {
      console.error('[ImageToPdf]', e);
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
    config.setup?.();
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
    if (processBtn) processBtn.addEventListener('click', convert);
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
