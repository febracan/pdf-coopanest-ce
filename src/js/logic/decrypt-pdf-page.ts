import { showAlert } from '../ui.js';
import {
  downloadFile,
  formatBytes,
  readFileAsArrayBuffer,
} from '../utils/helpers.js';
import { decryptPdfBytes } from '../utils/pdf-decrypt.js';
import { icons, createIcons } from 'lucide';
import JSZip from 'jszip';
import { DecryptPdfState } from '@/types';

const pageState: DecryptPdfState = {
  files: [],
};

function resetState() {
  pageState.files = [];

  const fileDisplayArea = document.getElementById('file-display-area');
  if (fileDisplayArea) fileDisplayArea.innerHTML = '';

  const toolOptions = document.getElementById('tool-options');
  if (toolOptions) toolOptions.classList.add('hidden');

  const fileControls = document.getElementById('file-controls');
  if (fileControls) fileControls.classList.add('hidden');

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  if (fileInput) fileInput.value = '';

  const passwordInput = document.getElementById(
    'password-input'
  ) as HTMLInputElement;
  if (passwordInput) passwordInput.value = '';
}

async function updateUI() {
  const fileDisplayArea = document.getElementById('file-display-area');
  const toolOptions = document.getElementById('tool-options');
  const fileControls = document.getElementById('file-controls');

  if (!fileDisplayArea) return;

  fileDisplayArea.innerHTML = '';

  if (pageState.files.length > 0) {
    pageState.files.forEach((file, index) => {
      const fileDiv = document.createElement('div');
      fileDiv.className =
        'flex items-center justify-between bg-gray-700 p-3 rounded-lg text-sm';

      const infoContainer = document.createElement('div');
      infoContainer.className = 'flex flex-col overflow-hidden';

      const nameSpan = document.createElement('div');
      nameSpan.className = 'truncate font-medium text-gray-200 text-sm mb-1';
      nameSpan.textContent = file.name;

      const metaSpan = document.createElement('div');
      metaSpan.className = 'text-xs text-gray-400';
      metaSpan.textContent = formatBytes(file.size);

      infoContainer.append(nameSpan, metaSpan);

      const removeBtn = document.createElement('button');
      removeBtn.className =
        'ml-4 text-red-400 hover:text-red-300 flex-shrink-0';
      removeBtn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i>';
      removeBtn.onclick = function () {
        pageState.files.splice(index, 1);
        updateUI();
      };

      fileDiv.append(infoContainer, removeBtn);
      fileDisplayArea.appendChild(fileDiv);
    });

    createIcons({ icons });

    if (toolOptions) toolOptions.classList.remove('hidden');
    if (fileControls) fileControls.classList.remove('hidden');
  } else {
    if (toolOptions) toolOptions.classList.add('hidden');
    if (fileControls) fileControls.classList.add('hidden');
  }
}

function handleFileSelect(files: FileList | null) {
  if (files && files.length > 0) {
    const pdfFiles = Array.from(files).filter(
      (f) =>
        f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    if (pdfFiles.length > 0) {
      pageState.files.push(...pdfFiles);
      updateUI();
    }
  }
}

async function decryptPdf() {
  if (pageState.files.length === 0) {
    showAlert('Nenhum arquivo', 'Envie pelo menos um arquivo PDF.');
    return;
  }

  const password = (
    document.getElementById('password-input') as HTMLInputElement
  )?.value;

  if (!password) {
    showAlert('Entrada obrigatória', 'Digite a senha do PDF.');
    return;
  }

  const loaderModal = document.getElementById('loader-modal');
  const loaderText = document.getElementById('loader-text');

  try {
    if (loaderModal) loaderModal.classList.remove('hidden');
    if (loaderText) loaderText.textContent = 'Inicializando descriptografia...';

    if (pageState.files.length === 1) {
      // Single file: decrypt and download directly
      const file = pageState.files[0];
      if (loaderText) loaderText.textContent = 'Lendo PDF criptografado...';
      const fileBuffer = await readFileAsArrayBuffer(file);
      const uint8Array = new Uint8Array(fileBuffer as ArrayBuffer);

      if (loaderText) loaderText.textContent = 'Descriptografando PDF...';
      const { bytes: decryptedBytes } = await decryptPdfBytes(
        uint8Array,
        password
      );

      if (loaderText) loaderText.textContent = 'Preparando download...';
      const blob = new Blob([decryptedBytes.slice().buffer], {
        type: 'application/pdf',
      });
      downloadFile(blob, file.name);

      if (loaderModal) loaderModal.classList.add('hidden');
      showAlert(
        'Sucesso',
        'PDF descriptografado com sucesso! O download foi iniciado.',
        'success',
        () => {
          resetState();
        }
      );
    } else {
      // Multiple files: decrypt all and download as ZIP
      const zip = new JSZip();
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < pageState.files.length; i++) {
        const file = pageState.files[i];

        if (loaderText)
          loaderText.textContent = `Descriptografando ${file.name} (${i + 1}/${pageState.files.length})...`;

        try {
          const fileBuffer = await readFileAsArrayBuffer(file);
          const uint8Array = new Uint8Array(fileBuffer as ArrayBuffer);
          const { bytes: decryptedBytes } = await decryptPdfBytes(
            uint8Array,
            password
          );

          zip.file(file.name, decryptedBytes, { binary: true });
          successCount++;
        } catch (fileError: unknown) {
          errorCount++;
          console.error(`Failed to decrypt ${file.name}:`, fileError);
        }
      }

      if (successCount === 0) {
        throw new Error(
          'Nenhum arquivo PDF pôde ser descriptografado. A senha pode estar incorreta.'
        );
      }

      if (loaderText) loaderText.textContent = 'Gerando arquivo ZIP...';
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadFile(zipBlob, 'decrypted-pdfs.zip');

      let alertMessage = `${successCount} PDF(s) descriptografado(s) com sucesso.`;
      if (errorCount > 0) {
        alertMessage += ` ${errorCount} arquivo(s) falhou(falharam).`;
      }
      showAlert('Processamento concluído', alertMessage, 'success', () => {
        resetState();
      });
    }
  } catch (error: unknown) {
    console.error('Error during PDF decryption:', error);

    const errorMessage = error instanceof Error ? error.message : '';
    if (errorMessage === 'INVALID_PASSWORD') {
      showAlert(
        'Senha incorreta',
        'A senha digitada está incorreta. Tente novamente.'
      );
    } else if (errorMessage.includes('password')) {
      showAlert(
        'Erro de senha',
        'Não foi possível descriptografar o PDF com a senha fornecida.'
      );
    } else {
      showAlert(
        'Falha na descriptografia',
        `Ocorreu um erro: ${errorMessage || 'A senha digitada está errada ou o arquivo está corrompido.'}`
      );
    }
  } finally {
    if (loaderModal) loaderModal.classList.add('hidden');
  }
}

document.addEventListener('DOMContentLoaded', function () {
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById('process-btn');
  const addMoreBtn = document.getElementById('add-more-btn');
  const clearFilesBtn = document.getElementById('clear-files-btn');
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
      handleFileSelect(e.dataTransfer?.files);
    });

    fileInput.addEventListener('click', function () {
      fileInput.value = '';
    });
  }

  if (processBtn) {
    processBtn.addEventListener('click', decryptPdf);
  }

  if (addMoreBtn) {
    addMoreBtn.addEventListener('click', function () {
      fileInput.value = '';
      fileInput.click();
    });
  }

  if (clearFilesBtn) {
    clearFilesBtn.addEventListener('click', function () {
      resetState();
    });
  }
});
