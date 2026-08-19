import { PDFDocument as PDFLibDocument } from 'pdf-lib';
import { setupImageToPdfPage } from '../utils/image-to-pdf-ui.js';

function isBmp(file: File): boolean {
  return file.type === 'image/bmp' || file.name.toLowerCase().endsWith('.bmp');
}

async function convertImageToPngBytes(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        const pngBlob = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, 'image/png')
        );
        if (!pngBlob) {
          reject(new Error('Failed to create PNG blob'));
          return;
        }
        const pngBytes = await pngBlob.arrayBuffer();
        resolve(pngBytes);
      };
      img.onerror = () => reject(new Error('Failed to load image.'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

async function buildPdf(files: File[]): Promise<Blob> {
  const pdfDoc = await PDFLibDocument.create();
  for (const file of files) {
    const pngBytes = await convertImageToPngBytes(file);
    const pngImage = await pdfDoc.embedPng(pngBytes);
    const page = pdfDoc.addPage([pngImage.width, pngImage.height]);
    page.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: pngImage.width,
      height: pngImage.height,
    });
  }
  const pdfBytes = await pdfDoc.save();
  return new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
}

setupImageToPdfPage({
  isValid: isBmp,
  invalidMessage:
    'Alguns arquivos foram ignorados. Somente imagens BMP são permitidas.',
  emptyMessage: 'Selecione ao menos um arquivo BMP.',
  suffix: 'convertido',
  optionsSelector: '#process-btn',
  loadingMessage: 'Convertendo BMP em PDF...',
  convert: buildPdf,
});
