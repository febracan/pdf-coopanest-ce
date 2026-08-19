import {
  getLibreOfficeConverter,
  type LoadProgress,
} from '../utils/libreoffice-loader.js';
import { setupDocToPdfPage } from '../utils/doc-to-pdf-ui.js';

const converter = getLibreOfficeConverter();

function isPowerpoint(file: File): boolean {
  return /\.(ppt|pptx|odp)$/i.test(file.name);
}

setupDocToPdfPage({
  isValid: isPowerpoint,
  invalidMessage:
    'Alguns arquivos foram ignorados. Apenas apresentações PowerPoint (.ppt, .pptx, .odp) são permitidas.',
  emptyMessage: 'Selecione pelo menos uma apresentação PowerPoint.',
  suffix: 'convertido',
  optionsSelector: '#convert-options',
  icon: 'presentation',
  accent: 'text-orange-400',
  successMessage:
    'Apresentação(ões) PowerPoint convertida(s) para PDF com sucesso.',
  loadingMessage: 'Preparando conversão...',
  prepare: async (onProgress) => {
    await converter.initialize((p: LoadProgress) =>
      onProgress(p.message, p.percent)
    );
  },
  convertOne: (file) => converter.convertToPdf(file),
});
