import {
  getLibreOfficeConverter,
  type LoadProgress,
} from '../utils/libreoffice-loader.js';
import { setupDocToPdfPage } from '../utils/doc-to-pdf-ui.js';

const converter = getLibreOfficeConverter();

function isWord(file: File): boolean {
  return /\.(doc|docx|odt|rtf)$/i.test(file.name);
}

setupDocToPdfPage({
  isValid: isWord,
  invalidMessage:
    'Alguns arquivos foram ignorados. Apenas documentos Word (.doc, .docx, .odt, .rtf) são permitidos.',
  emptyMessage: 'Selecione pelo menos um documento Word.',
  suffix: 'convertido',
  optionsSelector: '#convert-options',
  icon: 'file-text',
  accent: 'text-blue-400',
  successMessage: 'Documento(s) Word convertido(s) para PDF com sucesso.',
  loadingMessage: 'Preparando conversão...',
  prepare: async (onProgress) => {
    await converter.initialize((p: LoadProgress) =>
      onProgress(p.message, p.percent)
    );
  },
  convertOne: (file) => converter.convertToPdf(file),
});
