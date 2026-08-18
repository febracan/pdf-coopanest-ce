import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPageToCanvas } from './render-utils.js';

interface FilePreviewState {
  modal: HTMLElement | null;
  scroll: HTMLElement | null;
  observer: IntersectionObserver | null;
  isOpen: boolean;
  doc: PDFDocumentProxy | null;
}

const fp: FilePreviewState = {
  modal: null,
  scroll: null,
  observer: null,
  isOpen: false,
  doc: null,
};

function getOrCreateModal(): HTMLElement {
  if (fp.modal) return fp.modal;

  const modal = document.createElement('div');
  modal.id = 'file-preview-modal';
  modal.className =
    'fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex flex-col items-center opacity-0 pointer-events-none transition-opacity duration-200';
  modal.innerHTML = `
    <div class="w-full max-w-3xl flex items-center justify-between px-4 py-3 text-white flex-shrink-0">
      <span id="file-preview-title" class="text-sm font-medium truncate mr-4"></span>
      <button id="file-preview-close" class="text-white/70 hover:text-white transition-colors flex-shrink-0" title="Fechar (Esc)">
        <svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
    <div id="file-preview-scroll" class="overflow-auto w-full max-w-3xl flex-1 px-4 pb-6 flex flex-col items-center gap-4"></div>
  `;

  modal.addEventListener('click', (e) => {
    if (e.target === modal) hideFilePreview();
  });
  modal
    .querySelector('#file-preview-close')!
    .addEventListener('click', hideFilePreview);

  document.body.appendChild(modal);
  fp.modal = modal;
  fp.scroll = modal.querySelector('#file-preview-scroll');
  return modal;
}

function setupObserver(): IntersectionObserver {
  if (fp.observer) fp.observer.disconnect();

  fp.observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const placeholder = entry.target as HTMLElement;
        obs.unobserve(placeholder);

        const pageNumber = parseInt(placeholder.dataset.page || '0', 10);
        if (!fp.doc || !pageNumber) return;

        renderModalPage(fp.doc, pageNumber, placeholder).catch((err) =>
          console.error(`Erro ao renderizar a página ${pageNumber}:`, err)
        );
      });
    },
    { root: fp.scroll, rootMargin: '600px', threshold: 0.01 }
  );
  return fp.observer;
}

async function renderModalPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  placeholder: HTMLElement
): Promise<void> {
  const targetWidth = Math.min(820, (fp.scroll?.clientWidth || 800) - 8);
  const page = await doc.getPage(pageNumber);
  const baseWidth = page.getViewport({ scale: 1 }).width;
  const scale = Math.min(2, Math.max(0.5, targetWidth / baseWidth));

  const canvas = await renderPageToCanvas(doc, pageNumber, scale);
  canvas.className = 'shadow-lg rounded max-w-full h-auto bg-white';

  // Only swap in if the modal is still showing this document.
  if (fp.doc !== doc || !placeholder.isConnected) return;
  placeholder.textContent = '';
  placeholder.style.minHeight = '';
  placeholder.appendChild(canvas);
}

export function showFilePreview(doc: PDFDocumentProxy, title: string): void {
  const modal = getOrCreateModal();
  fp.doc = doc;
  fp.isOpen = true;

  const titleEl = modal.querySelector('#file-preview-title') as HTMLElement;
  titleEl.textContent = title;
  titleEl.title = title;

  const scroll = fp.scroll!;
  scroll.textContent = '';
  scroll.scrollTop = 0;

  const observer = setupObserver();

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const placeholder = document.createElement('div');
    placeholder.dataset.page = pageNumber.toString();
    placeholder.className =
      'w-full flex items-center justify-center bg-gray-800/40 rounded';
    placeholder.style.minHeight = '420px';

    const label = document.createElement('span');
    label.className = 'text-gray-500 text-xs animate-pulse';
    label.textContent = `Página ${pageNumber}…`;
    placeholder.appendChild(label);

    scroll.appendChild(placeholder);
    observer.observe(placeholder);
  }

  modal.classList.remove('opacity-0', 'pointer-events-none');
  document.body.style.overflow = 'hidden';
}

export function hideFilePreview(): void {
  if (!fp.modal) return;
  fp.isOpen = false;
  fp.doc = null;
  fp.modal.classList.add('opacity-0', 'pointer-events-none');
  document.body.style.overflow = '';
  if (fp.observer) {
    fp.observer.disconnect();
    fp.observer = null;
  }
}

document.addEventListener('keydown', (e) => {
  if (fp.isOpen && e.key === 'Escape') hideFilePreview();
});
