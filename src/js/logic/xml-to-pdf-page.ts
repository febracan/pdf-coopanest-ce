import { convertXmlToPdf } from '../utils/xml-to-pdf.js';
import { setupDocToPdfPage } from '../utils/doc-to-pdf-ui.js';

function isXml(file: File): boolean {
  return file.type === 'text/xml' || file.name.toLowerCase().endsWith('.xml');
}

setupDocToPdfPage({
  isValid: isXml,
  invalidMessage:
    'Alguns arquivos foram ignorados. Apenas arquivos .xml são permitidos.',
  emptyMessage: 'Selecione pelo menos um arquivo XML.',
  suffix: 'convertido',
  optionsSelector: '#process-btn',
  icon: 'file-code',
  accent: 'text-amber-400',
  successMessage: 'Arquivo(s) XML convertido(s) para PDF com sucesso.',
  loadingMessage: 'Convertendo XML em PDF...',
  convertOne: (file) => convertXmlToPdf(file),
});
