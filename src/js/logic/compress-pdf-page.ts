import { showLoader, hideLoader, showAlert } from '../ui.js';
import {
  downloadFile,
  readFileAsArrayBuffer,
  formatBytes,
  getPDFDocument,
} from '../utils/helpers.js';
import { loadPdfWithPasswordPrompt } from '../utils/password-prompt.js';
import { state } from '../state.js';
import { PDFDocument } from 'pdf-lib';
import { createIcons, icons } from 'lucide';
import { showWasmRequiredDialog } from '../utils/wasm-provider.js';
import { loadPyMuPDF, isPyMuPDFAvailable } from '../utils/pymupdf-loader.js';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import Sortable from 'sortablejs';
import { showFilePreview } from '../utils/file-preview.js';
import { renderPageToCanvas } from '../utils/render-utils.js';
import { withPdfSuffix } from '../utils/output-name.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const CONDENSE_PRESETS = {
  light: {
    images: { quality: 90, dpiTarget: 150, dpiThreshold: 200 },
    scrub: { metadata: false, thumbnails: true },
    subsetFonts: true,
  },
  balanced: {
    images: { quality: 75, dpiTarget: 96, dpiThreshold: 150 },
    scrub: { metadata: true, thumbnails: true },
    subsetFonts: true,
  },
  aggressive: {
    images: { quality: 50, dpiTarget: 72, dpiThreshold: 100 },
    scrub: { metadata: true, thumbnails: true, xmlMetadata: true },
    subsetFonts: true,
  },
  extreme: {
    images: { quality: 30, dpiTarget: 60, dpiThreshold: 96 },
    scrub: { metadata: true, thumbnails: true, xmlMetadata: true },
    subsetFonts: true,
  },
};

const PHOTON_PRESETS = {
  light: { scale: 2.0, quality: 0.85 },
  balanced: { scale: 1.5, quality: 0.65 },
  aggressive: { scale: 1.2, quality: 0.45 },
  extreme: { scale: 1.0, quality: 0.25 },
};

async function performCondenseCompression(
  fileBlob: Blob,
  level: string,
  customSettings?: {
    imageQuality?: number;
    dpiTarget?: number;
    dpiThreshold?: number;
    removeMetadata?: boolean;
    subsetFonts?: boolean;
    convertToGrayscale?: boolean;
    removeThumbnails?: boolean;
  }
) {
  // Load PyMuPDF dynamically from user-provided URL
  const pymupdf = await loadPyMuPDF();

  const preset =
    CONDENSE_PRESETS[level as keyof typeof CONDENSE_PRESETS] ||
    CONDENSE_PRESETS.balanced;

  const dpiTarget = customSettings?.dpiTarget ?? preset.images.dpiTarget;
  const userThreshold =
    customSettings?.dpiThreshold ?? preset.images.dpiThreshold;
  const dpiThreshold = Math.max(userThreshold, dpiTarget + 10);

  const options = {
    images: {
      enabled: true,
      quality: customSettings?.imageQuality ?? preset.images.quality,
      dpiTarget,
      dpiThreshold,
      convertToGray: customSettings?.convertToGrayscale ?? false,
    },
    scrub: {
      metadata: customSettings?.removeMetadata ?? preset.scrub.metadata,
      thumbnails: customSettings?.removeThumbnails ?? preset.scrub.thumbnails,
      xmlMetadata:
        'xmlMetadata' in preset.scrub
          ? (preset.scrub as { xmlMetadata: boolean }).xmlMetadata
          : false,
    },
    subsetFonts: customSettings?.subsetFonts ?? preset.subsetFonts,
    save: {
      garbage: 4 as const,
      deflate: true,
      clean: true,
      useObjstms: true,
    },
  };

  try {
    const result = await pymupdf.compressPdf(fileBlob, options);
    return result;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (
      errorMessage.includes('PatternType') ||
      errorMessage.includes('pattern')
    ) {
      console.warn(
        '[CompressPDF] Pattern error detected, retrying without image rewriting:',
        errorMessage
      );

      const fallbackOptions = {
        ...options,
        images: {
          ...options.images,
          enabled: false,
        },
      };

      const result = await pymupdf.compressPdf(fileBlob, fallbackOptions);
      return { ...result, usedFallback: true };
    }

    throw new Error(`PDF compression failed: ${errorMessage}`, {
      cause: error,
    });
  }
}

