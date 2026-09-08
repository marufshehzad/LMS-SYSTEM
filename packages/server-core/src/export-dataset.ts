/**
 * One export flow, declared once.  (P11)
 *
 * P11 needs ten datasets across three services. The parts that must not vary
 * between them are exactly the parts that are easy to get right once and
 * wrong on the ninth copy: where the tenant comes from, who is allowed, the
 * order in which the response head is written, and the audit entry.
 *
 * So a dataset is a DECLARATION — headings, a query, and a row mapper — and
 * everything around it happens here. A new exporter cannot forget to write
 * the audit row or accidentally read a tenant from the query string, because
 * it is not given the opportunity to do either.
 *
 * The rule the whole file exists to hold: **the tenant is `claims.tid` and
 * nothing else.** Not a query parameter, not a body field, not a header, not
 * a filename. Every query below runs inside `withTenant`, so it carries no
 * tenant predicate at all and RLS decides the rows — which means a handler
 * that forgets a `WHERE` clause still returns only the caller's school.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sharedDb } from './db.ts';
import { corsHeaders, query, json, HttpError } from './http.ts';
import { authenticate, requireRole } from './auth.ts';
import { writeAudit } from './audit.ts';
import { beginCsvDownload, writeCsvRow, csvFilename } from './csv-response.ts';

/** A queryable connection, as `withTenant` hands one over. */
export interface ExportClient {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface ExportDataset<R = Record<string, unknown>> {
  /** Human-readable column headings, in the school's own language. */
  headers: string[];
  /**
   * The rows. No tenant predicate — see the file header.
   *
   * A function rather than a string so a dataset can take a parameter it
   * derives from the caller's own claims, never from their input.
   */
  select(client: ExportClient): Promise<R[]>;
  /** One record, positional, matching `headers`. */
  row(r: R): string[];
}

export interface CsvExportOptions {
  /** Roles permitted to take this service's data out as a file. */
  roles: string[];
  /** Dataset key → definition. The key is what `?dataset=` must match. */
  datasets: Record<string, ExportDataset<never>>;
}

/**
 * `null`/`undefined` become an empty cell, never the string "null".
 *
 * Exported because every dataset's row mapper needs it and nine private
 * copies would eventually disagree about what an absent value looks like.
 */
export const cell = (v: string | number | boolean | null | undefined): string =>
  v === null || v === undefined ? '' : String(v);

/**
 * Run one dataset export, end to end.
 *
 * Ordering matters and is the reason §27 holds without a check: the response
 * head is written only AFTER the query has succeeded. A failure before that
 * point is a JSON error the browser can show; there is no path that produces
 * a successful empty file from a query that failed.
 */
export async function handleCsvExport(
  req: IncomingMessage,
  res: ServerResponse,
  o: CsvExportOptions,
): Promise<void> {
  const cors = corsHeaders();
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  if (req.method !== 'GET') { json(res, 405, { error: 'method_not_allowed' }, cors); return; }

  try {
    const claims = await authenticate(req);
    requireRole(claims, o.roles);

    const key = (query(req).get('dataset') ?? '').trim();
    const def = Object.prototype.hasOwnProperty.call(o.datasets, key)
      ? o.datasets[key] as ExportDataset
      : undefined;
    if (!def) {
      throw new HttpError(400,
        `dataset must be one of: ${Object.keys(o.datasets).join(', ')}`,
        'unknown_dataset');
    }

    const db = await sharedDb();
    const actor = { tenantId: claims.tid, userId: claims.sub, role: claims.role };

    await db.withTenant(actor, async (client) => {
      const rows = await def.select(client as ExportClient);

      beginCsvDownload(res, cors, {
        filename: csvFilename(key),
        headers: def.headers,
      });
      for (const r of rows) writeCsvRow(res, def.row(r));

      // The count, never the contents. What the audit has to answer later is
      // "who took how much, and when" — duplicating the rows into a second
      // table is the one thing it must not do.
      await writeAudit(client, actor, {
        action: 'ops.data.export',
        entityType: 'export',
        after: { dataset: key, rows: rows.length },
      });
    });

    res.end();
  } catch (err) {
    // Once the head is out the status is fixed, and appending a JSON body to
    // a CSV would hand the school a corrupt file that still parses as far as
    // the error. Ending the response is the only honest move left, and the
    // truncation is what they see.
    if (res.headersSent) { res.end(); return; }
    if (err instanceof HttpError) {
      json(res, err.status, { error: err.code, message: err.message }, cors);
      return;
    }
    json(res, 500, { error: 'internal_error' }, cors);
  }
}
