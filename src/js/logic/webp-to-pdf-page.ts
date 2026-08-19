import { PDFDocument as PDFLibDocument } from 'pdf-lib';
import { readFileAsArrayBuffer } from '../utils/helpers.js';
import {
  getSelectedQuality,
  compressImageBytes,
} from '../utils/image-compress.js';
import { setupImageToPdfPage } from '../utils/image-to-pdf-ui.js';

function isWebp(file: File): boolean {
  return (
    file.type === 'image/webp' || file.name.toLowerCase().endsWith('.webp')
  );
}

function sanitizeImageAsJpeg(
  imageBytes: Uint8Array | ArrayBuffer
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([
      imageBytes instanceof Uint8Array
        ? new Uint8Array(imageBytes)
        : imageBytes,
    ]);
    const imageUrl = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(img, 0, 0);

      canvas.toBlob(
        async (jpegBlob) => {
          if (!jpegBlob) {
            return reject(new Error('Falha na conversão canvas toBlob.'));
          }
          const arrayBuffer = await jpegBlob.arrayBuffer();
          resolve(new Uint8Array(arrayBuffer));
        },
        'image/jpeg',
        0.9
      );
      URL.revokeObjectURL(imageUrl);
    };

    img.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      reject(
        new Error(
          'O arquivo fornecido não pôde ser carregado como imagem. Ele pode estar corrompido.'
        )
      );
    };

    img.src = imageUrl;
  });
}

async function buildPdf(files: File[]): Promise<Blob> {
  const pdfDoc = await PDFLibDocument.create();
  const quality = getSelectedQuality();

  for (const file of files) {
    const originalBytes = (await readFileAsArrayBuffer(file)) as ArrayBuffer;
    const compressed = await compressImageBytes(
      new Uint8Array(originalBytes),
      quality
    );
    let embeddedImage;

    if (compressed.type === 'jpeg') {
      embeddedImage = await pdfDoc.embedJpg(compressed.bytes);
    } else {
      try {
        embeddedImage = await pdfDoc.embedPng(compressed.bytes);
      } catch {
        const fallback = await sanitizeImageAsJpeg(originalBytes);
        embeddedImage = await pdfDoc.embedJpg(fallback);
      }
    }

    const page = pdfDoc.addPage([embeddedImage.width, embeddedImage.height]);
    page.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: embeddedImage.width,
      height: embeddedImage.height,
    });
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
}

setupImageToPdfPage({
  isValid: isWebp,
  invalidMessage:
    'Alguns arquivos foram ignorados. Somente imagens WebP são permitidas.',
  emptyMessage: 'Selecione pelo menos um arquivo WebP.',
  suffix: 'convertido',
  optionsSelector: '#jpg-to-pdf-options',
  loadingMessage: 'Criando PDF a partir dos WebP...',
  convert: buildPdf,
});