async function performPhotonCompression(
  arrayBuffer: ArrayBuffer,
  level: string,
  file?: File
) {
  let pdfJsDoc: PDFDocumentProxy;
  if (file) {
    hideLoader();
    const result = await loadPdfWithPasswordPrompt(file);
    if (!result) return null;
    showLoader('Executando compressão Photon...');
    pdfJsDoc = result.pdf;
  } else {
    pdfJsDoc = await getPDFDocument({ data: arrayBuffer }).promise;
  }
  const newPdfDoc = await PDFDocument.create();
  const settings =
    PHOTON_PRESETS[level as keyof typeof PHOTON_PRESETS] ||
    PHOTON_PRESETS.balanced;

  for (let i = 1; i <= pdfJsDoc.numPages; i++) {
    const page = await pdfJsDoc.getPage(i);
    const viewport = page.getViewport({ scale: settings.scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport, canvas: canvas })
      .promise;

    const jpegBlob = await new Promise<Blob>((resolve) =>
      canvas.toBlob(
        (blob) => resolve(blob as Blob),
        'image/jpeg',
        settings.quality
      )
    );
    const jpegBytes = await jpegBlob.arrayBuffer();
    const jpegImage = await newPdfDoc.embedJpg(jpegBytes);
    const newPage = newPdfDoc.addPage([viewport.width, viewport.height]);
    newPage.drawImage(jpegImage, {
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
    });
  }
  return await newPdfDoc.save();
}

// Tenta níveis de compressão progressivos até o arquivo ficar abaixo de
// `targetBytes`. Preserva o texto o quanto possível (tenta Condense antes de
// cair para o Photon, que rasteriza as páginas).
async function compressToTarget(
  file: File,
  targetBytes: number,
  convertToGrayscale: boolean
): Promise<{ blob: Blob; size: number; label: string; fits: boolean } | null> {
  const ladder = [
    { alg: 'condense', level: 'balanced', label: 'Condense · Equilibrado' },
    { alg: 'condense', level: 'aggressive', label: 'Condense · Agressivo' },
    { alg: 'condense', level: 'extreme', label: 'Condense · Extremo' },
    { alg: 'photon', level: 'balanced', label: 'Photon · Equilibrado' },
    { alg: 'photon', level: 'aggressive', label: 'Photon · Agressivo' },
    { alg: 'photon', level: 'extreme', label: 'Photon · Extremo' },
  ];

  let best: { blob: Blob; size: number; label: string } | null = null;
  let cachedAb: ArrayBuffer | null = null;

  for (const step of ladder) {
    showLoader(`Comprimindo até caber — ${step.label}…`);
    try {
      let blob: Blob;
      let size: number;

      if (step.alg === 'condense') {
        const result = await performCondenseCompression(
          file,
          step.level,
          convertToGrayscale ? { convertToGrayscale } : undefined
        );
        blob = result.blob;
        size = result.compressedSize;
      } else {
        if (!cachedAb) {
          cachedAb = (await readFileAsArrayBuffer(file)) as ArrayBuffer;
        }
        const bytes = await performPhotonCompression(
          cachedAb.slice(0),
          step.level
        );
        if (!bytes) continue;
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer;
        blob = new Blob([buffer], { type: 'application/pdf' });
        size = bytes.length;
      }

      if (!best || size < best.size) best = { blob, size, label: step.label };
      if (size <= targetBytes) {
        return { blob, size, label: step.label, fits: true };
      }
    } catch (err) {
      console.warn('[CompressToTarget] falha em', step.label, err);
    }
  }

  return best ? { ...best, fits: false } : null;
}

const compressDocs = new Map<File, PDFDocumentProxy>();
const thumbFileMap = new WeakMap<HTMLElement, File>();
let compressThumbObserver: IntersectionObserver | null = null;

