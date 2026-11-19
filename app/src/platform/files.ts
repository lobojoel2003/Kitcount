import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

/**
 * Report export. Files are written to a private cache folder, handed to the
 * system share sheet, and the folder is cleared on lock and on panic wipe.
 */

const EXPORT_DIR = 'kitcount-exports';

function exportDir(): Directory {
  const dir = new Directory(Paths.cache, EXPORT_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export async function shareCsv(filename: string, csv: string): Promise<void> {
  const file = new File(exportDir(), filename);
  if (file.exists) file.delete();
  file.create();
  await file.write(csv);
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: filename });
}

export async function sharePdf(filename: string, html: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html });
  const printed = new File(uri);
  const target = new File(exportDir(), filename);
  if (target.exists) target.delete();
  await printed.move(target);
  await Sharing.shareAsync(target.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: filename });
}

export function clearExports(): void {
  try {
    const dir = new Directory(Paths.cache, EXPORT_DIR);
    if (dir.exists) dir.delete();
  } catch {
    // Nothing to clear.
  }
}

/** Reads a user-picked text file (report template import). */
export async function readPickedText(uri: string): Promise<string> {
  return new File(uri).text();
}
