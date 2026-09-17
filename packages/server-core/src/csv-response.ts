/**
 * Sending a CSV export to a browser.  (P11 — portability)
 *
 * One place, because there will be ten datasets across three services and
 * the parts that must not vary between them are the parts that are easy to
 * get wrong once and copy nine times: the BOM, the cache headers, the
 * filename, and the fact that the tenant never appears in any of them.
 *
 * ── Streaming, honestly ─────────────────────────────────────────────────
 * Rows are written one at a time with `res.write()` rather than joined into
 * one string. On Vercel that is a real stream: the handler holds one row at
 * a time and the browser starts receiving bytes before the query finishes.
 *
 * On Netlify it is NOT. `netlify/adapter.mjs` shims Node's ServerResponse
 * onto a Web Response and its `write()` pushes into an array that is joined
 * at `end()` — so the whole file is resident before the first byte leaves.
 * Same output, same headers, different memory profile, and this comment is
 * here so nobody reads "streaming" in the code and believes it is true on
 * both edges. Fixing it means teaching the adapter ReadableStream, which is
 * a change to every handler's edge and not P11's to make.
 */
import type { ServerResponse } from 'node:http';
import { CSV_BOM, csvLine } from './csv.ts';

export interface CsvDownloadOptions {
  /**
   * The download's filename, WITHOUT a tenant identifier.
   *
   * The school knows which school it is. Putting a uuid in the filename
   * would leak an internal id into a file that gets mailed around, and
   * putting the school's Bangla name there produces a filename that some
   * Windows builds mangle — so this is an ASCII dataset name plus a date,
   * and the school's own identity is in the file's contents.
   */
  filename: string;
  /** Human-readable column headings — Bangla, in the school's own words. */
  headers: string[];
}

/**
 * Write the response head for a CSV download.
 *
 * `no-store` rather than `no-cache`: the second still permits a copy on
 * disk, revalidated. This file is a school's roster.
 */
export function beginCsvDownload(
  res: ServerResponse,
  cors: Record<string, string>,
  o: CsvDownloadOptions,
): void {
  res.writeHead(200, {
    ...cors,
    'Content-Type': 'text/csv; charset=utf-8',
    // `attachment` so the browser saves it instead of rendering a wall of
    // text, and a plain ASCII filename so no edge has to guess an encoding.
    'Content-Disposition': `attachment; filename="${o.filename}"`,
    // Belt and braces with the service worker's network-only rule: a proxy
    // between the school and us must not hold this either.
    'Cache-Control': 'no-store, private, max-age=0',
    'Pragma': 'no-cache',
    // The file is a download, never a document to be framed or sniffed.
    'X-Content-Type-Options': 'nosniff',
  });
  res.write(CSV_BOM);
  res.write(csvLine(o.headers));
}

/** One record. Values are positional and must match `headers`. */
export function writeCsvRow(res: ServerResponse, values: string[]): void {
  res.write(csvLine(values));
}

/**
 * An export's filename: dataset, then the date it was taken.
 *
 * The date matters more than it looks. A school that exports twice in a term
 * ends up with two files in one folder, and `students.csv` overwriting
 * `students.csv` is how the older one silently disappears.
 */
export function csvFilename(dataset: string, on: Date = new Date()): string {
  const d = on.toISOString().slice(0, 10);
  return `${dataset}-${d}.csv`;
}
