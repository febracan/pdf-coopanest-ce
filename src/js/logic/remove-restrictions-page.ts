import { showAlert } from '../ui.js';
import {
  downloadFile,
  formatBytes,
  initializeQpdf,
  readFileAsArrayBuffer,
} from '../utils/helpers.js';
import { icons, createIcons } from 'lucide';
import { RemoveRestrictionsState, QpdfInstanceExtended } from '@/types';

const pageState: RemoveRestrictionsState = {
  file: null,
};

function resetState() {
  pageState.file = null;

  const fileDisplayArea = document.getElementById('file-display-area');
  if (fileDisplayArea) fileDisplayArea.innerHTML = '';

  const toolOptions = document.getElementById('tool-options');
  if (toolOptions) toolOptions.classList.add('hidden');

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  if (fileInput) fileInput.value = '';

  const passwordInput = document.getElementById(
    'owner-password-remove'
  ) as HTMLInputElement;
  if (passwordInput) passwordInput.value = '';
}

async function updateUI() {
  const fileDisplayArea = document.getElementById('file-display-area');
  const toolOptions = document.getElementById('tool-options');

  if (!fileDisplayArea) return;

  fileDisplayArea.innerHTML = '';

  if (pageState.file) {
    const fileDiv = document.createElement('div');
    fileDiv.className =
      'flex items-center justify-between bg-gray-700 p-3 rounded-lg text-sm';

    const infoContainer = document.createElement('div');
    infoContainer.className = 'flex flex-col overflow-hidden';

    const nameSpan = document.createElement('div');
    nameSpan.className = 'truncate font-medium text-gray-200 text-sm mb-1';
    nameSpan.textContent = pageState.file.name;

    const metaSpan = document.createElement('div');
    metaSpan.className = 'text-xs text-gray-400';
    metaSpan.textContent = formatBytes(pageState.file.size);

    infoContainer.append(nameSpan, metaSpan);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'ml-4 text-red-400 hover:text-red-300 flex-shrink-0';
    removeBtn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i>';
    removeBtn.onclick = function () {
      resetState();
    };

    fileDiv.append(infoContainer, removeBtn);
    fileDisplayArea.appendChild(fileDiv);
    createIcons({ icons });

    if (toolOptions) toolOptions.classList.remove('hidden');
  } else {
    if (toolOptions) toolOptions.classList.add('hidden');
  }
}

function handleFileSelect(files: FileList | null) {
  if (files && files.length > 0) {
    const file = files[0];
    if (
      file.type === 'application/pdf' ||
      file.name.toLowerCase().endsWith('.pdf')
    ) {
      pageState.file = file;
      updateUI();
    }
  }
}

async function removeRestrictions() {
  if (!pageState.file) {
    showAlert('Nenhum arquivo', 'Envie um arquivo PDF primeiro.');
    return;
  }

  const password =
    (document.getElementById('owner-password-remove') as HTMLInputElement)
      ?.value || '';

  const inputPath = '/input.pdf';
  const outputPath = '/output.pdf';
  let qpdf: QpdfInstanceExtended;

  const loaderModal = document.getElementById('loader-modal');
  const loaderText = document.getElementById('loader-text');

  try {
    if (loaderModal) loaderModal.classList.remove('hidden');
    if (loaderText) loaderText.textContent = 'Inicializando...';

    qpdf = await initializeQpdf();

    if (loaderText) loaderText.textContent = 'Lendo PDF...';
    const fileBuffer = await readFileAsArrayBuffer(pageState.file);
    const uint8Array = new Uint8Array(fileBuffer as ArrayBuffer);

    qpdf.FS.writeFile(inputPath, uint8Array);

    if (loaderText) loaderText.textContent = 'Removendo restrições...';

    const args = [inputPath];

    if (password) {
      args.push(`--password=${password}`);
    }

    args.push('--decrypt', '--remove-restrictions', '--', outputPath);

    try {
      qpdf.callMain(args);
    } catch (qpdfError: unknown) {
      console.error('qpdf execution error:', qpdfError);
      const qpdfMsg = qpdfError instanceof Error ? qpdfError.message : '';
      if (qpdfMsg.includes('password') || qpdfMsg.includes('encrypt')) {
        throw new Error(
          'Falha ao remover as restrições. O PDF pode exigir a senha de proprietário correta.',
          { cause: qpdfError }
        );
      }

      throw new Error(
        'Falha ao remover as restrições: ' + (qpdfMsg || 'Erro desconhecido'),
        { cause: qpdfError }
      );
    }

    if (loaderText) loaderText.textContent = 'Preparando o download...';
    const outputFile = qpdf.FS.readFile(outputPath, { encoding: 'binary' });

    if (!outputFile || outputFile.length === 0) {
      throw new Error('A operação resultou em um arquivo vazio.');
    }

    const blob = new Blob([new Uint8Array(outputFile)], {
      type: 'application/pdf',
    });
    downloadFile(blob, pageState.file.name);

    if (loaderModal) loaderModal.classList.add('hidden');

    showAlert(
      'Sucesso',
      'Restrições do PDF removidas com sucesso! O arquivo agora pode ser totalmente editado e impresso.',
      'success',
      () => {
        resetState();
      }
    );
  } catch (error: unknown) {
    console.error('Error during restriction removal:', error);
    if (loaderModal) loaderModal.classList.add('hidden');
    showAlert(
      'Falha na operação',
      `Ocorreu um erro: ${error instanceof Error ? error.message : 'O PDF pode estar corrompido ou protegido por senha.'}`
    );
  } finally {
    try {
      if (qpdf?.FS) {
        try {
          qpdf.FS.unlink(inputPath);
        } catch (e) {
          console.warn('Failed to unlink input file:', e);
        }
        try {
          qpdf.FS.unlink(outputPath);
        } catch (e) {
          console.warn('Failed to unlink output file:', e);
        }
      }
    } catch (cleanupError) {
      console.warn('Failed to cleanup WASM FS:', cleanupError);
    }
  }
}

document.addEventListener('DOMContentLoaded', function () {
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById('process-btn');
  const backBtn = document.getElementById('back-to-tools');

  if (backBtn) {
    backBtn.addEventListener('click', function () {
      window.location.href = import.meta.env.BASE_URL;
    });
  }

  if (fileInput && dropZone) {
    fileInput.addEventListener('change', function (e) {
      handleFileSelect((e.target as HTMLInputElement).files);
    });

    dropZone.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropZone.classList.add('bg-gray-700');
    });

    dropZone.addEventListener('dragleave', function (e) {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
    });

    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const pdfFiles = Array.from(files).filter(function (f) {
          return (
            f.type === 'application/pdf' ||
            f.name.toLowerCase().endsWith('.pdf')
          );
        });
        if (pdfFiles.length > 0) {
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(pdfFiles[0]);
          handleFileSelect(dataTransfer.files);
        }
      }
    });

    fileInput.addEventListener('click', function () {
      fileInput.value = '';
    });
  }

  if (processBtn) {
    processBtn.addEventListener('click', removeRestrictions);
  }
});