async function getCompressDoc(file: File): Promise<PDFDocumentProxy> {
  let doc = compressDocs.get(file);
  if (!doc) {
    const bytes = await file.arrayBuffer();
    doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    compressDocs.set(file, doc);
  }
  return doc;
}

function pruneCompressDocs(files: File[]): void {
  for (const [file, doc] of compressDocs) {
    if (!files.includes(file)) {
      try {
        doc.destroy();
      } catch {
        /* noop */
      }
      compressDocs.delete(file);
    }
  }
}

function createCompressThumbObserver(): IntersectionObserver {
  if (compressThumbObserver) compressThumbObserver.disconnect();
  compressThumbObserver = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const thumb = entry.target as HTMLElement;
        obs.unobserve(thumb);
        const file = thumbFileMap.get(thumb);
        if (!file) return;
        getCompressDoc(file)
          .then((doc) => renderPageToCanvas(doc, 1, 0.5))
          .then((canvas) => {
            canvas.className = 'w-full h-full object-contain';
            const badge = thumb.querySelector('.thumb-badge');
            thumb.textContent = '';
            thumb.appendChild(canvas);
            if (badge) thumb.appendChild(badge);
          })
          .catch((e) => console.error('Erro ao renderizar miniatura:', e));
      });
    },
    { root: null, rootMargin: '300px', threshold: 0.01 }
  );
  return compressThumbObserver;
}

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const compressOptions = document.getElementById('compress-options');
  const addMoreBtn = document.getElementById('add-more-btn');
  const clearFilesBtn = document.getElementById('clear-files-btn');
  const processBtn = document.getElementById('process-btn');
  const backBtn = document.getElementById('back-to-tools');
  const algorithmSelect = document.getElementById(
    'compression-algorithm'
  ) as HTMLSelectElement;
  const condenseInfo = document.getElementById('condense-info');
  const photonInfo = document.getElementById('photon-info');
  const toggleCustomSettings = document.getElementById(
    'toggle-custom-settings'
  );
  const customSettingsPanel = document.getElementById('custom-settings-panel');
  const customSettingsChevron = document.getElementById(
    'custom-settings-chevron'
  );

  let useCustomSettings = false;

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = import.meta.env.BASE_URL;
    });
  }

  // Toggle algorithm info
  if (algorithmSelect && condenseInfo && photonInfo) {
    algorithmSelect.addEventListener('change', () => {
      if (algorithmSelect.value === 'condense') {
        condenseInfo.classList.remove('hidden');
        photonInfo.classList.add('hidden');
      } else {
        condenseInfo.classList.add('hidden');
        photonInfo.classList.remove('hidden');
      }
    });
  }

  // Toggle custom settings panel
  if (toggleCustomSettings && customSettingsPanel && customSettingsChevron) {
    toggleCustomSettings.addEventListener('click', () => {
      customSettingsPanel.classList.toggle('hidden');
      customSettingsChevron.style.transform =
        customSettingsPanel.classList.contains('hidden')
          ? 'rotate(0deg)'
          : 'rotate(180deg)';
      // Mark that user wants to use custom settings
      if (!customSettingsPanel.classList.contains('hidden')) {
        useCustomSettings = true;
      }
    });
  }

  // Toggle "comprimir até caber" (tamanho-alvo)
  const targetSizeEnabled = document.getElementById(
    'target-size-enabled'
  ) as HTMLInputElement | null;
  const targetSizeRow = document.getElementById('target-size-row');
  if (targetSizeEnabled && targetSizeRow) {
    targetSizeEnabled.addEventListener('change', () => {
      targetSizeRow.classList.toggle('hidden', !targetSizeEnabled.checked);
    });
  }

  let gridSortable: Sortable | null = null;
  const initializeGridSortable = () => {
    const container = document.getElementById('file-display-area');
    if (!container) return;
    if (gridSortable) gridSortable.destroy();
    gridSortable = Sortable.create(container, {
      animation: 150,
      draggable: '.pdf-card',
      filter: '.no-drag',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onStart: (evt: Sortable.SortableEvent) => {
        evt.item.style.opacity = '0.5';
      },
      onEnd: (evt: Sortable.SortableEvent) => {
        evt.item.style.opacity = '1';
        const order = Array.from(container.querySelectorAll('.pdf-card')).map(
          (el) => parseInt((el as HTMLElement).dataset.idx || '0', 10)
        );
        state.files = order.map((i) => state.files[i]);
        updateUI();
      },
    });
  };

  const updateUI = async () => {
    if (!compressOptions) return;
    const fileDisplayArea = document.getElementById('file-display-area');
    const fileControls = document.getElementById('file-controls');
    const instructions = document.getElementById('compress-instructions');
    pruneCompressDocs(state.files as File[]);

    if (state.files.length === 0) {
      compressOptions.classList.add('hidden');
      if (fileControls) fileControls.classList.add('hidden');
      if (instructions) instructions.classList.add('hidden');
      if (dropZone) dropZone.classList.remove('hidden');
      if (fileDisplayArea) fileDisplayArea.innerHTML = '';
      return;
    }

    compressOptions.classList.remove('hidden');
    if (fileControls) fileControls.classList.remove('hidden');
    if (instructions) instructions.classList.remove('hidden');
    if (dropZone) dropZone.classList.add('hidden');
    if (!fileDisplayArea) return;

    fileDisplayArea.innerHTML = '';
    const observer = createCompressThumbObserver();

    (state.files as File[]).forEach((file, index) => {
      const card = document.createElement('div');
      card.className =
        'pdf-card group relative flex flex-col gap-2 p-2 border-2 border-gray-600 hover:border-indigo-500 rounded-lg bg-gray-700 transition-colors cursor-move select-none';
      card.dataset.idx = String(index);

      const deleteBtn = document.createElement('button');
      deleteBtn.className =
        'no-drag absolute top-1 right-1 z-10 bg-gray-900/80 hover:bg-red-600 text-white/80 hover:text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-colors';
      deleteBtn.title = 'Remover';
      deleteBtn.innerHTML =
        '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.files = (state.files as File[]).filter((f) => f !== file);
        updateUI();
      });

      const thumb = document.createElement('div');
      thumb.className =
        'thumb relative rounded-md overflow-hidden bg-gray-800 flex items-center justify-center w-full';
      thumb.style.aspectRatio = '3 / 4';
      thumbFileMap.set(thumb, file);

      const skeleton = document.createElement('span');
      skeleton.className = 'text-gray-500 text-xs animate-pulse';
      skeleton.textContent = 'Carregando…';
      thumb.appendChild(skeleton);

      const badge = document.createElement('span');
      badge.className =
        'thumb-badge absolute bottom-1 left-1 bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded font-semibold shadow';
      badge.textContent = formatBytes(file.size);
      thumb.appendChild(badge);

      card.title = 'Arraste para reordenar · dois cliques para pré-visualizar';
      let lastClick = 0;
      card.addEventListener('click', () => {
        const now = Date.now();
        if (now - lastClick < 350) {
          lastClick = 0;
          getCompressDoc(file)
            .then((doc) => showFilePreview(doc, file.name))
            .catch(() => {});
        } else {
          lastClick = now;
        }
      });

      observer.observe(thumb);

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
    addTile.title = 'Adicionar mais arquivos';
    addTile.innerHTML =
      '<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg><span class="text-xs">Adicionar</span>';
    addTile.addEventListener('click', () => {
      fileInput.value = '';
      fileInput.click();
    });
    fileDisplayArea.appendChild(addTile);

    createIcons({ icons });
    initializeGridSortable();
  };

  const resetState = () => {
    state.files = [];
    state.pdfDoc = null;

    const compressionLevel = document.getElementById(
      'compression-level'
    ) as HTMLSelectElement;
    if (compressionLevel) compressionLevel.value = 'balanced';

    if (algorithmSelect) algorithmSelect.value = 'condense';

    useCustomSettings = false;
    if (customSettingsPanel) customSettingsPanel.classList.add('hidden');
    if (customSettingsChevron)
      customSettingsChevron.style.transform = 'rotate(0deg)';

    const imageQuality = document.getElementById(
      'image-quality'
    ) as HTMLInputElement;
    const dpiTarget = document.getElementById('dpi-target') as HTMLInputElement;
    const dpiThreshold = document.getElementById(
      'dpi-threshold'
    ) as HTMLInputElement;
    const removeMetadata = document.getElementById(
      'remove-metadata'
    ) as HTMLInputElement;
    const subsetFonts = document.getElementById(
      'subset-fonts'
    ) as HTMLInputElement;
    const convertToGrayscale = document.getElementById(
      'convert-to-grayscale'
    ) as HTMLInputElement;
    const removeThumbnails = document.getElementById(
      'remove-thumbnails'
    ) as HTMLInputElement;

    if (imageQuality) imageQuality.value = '75';
    if (dpiTarget) dpiTarget.value = '96';
    if (dpiThreshold) dpiThreshold.value = '150';
    if (removeMetadata) removeMetadata.checked = true;
    if (subsetFonts) subsetFonts.checked = true;
    if (convertToGrayscale) convertToGrayscale.checked = false;
    if (removeThumbnails) removeThumbnails.checked = true;

    if (condenseInfo) condenseInfo.classList.remove('hidden');
    if (photonInfo) photonInfo.classList.add('hidden');

    updateUI();
  };

  const compress = async () => {
    const level = (
      document.getElementById('compression-level') as HTMLSelectElement
    ).value;
    const algorithm = (
      document.getElementById('compression-algorithm') as HTMLSelectElement
    ).value;
    const convertToGrayscale =
      (document.getElementById('convert-to-grayscale') as HTMLInputElement)
        ?.checked ?? false;

    let customSettings:
      | {
          imageQuality?: number;
          dpiTarget?: number;
          dpiThreshold?: number;
          removeMetadata?: boolean;
          subsetFonts?: boolean;
          convertToGrayscale?: boolean;
          removeThumbnails?: boolean;
        }
      | undefined;

    if (useCustomSettings) {
      const imageQuality =
        parseInt(
          (document.getElementById('image-quality') as HTMLInputElement)?.value
        ) || 75;
      const dpiTarget =
        parseInt(
          (document.getElementById('dpi-target') as HTMLInputElement)?.value
        ) || 96;
      const dpiThreshold =
        parseInt(
          (document.getElementById('dpi-threshold') as HTMLInputElement)?.value
        ) || 150;
      const removeMetadata =
        (document.getElementById('remove-metadata') as HTMLInputElement)
          ?.checked ?? true;
      const subsetFonts =
        (document.getElementById('subset-fonts') as HTMLInputElement)
          ?.checked ?? true;
      const removeThumbnails =
        (document.getElementById('remove-thumbnails') as HTMLInputElement)
          ?.checked ?? true;

      customSettings = {
        imageQuality,
        dpiTarget,
        dpiThreshold,
        removeMetadata,
        subsetFonts,
        convertToGrayscale,
        removeThumbnails,
      };
    } else {
      customSettings = convertToGrayscale ? { convertToGrayscale } : undefined;
    }

    try {
      if (state.files.length === 0) {
        showAlert('Nenhum arquivo', 'Selecione pelo menos um arquivo PDF.');
        hideLoader();
        return;
      }

      // Check WASM availability for Condense mode
      const algorithm = (
        document.getElementById('compression-algorithm') as HTMLSelectElement
      ).value;
      if (algorithm === 'condense' && !isPyMuPDFAvailable()) {
        showWasmRequiredDialog('pymupdf');
        return;
      }

      // Modo "comprimir até caber" (tamanho-alvo)
      const targetEnabled =
        (
          document.getElementById(
            'target-size-enabled'
          ) as HTMLInputElement | null
        )?.checked ?? false;

      if (targetEnabled) {
        if (!isPyMuPDFAvailable()) {
          showWasmRequiredDialog('pymupdf');
          return;
        }
        const rawVal =
          parseFloat(
            (document.getElementById('target-size-value') as HTMLInputElement)
              ?.value || '800'
          ) || 800;
        const unit =
          (document.getElementById('target-size-unit') as HTMLSelectElement)
            ?.value || 'KB';
        const targetBytes =
          Math.max(1, rawVal) * (unit === 'MB' ? 1024 * 1024 : 1024);

        if (state.files.length === 1) {
          const file = state.files[0];
          const result = await compressToTarget(
            file,
            targetBytes,
            convertToGrayscale
          );
          hideLoader();
          if (!result) {
            showAlert('Erro', 'Não foi possível comprimir o arquivo.');
            return;
          }
          downloadFile(result.blob, withPdfSuffix(file.name, 'comprimido'));
          if (result.fits) {
            showAlert(
              'Comprimido até caber ✓',
              `Ficou em ${formatBytes(result.size)} (${result.label}), abaixo do limite de ${formatBytes(targetBytes)}.`,
              'success',
              () => resetState()
            );
          } else {
            showAlert(
              'Quase lá',
              `O menor que consegui foi ${formatBytes(result.size)} (${result.label}), ainda acima de ${formatBytes(targetBytes)}. Dica: divida o PDF em partes (ferramenta Dividir PDF) e comprima cada parte.`,
              'warning',
              () => resetState()
            );
          }
          return;
        }

        // Vários arquivos → cada um comprimido até caber, entregues em .zip
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        let notFit = 0;
        for (let i = 0; i < state.files.length; i++) {
          const f = state.files[i];
          showLoader(
            `(${i + 1}/${state.files.length}) Comprimindo até caber: ${f.name}…`
          );
          const r = await compressToTarget(f, targetBytes, convertToGrayscale);
          if (!r) continue;
          zip.file(
            withPdfSuffix(f.name, 'comprimido'),
            await r.blob.arrayBuffer()
          );
          if (!r.fits) notFit++;
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        downloadFile(zipBlob, 'comprimidos.zip');
        hideLoader();
        if (notFit === 0) {
          showAlert(
            'Comprimido até caber ✓',
            `Todos os ${state.files.length} arquivos ficaram abaixo de ${formatBytes(targetBytes)}.`,
            'success',
            () => resetState()
          );
        } else {
          showAlert(
            'Concluído com avisos',
            `${notFit} de ${state.files.length} arquivo(s) não couberam em ${formatBytes(targetBytes)} nem no nível máximo. Considere dividi-los na ferramenta Dividir PDF.`,
            'warning',
            () => resetState()
          );
        }
        return;
      }

      if (state.files.length === 1) {
        const originalFile = state.files[0];

        let resultBlob: Blob;
        let resultSize: number;
        let usedMethod: string;

        if (algorithm === 'condense') {
          showLoader('Executando compressão Condense...');
          const result = await performCondenseCompression(
            originalFile,
            level,
            customSettings
          );
          resultBlob = result.blob;
          resultSize = result.compressedSize;
          usedMethod = 'Condense';

          // Check if fallback was used
          if ((result as { usedFallback?: boolean }).usedFallback) {
            usedMethod +=
              ' (sem otimização de imagem devido a padrões não suportados)';
          }
        } else {
          showLoader('Executando compressão Photon...');
          const arrayBuffer = (await readFileAsArrayBuffer(
            originalFile
          )) as ArrayBuffer;
          const resultBytes = await performPhotonCompression(
            arrayBuffer,
            level,
            originalFile
          );
          if (!resultBytes) return;
          const buffer = resultBytes.buffer.slice(
            resultBytes.byteOffset,
            resultBytes.byteOffset + resultBytes.byteLength
          ) as ArrayBuffer;
          resultBlob = new Blob([buffer], { type: 'application/pdf' });
          resultSize = resultBytes.length;
          usedMethod = 'Photon';
        }

        const originalSize = formatBytes(originalFile.size);
        const compressedSize = formatBytes(resultSize);
        const savings = originalFile.size - resultSize;
        const savingsPercent =
          savings > 0 ? ((savings / originalFile.size) * 100).toFixed(1) : 0;

        downloadFile(
          resultBlob,
          withPdfSuffix(originalFile.name, 'comprimido')
        );

        hideLoader();

        if (savings > 0) {
          showAlert(
            'Compressão concluída',
            `Método: ${usedMethod}. Tamanho do arquivo reduzido de ${originalSize} para ${compressedSize} (Economia de ${savingsPercent}%).`,
            'success',
            () => resetState()
          );
        } else {
          showAlert(
            'Compressão finalizada',
            `Método: ${usedMethod}. Não foi possível reduzir mais o tamanho do arquivo. Original: ${originalSize}, Novo: ${compressedSize}.`,
            'warning',
            () => resetState()
          );
        }
      } else {
        showLoader('Comprimindo vários PDFs...');
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        let totalOriginalSize = 0;
        let totalCompressedSize = 0;

        for (let i = 0; i < state.files.length; i++) {
          const file = state.files[i];
          showLoader(
            `Comprimindo ${i + 1}/${state.files.length}: ${file.name}...`
          );
          totalOriginalSize += file.size;

          let resultBytes: Uint8Array;
          if (algorithm === 'condense') {
            const result = await performCondenseCompression(
              file,
              level,
              customSettings
            );
            resultBytes = new Uint8Array(await result.blob.arrayBuffer());
          } else {
            const arrayBuffer = (await readFileAsArrayBuffer(
              file
            )) as ArrayBuffer;
            const photonResult = await performPhotonCompression(
              arrayBuffer,
              level,
              file
            );
            if (!photonResult) return;
            resultBytes = photonResult;
          }

          totalCompressedSize += resultBytes.length;
          zip.file(withPdfSuffix(file.name, 'comprimido'), resultBytes);
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const totalSavings = totalOriginalSize - totalCompressedSize;
        const totalSavingsPercent =
          totalSavings > 0
            ? ((totalSavings / totalOriginalSize) * 100).toFixed(1)
            : 0;

        downloadFile(zipBlob, 'comprimidos.zip');

        hideLoader();

        if (totalSavings > 0) {
          showAlert(
            'Compressão concluída',
            `${state.files.length} PDF(s) comprimido(s). Tamanho total reduzido de ${formatBytes(totalOriginalSize)} para ${formatBytes(totalCompressedSize)} (Economia de ${totalSavingsPercent}%).`,
            'success',
            () => resetState()
          );
        } else {
          showAlert(
            'Compressão finalizada',
            `${state.files.length} PDF(s) comprimido(s). Tamanho total: ${formatBytes(totalCompressedSize)}.`,
            'info',
            () => resetState()
          );
        }
      }
    } catch (e: unknown) {
      hideLoader();
      console.error('[CompressPDF] Error:', e);
      showAlert(
        'Erro',
        `Ocorreu um erro durante a compressão. Erro: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  const handleFileSelect = (files: FileList | null) => {
    if (files && files.length > 0) {
      state.files = [...state.files, ...Array.from(files)];
      updateUI();
    }
  };

  if (fileInput && dropZone) {
    fileInput.addEventListener('change', (e) => {
      const picked = (e.target as HTMLInputElement).files;
      if (picked && picked.length > 0) {
        // Seletor do Windows devolve a seleção invertida — reverte para
        // respeitar a ordem de clique.
        state.files = [...state.files, ...Array.from(picked).reverse()];
        updateUI();
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

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const pdfFiles = Array.from(files).filter(
          (f) => f.type === 'application/pdf'
        );
        if (pdfFiles.length > 0) {
          const dataTransfer = new DataTransfer();
          pdfFiles.forEach((f) => dataTransfer.items.add(f));
          handleFileSelect(dataTransfer.files);
        }
      }
    });

    fileInput.addEventListener('click', () => {
      fileInput.value = '';
    });
  }

  if (addMoreBtn) {
    addMoreBtn.addEventListener('click', () => {
      fileInput.click();
    });
  }

  if (clearFilesBtn) {
    clearFilesBtn.addEventListener('click', () => {
      resetState();
    });
  }

  if (processBtn) {
    processBtn.addEventListener('click', compress);
  }
});
