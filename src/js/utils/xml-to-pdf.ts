import { jsPDF } from 'jspdf';

export interface XmlToPdfOptions {
  onProgress?: (percent: number, message: string) => void;
}

// Converte XML em PDF renderizando o CÓDIGO-FONTE indentado (uma tag por linha,
// fonte monoespaçada), como um visualizador de fonte. É o que o padrão do
// mercado faz para documentos estruturados (ex.: guias TISS da saúde): o time
// precisa LER e DESTACAR valores no PDF, não uma tabela "interpretada".
// Robusto para qualquer XML (nunca vira lixo) e respeita o encoding declarado
// (muitos XML de saúde são ISO-8859-1, não UTF-8).
export async function convertXmlToPdf(
  file: File,
  options?: XmlToPdfOptions
): Promise<Blob> {
  const { onProgress } = options || {};

  onProgress?.(10, 'Lendo o arquivo XML...');
  const buffer = await file.arrayBuffer();
  const text = decodeXml(buffer);

  onProgress?.(35, 'Formatando o conteúdo...');
  const lines = xmlToLines(text);

  onProgress?.(55, 'Gerando o PDF...');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const margin = 12;
  const topText = margin + 6; // abaixo do cabeçalho
  const bottom = pageH - 8;
  const usableW = pageW - margin * 2;
  const fontSize = 8;
  const lineH = fontSize * 0.3528 * 1.2; // pt -> mm com leading

  const drawHeader = () => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(file.name, margin, margin - 2, { baseline: 'bottom' });
    doc.setDrawColor(220);
    doc.line(margin, margin, pageW - margin, margin);
    doc.setTextColor(0);
    doc.setFont('courier', 'normal');
    doc.setFontSize(fontSize);
  };
  const drawFooter = (n: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Página ${n}`, pageW - margin, pageH - 4, { align: 'right' });
    doc.setTextColor(0);
  };

  // A indentação é aplicada como DESLOCAMENTO EM X (o splitTextToSize do jsPDF
  // remove espaços à esquerda), preservando a hierarquia visual. As quebras de
  // linhas longas mantêm o mesmo recuo do conteúdo.
  doc.setFont('courier', 'normal');
  doc.setFontSize(fontSize);
  const charW = doc.getTextWidth('0'); // mm por caractere (courier = monoespaçado)

  let pageNum = 1;
  let y = topText;
  drawHeader();

  for (const raw of lines) {
    const expanded = raw.replace(/\t/g, '  ');
    const indentLen = expanded.match(/^ */)?.[0].length ?? 0;
    const content = expanded.slice(indentLen);
    const x = margin + indentLen * charW;
    const avail = Math.max(charW * 8, usableW - indentLen * charW);
    const parts =
      content === '' ? [''] : (doc.splitTextToSize(content, avail) as string[]);
    for (const part of parts) {
      if (y > bottom) {
        drawFooter(pageNum);
        doc.addPage();
        pageNum++;
        y = topText;
        drawHeader();
      }
      if (part !== '') doc.text(part, x, y, { baseline: 'top' });
      y += lineH;
    }
  }
  drawFooter(pageNum);

  onProgress?.(95, 'Finalizando...');
  const pdfBlob = doc.output('blob');
  onProgress?.(100, 'Concluído!');
  return pdfBlob;
}

// Decodifica os bytes respeitando o encoding declarado no cabeçalho XML.
function decodeXml(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // BOM UTF-8
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes);
  }
  // Lê a declaração <?xml ... encoding="..."?> em ASCII (primeiros bytes).
  const head = new TextDecoder('ascii').decode(bytes.subarray(0, 256));
  const m = head.match(/encoding\s*=\s*["']([^"']+)["']/i);
  let charset = (m ? m[1] : 'utf-8').toLowerCase().trim();
  if (charset === 'latin1' || charset === 'latin-1') charset = 'iso-8859-1';
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    // Encoding desconhecido -> tenta UTF-8 e, por fim, ISO-8859-1.
    try {
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return new TextDecoder('iso-8859-1').decode(bytes);
    }
  }
}

// Se o XML já vier indentado (uma tag por linha), preserva o original (fiel ao
// que o usuário vê). Se vier "minificado", re-indenta para ficar legível.
function xmlToLines(text: string): string[] {
  const norm = text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '');
  const newlineCount = (norm.match(/\n/g) || []).length;
  const longest = norm.split('\n').reduce((mx, l) => Math.max(mx, l.length), 0);
  if (newlineCount >= 5 && longest < 2000) {
    return norm.split('\n');
  }
  return prettyPrintXml(norm).split('\n');
}

// Re-indenta XML "minificado" a partir do texto (sem parse -> preserva todo o
// conteúdo/atributos/valores; só normaliza a quebra e a indentação entre tags).
function prettyPrintXml(xml: string): string {
  const normalized = xml
    .replace(/\r\n?/g, '\n')
    .replace(/>\s*</g, '><') // remove espaço entre tags
    .replace(/></g, '>\n<'); // uma tag por linha
  const lines = normalized.split('\n');
  const pad = '  ';
  let indent = 0;
  const out: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const isClose = /^<\//.test(line);
    const isDeclOrComment = /^<[?!]/.test(line);
    const isSelfClose = /\/>\s*$/.test(line);
    const isInlineClose = /^<[^!?/][^>]*>.*<\/[^>]+>\s*$/.test(line); // <t>val</t>
    if (isClose) indent = Math.max(0, indent - 1);
    out.push(pad.repeat(indent) + line);
    const isOpen = /^<[^!?/]/.test(line);
    if (
      isOpen &&
      !isClose &&
      !isDeclOrComment &&
      !isSelfClose &&
      !isInlineClose
    ) {
      indent++;
    }
  }
  return out.join('\n');
}
