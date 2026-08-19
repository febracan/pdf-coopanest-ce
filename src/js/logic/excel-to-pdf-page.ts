import {
  getLibreOfficeConverter,
  type LoadProgress,
} from '../utils/libreoffice-loader.js';
import { setupDocToPdfPage } from '../utils/doc-to-pdf-ui.js';

const converter = getLibreOfficeConverter();

function isExcel(file: File): boolean {
  return /\.(xls|xlsx|ods|csv)$/i.test(file.name);
}

setupDocToPdfPage({
  isValid: isExcel,
  invalidMessage:
    'Alguns arquivos foram ignorados. Apenas planilhas Excel (.xls, .xlsx, .ods, .csv) são permitidas.',
  emptyMessage: 'Selecione pelo menos uma planilha Excel.',
  suffix: 'convertido',
  optionsSelector: '#convert-options',
  icon: 'file-spreadsheet',
  accent: 'text-green-400',
  successMessage: 'Planilha(s) Excel convertida(s) para PDF com sucesso.',
  loadingMessage: 'Preparando conversão...',
  prepare: async (onProgress) => {
    await converter.initialize((p: LoadProgress) =>
      onProgress(p.message, p.percent)
    );
  },
  convertOne: (file) => converter.convertToPdf(file),
});
