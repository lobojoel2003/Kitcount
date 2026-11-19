/** Browser demo: downloads instead of the native share sheet. */

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareCsv(filename: string, csv: string): Promise<void> {
  download(filename, csv, 'text/csv');
}

export async function sharePdf(_filename: string, html: string): Promise<void> {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

export function clearExports(): void {}

export async function readPickedText(uri: string): Promise<string> {
  const res = await fetch(uri);
  return res.text();
}
