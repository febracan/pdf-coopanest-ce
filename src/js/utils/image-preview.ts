interface ImagePreviewState {
  modal: HTMLElement | null;
  img: HTMLImageElement | null;
  isOpen: boolean;
}

const ip: ImagePreviewState = { modal: null, img: null, isOpen: false };

function getOrCreateModal(): HTMLElement {
  if (ip.modal) return ip.modal;

  const modal = document.createElement('div');
  modal.id = 'image-preview-modal';
  modal.className =
    'fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex flex-col items-center opacity-0 pointer-events-none transition-opacity duration-200';
  modal.innerHTML = `
    <div class="w-full max-w-3xl flex items-center justify-between px-4 py-3 text-white flex-shrink-0">
      <span id="image-preview-title" class="text-sm font-medium truncate mr-4"></span>
      <button id="image-preview-close" class="text-white/70 hover:text-white transition-colors flex-shrink-0" title="Fechar (Esc)">
        <svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
    <div id="image-preview-scroll" class="overflow-auto w-full max-w-3xl flex-1 px-4 pb-6 flex justify-center">
      <img id="image-preview-img" alt="Pré-visualização" class="max-w-full h-auto object-contain rounded shadow-lg bg-white self-start" />
    </div>
  `;

  modal.addEventListener('click', (e) => {
    if (e.target === modal) hideImagePreview();
  });
  modal
    .querySelector('#image-preview-close')!
    .addEventListener('click', hideImagePreview);

  document.body.appendChild(modal);
  ip.modal = modal;
  ip.img = modal.querySelector('#image-preview-img');
  return modal;
}

export function showImagePreview(url: string, title: string): void {
  const modal = getOrCreateModal();
  ip.isOpen = true;

  const titleEl = modal.querySelector('#image-preview-title') as HTMLElement;
  titleEl.textContent = title;
  titleEl.title = title;

  const scroll = modal.querySelector('#image-preview-scroll') as HTMLElement;
  scroll.scrollTop = 0;

  if (ip.img) ip.img.src = url;

  modal.classList.remove('opacity-0', 'pointer-events-none');
  document.body.style.overflow = 'hidden';
}

export function hideImagePreview(): void {
  if (!ip.modal) return;
  ip.isOpen = false;
  ip.modal.classList.add('opacity-0', 'pointer-events-none');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', (e) => {
  if (ip.isOpen && e.key === 'Escape') hideImagePreview();
});
