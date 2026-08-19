import { loadPyMuPDF } from '../utils/pymupdf-loader.js';
import type { PyMuPDFInstance } from '@/types';
import {
  getSelectedQuality,
  compressImageFile,
} from '../utils/image-compress.js';
import {
  IMAGE_ACCEPT,
  IMAGE_FORMATS_LABEL,
  isValidImageFile,
  preprocessImageFile,
} from '../utils/image-input-utils.js';
import { setupImageToPdfPage } from '../utils/image-to-pdf-ui.js';

let pymupdf: PyMuPDFInstance | null = null;

async function ensurePyMuPDF(): Promise<PyMuPDFInstance> {
  if (!pymupdf) {
    pymupdf = (await loadPyMuPDF()) as PyMuPDFInstance;
  }
  return pymupdf;
}

async function buildPdf(files: File[]): Promise<Blob> {
  const quality = getSelectedQuality();
  const processedFiles: File[] = [];
  for (const file of files) {
    const processed = await preprocessImageFile(file);
    processedFiles.push(await compressImageFile(processed, quality));
  }
  const mupdf = await ensurePyMuPDF();
  return await mupdf.imagesToPdf(processedFiles);
}

setupImageToPdfPage({
  isValid: isValidImageFile,
  invalidMessage:
    'Alguns arquivos foram ignorados. Apenas formatos de imagem suportados são permitidos.',
  emptyMessage: 'Selecione pelo menos um arquivo de imagem.',
  suffix: 'convertido',
  optionsSelector: '#jpg-to-pdf-options',
  loadingMessage: 'Processando imagens...',
  convert: buildPdf,
  setup: () => {
    const fi = document.getElementById('file-input') as HTMLInputElement | null;
    if (fi) fi.accept = IMAGE_ACCEPT;
    const fd = document.getElementById('supported-formats');
    if (fd) fd.textContent = IMAGE_FORMATS_LABEL;
  },
});
