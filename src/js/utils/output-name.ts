// Gera o nome do arquivo de saída acrescentando a função executada.
// Ex.: withPdfSuffix('filipe.pdf', 'comprimido') -> 'filipe_comprimido.pdf'
//      withPdfSuffix('foto1.jpg', 'convertido')  -> 'foto1_convertido.pdf'
export function withPdfSuffix(name: string, suffix: string): string {
  const base = (name || 'arquivo').replace(/\.[^./\\]+$/, '');
  const clean = suffix.replace(/^_+/, '').trim();
  return clean ? `${base}_${clean}.pdf` : `${base}.pdf`;
}

// Variante para saídas .zip (múltiplos arquivos gerados de uma vez).
// Ex.: withZipSuffix('filipe.pdf', 'convertido') -> 'filipe_convertido.zip'
export function withZipSuffix(name: string, suffix: string): string {
  const base = (name || 'arquivo').replace(/\.[^./\\]+$/, '');
  const clean = suffix.replace(/^_+/, '').trim();
  return clean ? `${base}_${clean}.zip` : `${base}.zip`;
}

// Nome de saída trocando a extensão por outra (mantém a função no sufixo, se houver).
// Ex.: withExtSuffix('planilha.pdf', 'convertido', 'csv') -> 'planilha_convertido.csv'
export function withExtSuffix(
  name: string,
  suffix: string,
  ext: string
): string {
  const base = (name || 'arquivo').replace(/\.[^./\\]+$/, '');
  const clean = suffix.replace(/^_+/, '').trim();
  const e = ext.replace(/^\.+/, '');
  return clean ? `${base}_${clean}.${e}` : `${base}.${e}`;
}
