#!/usr/bin/env node
/**
 * Run every workspace's suite, and fail loudly if a workspace has tests that
 * nothing runs.
 *
 * This script exists because that failure kept happening silently. Test
 * scripts here enumerated their files by hand, so a new `test/*.test.ts` was
 * simply never executed — that is how the §10.3 screen shipped untested, and
 * how 13 server test files across four services sat un-run because those
 * services had no package.json at all. Every one of them passed the moment
 * they were wired up, which is the point: they were not failing, they were
 * invisible, and invisible is worse.
 *
 *   node scripts/test-all.mjs
 *   DATABASE_URL=postgres://… node scripts/test-all.mjs   # includes DB suites
 *
 * Without DATABASE_URL the DB-backed suites skip themselves and say so.
 *
 * ── Connect as the runtime role, not the owner ───────────────────────────
 * RLS is the security boundary in this system, and PostgreSQL exempts
 * superusers from it — FORCE ROW LEVEL SECURITY does not change that. Run
 * these as a superuser and the tenant-isolation tests fail with "tenant B's
 * session cannot reach tenant A's section", which reads as a catastrophic
 * product bug and is in fact a wrong connection string. The preflight below
 * refuses to run rather than let anyone spend an afternoon on that.
 */
import { readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname: this repo's path contains spaces, and
// pathname returns them percent-encoded, so every workspace lookup missed.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GROUPS = ['packages', 'services', 'apps'];
// netlify/ is a workspace too — it holds the edge adapter every endpoint
// on that host sits behind, and its tests must not be invisible either.
const EXTRA = ['netlify'];

/**
 * B-66. Refuse a Node build that cannot run this suite honestly.
 *
 * A TCP socket opened inside a `node --test` PER-FILE CHILD PROCESS
 * intermittently aborts that child on Node 24 before 24.21.0, on Windows.
 * The child dies with Windows status 0xC0000409 (an abort()) having written
 * nothing at all, so the runner reports the whole file as
 *
 *   test at test/<file>.test.ts:1:1
 *   'test failed'
 *
 * with no assertion named and an EMPTY stderr. That is not a test failure,
 * and no amount of reading the file will explain it. It cost this project
 * B-58, B-66 and three separate audit observations.
 *
 * Measured on this repository, same machine, same session, one variable:
 *
 *   node v24.15.0 -> 11 crashes / 500 runs (5,500 child processes)
 *   node v24.21.0 ->  0 crashes / 500 runs (5,500 child processes)
 *
 * It needs a TCP socket (a UDP socket does not do it: 0/300) and it needs the
 * per-file child (`--test-isolation=none`: 0/300; the identical socket work
 * as a plain `node file.mjs`: 0/3,300). It is NOT concurrency: it still
 * happens at `--test-concurrency=1`, and the per-child rate is flat at
 * 0.18-0.27% however wide the fan-out. Capping concurrency would have looked
 * like a fix and fixed nothing.
 *
 * Only the DB-backed suites open TCP sockets, which is why only they were
 * ever hit, and CI has never seen it because every workflow pins Node 22.
 *
 * -- Why this is a floor, not an `engines` bump ---------------------------
 * `engines` stays at >=22 deliberately. Node 22 is what CI runs and it is
 * unaffected; a global >=24.21.0 would invalidate a green CI to fix a
 * Windows-only defect that CI does not have. So the floor applies to the
 * Node 24 line only, where the defect was actually proven.
 */
const NODE_B66_FIRST_GOOD = [24, 21, 0];

/** True only on a Node build measured to carry the B-66 defect. */
function nodeHasB66Defect() {
  const [maj, min, pat] = process.versions.node.split('.').map(Number);
  // Node 22 (CI's version) and Node 25+ are outside the proven-bad line.
  if (maj !== 24) return false;
  const [, goodMin, goodPat] = NODE_B66_FIRST_GOOD;
  return !(min > goodMin || (min === goodMin && pat >= goodPat));
}

function checkNodeForB66() {
  if (!nodeHasB66Defect()) return;

  const msg =
    `Node v${process.versions.node} carries the B-66 defect.\n\n`
    + 'On this Node 24 build a TCP socket opened inside a `node --test` child\n'
    + 'process intermittently aborts that child (Windows 0xC0000409) with no\n'
    + 'output at all. The suite then reports a whole test file as failing at\n'
    + "line 1:1 with 'test failed', no assertion and empty stderr - a failure\n"
    + 'that cannot be diagnosed and does not reproduce. Every DB-backed suite\n'
    + 'is exposed, because those are the ones that open sockets.\n\n'
    + `Fix: install Node >= ${NODE_B66_FIRST_GOOD.join('.')} (24.21.0 measured clean over 5,500\n`
    + 'child processes; 24.15.0 crashed 11 times over the same sample).\n\n'
    + 'See docs/BACKLOG.md B-66 and docs/PHASE_LOG.md for the full evidence.\n';

  if (process.platform === 'win32') {
    // Proven here. A run on this build cannot be trusted, so do not start one.
    console.error(`\nERROR: ${msg}`);
    process.exit(1);
  }
  // Never measured off Windows. Say so, and let the run proceed rather than
  // block a platform on evidence that was never gathered for it.
  console.error(`\nWARNING: ${msg}Proven on Windows; on ${process.platform} it is `
    + 'untested, so this is a warning rather than a refusal.\n');
}

checkNodeForB66();

// Preflight. packages/server-core's assertRlsEnforced already refuses to
// start the app on a privileged role, but the DB suites call createDb
// directly and never reach it — which is why a superuser connection surfaces
// as a failing tenant-isolation test instead of a clear message. Catch it
// here, before anything runs.
if (process.env.DATABASE_URL) {
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await c.connect();
    const { rows } = await c.query(
      'SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    const me = rows[0];
    if (me?.rolsuper || me?.rolbypassrls) {
      console.error(
        `\nERROR: DATABASE_URL connects as "${me.rolname}", which has ` +
        `${me.rolsuper ? 'SUPERUSER' : 'BYPASSRLS'}.\n` +
        'PostgreSQL exempts such roles from row-level security, so the\n' +
        'tenant-isolation tests would fail and look like a product bug.\n' +
        'Connect as the runtime role (see docs/06-DEPLOYMENT.md §3).');
      process.exit(1);
    }
  } finally { await c.end().catch(() => {}); }
}

// ── Two Windows faults this script was itself blind to ──────────────────
//
// 1. `npm` is npm.cmd there, and execFileSync does not use a shell, so
//    spawning "npm" fails with ENOENT (and Node ≥20 refuses .cmd without a
//    shell outright, EINVAL). Every workspace reported FAIL with no output:
//    eleven identical failures and not one error message, which reads as
//    "the repo is broken" rather than "the runner cannot find npm".
//
// 2. Worse, and quieter. The workspace scripts said
//    `node --test 'test/*.test.ts'`. A POSIX shell strips those quotes; cmd
//    passes them through literally, no file matches, and node exits 0 having
//    run nothing. On Windows the entire suite reported success while running
//    zero tests — precisely the invisible-tests failure this file exists to
//    prevent, in this file's own tooling. They are now double-quoted, which
//    both shells strip and node globs for itself.
//
// The second fault hid for so long because "ok" and "ok" look the same: a
// workspace that ran 153 tests and one that ran none both printed a tick.
// The reporting below now says "0 tests — NOTHING RAN" instead, which is
// legitimate for the DB-backed suites when DATABASE_URL is unset and is a
// bug in every other case. It is not a hard error precisely because of that
// first case; it is simply impossible to mistake for a pass.
const npmTest = (cwd) =>
  execSync('npm test --silent', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * Files the runner reported as failing WHOLE, at line 1:1, carrying only the
 * bare string 'test failed'. That is what `node --test` prints when a child
 * exits non-zero without reporting - a crash - as opposed to an assertion
 * failing inside the file, which always carries a line number and a message.
 * (B-66)
 */
function wholeFileCrashes(out) {
  const hits = [];
  const re = /test at (.+?):1:1\r?\n[^\n]*\r?\n\s*'test failed'/g;
  let m;
  while ((m = re.exec(out)) !== null) hits.push(m[1]);
  return [...new Set(hits)];
}

let failed = 0;
let orphaned = [];
const results = [];

/**
 * Every workspace this run STARTED, and every one that came back with a
 * count.  (B-66)
 *
 * The runner already exited non-zero when a workspace failed, and it already
 * said "1 workspace(s) FAILED" — but the summary line reported
 * `results.length`, which counts only the ones that REPORTED. So a run that
 * lost a whole workspace printed "2209 tests across 12 workspaces" beside a
 * previous run's "2232 across 13", and the only way to learn WHICH workspace
 * had gone was to subtract the two totals by hand. That is what B-58, B-66
 * and three separate P12-audit observations all had to do.
 *
 * `attempted` minus `reported` is the answer, by name, printed at the end.
 */
const attempted = [];
const reported = new Set();

for (const group of [...GROUPS, ...EXTRA]) {
  const dir = join(ROOT, group);
  if (!existsSync(dir)) continue;
  const isLeaf = EXTRA.includes(group);
  for (const name of (isLeaf ? [''] : readdirSync(dir).sort())) {
    const ws = isLeaf ? dir : join(dir, name);
    const hasTests = existsSync(join(ws, 'test'))
      // .mjs as well as .ts: the Netlify adapter is plain ESM, and a
      // detector that only knew about .test.ts would have made it invisible
      // in exactly the way this script exists to prevent.
      && readdirSync(join(ws, 'test')).some((f) => /\.test\.(ts|mjs|js)$/.test(f));
    const pkgPath = join(ws, 'package.json');
    const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : null;
    const script = pkg?.scripts?.test;

    // A workspace with test files and no way to run them is the exact
    // failure this script exists to prevent. It is an error, not a skip.
    if (hasTests && !script) { orphaned.push(`${group}/${name}`); continue; }
    if (!hasTests || !script) continue;

    const label = isLeaf ? group : `${group}/${name}`;
    attempted.push(label);
    process.stdout.write(`${label.padEnd(28)} `);
    try {
      const out = npmTest(ws);
      const pass = /^. tests (\d+)/m.exec(out)?.[1] ?? '?';
      const skip = /^. skipped (\d+)/m.exec(out)?.[1] ?? '0';
      const suites = /^. suites (\d+)/m.exec(out)?.[1] ?? '0';
      if (pass === '0') {
        console.log(`0 tests — NOTHING RAN${Number(suites) > 0
          ? ` (${suites} suite(s) skipped; set DATABASE_URL if they are DB-backed)`
          : ' (no test file matched)'}`);
      } else {
        console.log(`ok  ${pass} tests${skip !== '0' ? `, ${skip} skipped` : ''}`);
      }
      results.push(Number(pass) || 0);
      reported.add(label);
    } catch (err) {
      failed++;
      const out = String(err.stdout ?? '');
      const errOut = String(err.stderr ?? '');
      // The whole output, to a file, ALWAYS.
      //
      // The 40-line tail below is readable and it is not evidence. P0 hit an
      // ops-svc failure that appeared once in ten runs — `branding.test.ts`
      // reported as a whole-file failure, which is the signature of a hook
      // throwing rather than an assertion failing. The tail had already
      // scrolled past the cause, the run could not be reproduced, and there
      // was nothing left to diagnose. An intermittent failure you cannot read
      // is an intermittent failure you will eventually learn to ignore.
      const slug = (isLeaf ? group : `${group}-${name}`).replace(/[\\/]/g, '-');
      const dump = join(ROOT, `test-failure-${slug}.log`);
      try {
        writeFileSync(dump, `=== stdout ===\n${out}\n=== stderr ===\n${errOut}\n`);
        console.log(`FAIL  — full output: ${dump.slice(ROOT.length + 1)}`);
      } catch {
        console.log('FAIL');
      }

      // B-66. Name a CRASHED CHILD for what it is.
      //
      // A child that dies before running anything is reported by the test
      // runner in the same words as a test that failed an assertion, which is
      // how this went undiagnosed for three phases. The signature is precise:
      // a whole FILE failing at line 1:1, the bare string 'test failed' with
      // no assertion, and nothing on stderr - because the process was aborted
      // before it could write a byte.
      const crashed = wholeFileCrashes(out);
      if (crashed.length && !errOut.trim()) {
        console.log(`      ^ ${crashed.length} file(s) did not fail a test - the CHILD PROCESS CRASHED:`);
        for (const f of crashed) console.log(`          ${label}  ${f}`);
        // Which diagnosis is honest depends on the runtime underneath.
        // Claiming B-66 on a patched Node would send the next person chasing
        // a cause that has been excluded.
        const onDefectiveNode = nodeHasB66Defect();
        console.log(
          '        No assertion, no stderr: the process was aborted before it\n'
          + '        could report. A test that fails an assertion never looks like this.\n'
          + (onDefectiveNode
            ? `        This is B-66: you are on Node v${process.versions.node}, where a TCP socket\n`
              + '        in a node --test child aborts it (0xC0000409). Install Node\n'
              + `        >= ${NODE_B66_FIRST_GOOD.join('.')} and it stops. Re-running that ONE file alone\n`
              + '        will usually pass - that is the tell.'
            : `        This is the B-66 SIGNATURE, but Node v${process.versions.node} is past that\n`
              + '        defect, so B-66 is NOT the explanation here. Something else killed\n'
              + '        the child: look for process.exit/abort in the file, a native module,\n'
              + '        or an OOM. Do not file this as B-66 without new evidence.'));
      }

      process.stdout.write(out.split('\n').slice(-40).join('\n'));
    }
  }
}

// ── The SQL suites ─────────────────────────────────────────────────────
//
// This script's opening line is "fail loudly if a workspace has tests that
// nothing runs", and for twenty-six files it was doing exactly what it was
// written to prevent. db/tests/*.sql is not a workspace, has no package.json,
// and so was never in the loop above. It ran only in
// .github/workflows/database.yml.
//
// The cost was measured. `app.set_guardian_permissions` broke when migration
// 050 replaced the unique index it upserts through. Three of these suites
// caught it immediately and correctly. Nobody heard them: P5, P6, P7, P8 and
// a full project audit each declared the test suite green on the strength of
// this script, and every one of those statements was true about the Node
// tests and silent about the SQL. The fix landed as migration 064, four
// phases late. See docs/PHASE_LOG.md.
//
// These need the OWNER role on a direct connection — each file opens with
// `GRANT shikhon_app TO CURRENT_USER; SET ROLE shikhon_app`, which the
// runtime role cannot do. That is the same credential migrate.sh wants, so
// it reads the same variable.
const sqlDir = join(ROOT, 'db', 'tests');
const sqlFiles = existsSync(sqlDir)
  ? readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort()
  : [];

if (sqlFiles.length) {
  const url = process.env.DATABASE_MIGRATION_URL;
  process.stdout.write(`${'db/tests (sql)'.padEnd(28)} `);

  let psqlOk = false;
  if (url) {
    try { execSync('psql --version', { stdio: 'ignore' }); psqlOk = true; } catch { /* below */ }
  }

  // ── The Docker fallback (P-ops D) ──────────────────────────────────────
  //
  // "psql is not on PATH" was true and was also 26 suites nobody ran — on
  // every developer machine without a local PostgreSQL client install, which
  // is most of them, because the database this project develops against runs
  // in a container. The client was never missing; it was inside that
  // container the whole time.
  //
  // `scripts/sql-tests.mjs` pipes each file into the container's own psql. It
  // is a real execution path, not a shim: ON_ERROR_STOP stays on, a raising
  // suite still fails the run, and it refuses any file using `\i` or `\copy`
  // rather than running it with a path that cannot resolve.
  //
  // Preferred only when there is no local psql, so CI — which has one — keeps
  // taking the direct path it already uses.
  let dockerOk = false;
  if (!psqlOk) {
    try {
      execSync(`docker exec ${process.env.PG_CONTAINER ?? 'shikhon-r5'} psql --version`,
        { stdio: 'ignore' });
      dockerOk = true;
    } catch { /* reported below */ }
  }

  if (dockerOk) {
    try {
      const out = execSync(`node "${join(ROOT, 'scripts', 'sql-tests.mjs')}"`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const m = /(\d+)\/(\d+) SQL suite\(s\) passed/.exec(out);
      console.log(`ok  ${m ? m[1] : sqlFiles.length} suites (via docker psql)`);
    } catch (err) {
      const out = String(err.stdout ?? '') + String(err.stderr ?? '');
      const m = /(\d+)\/(\d+) SQL suite\(s\) passed/.exec(out);
      const passed = m ? Number(m[1]) : 0;
      failed += sqlFiles.length - passed;
      console.log(`FAIL  ${passed}/${sqlFiles.length} passed (via docker psql)`);
      for (const line of out.split('\n').filter((l) => l.startsWith('  FAIL'))) {
        console.log(`  ${line.trim()}`);
      }
      console.log('    run `node scripts/sql-tests.mjs` for the psql output');
    }
  } else if (!url) {
    // Not a failure: most local runs have no owner credential. But it says
    // NOTHING RAN, in the same words the workspace loop uses, because a tick
    // beside twenty-six unrun files is what caused this in the first place.
    console.log(`0 of ${sqlFiles.length} — NOTHING RAN (no DATABASE_MIGRATION_URL, and no docker psql)`);
  } else if (!psqlOk) {
    console.log(`0 of ${sqlFiles.length} — NOTHING RAN (no psql on PATH, and no docker container to borrow one from)`);
  } else {
    let sqlPass = 0;
    const sqlFailed = [];
    for (const f of sqlFiles) {
      try {
        execSync(`psql "${url}" -v ON_ERROR_STOP=1 -q -f "${join(sqlDir, f)}"`,
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        sqlPass++;
      } catch (err) {
        const msg = /^ERROR:.*$/m.exec(String(err.stderr ?? err.stdout ?? ''))?.[0] ?? 'failed';
        sqlFailed.push(`${f}: ${msg}`);
      }
    }
    if (sqlFailed.length) {
      failed += sqlFailed.length;
      console.log(`FAIL  ${sqlPass}/${sqlFiles.length} passed`);
      for (const line of sqlFailed) console.log(`    ${line}`);
    } else {
      console.log(`ok  ${sqlPass} suites`);
    }
  }
}

if (orphaned.length) {
  console.error(`\nERROR: workspaces with test files and no "test" script:\n  ${orphaned.join('\n  ')}`);
  console.error('Add: "test": "node --test \'test/*.test.ts\'"');
}

/**
 * The invariant B-66 asked for: everything started must report.
 *
 * Expected count is not a constant in a file — it is discovered, because the
 * whole point of this script is that a new workspace cannot go unnoticed.
 * So the expectation is `attempted`, and anything in it that never produced
 * a count is named here rather than left to arithmetic.
 */
const silent = attempted.filter((w) => !reported.has(w));

const total = results.reduce((a, b) => a + b, 0);
console.log(`\n${total} tests across ${reported.size}/${attempted.length} workspaces`
  + (failed ? `, ${failed} workspace(s) FAILED` : silent.length ? '' : ', all passing'));

if (silent.length) {
  console.error(`\nERROR: ${silent.length} workspace(s) started and never reported a count:`);
  for (const w of silent) console.error(`  ${w}`);
  console.error(
    '\nA workspace that does not report is not a workspace that passed. If this\n'
    + 'is the B-66 signature — a whole file failing with empty stderr, a different\n'
    + 'workspace each run — the full output of the failing run is in the log file\n'
    + 'named above, and re-running that ONE workspace alone will usually pass.');
}

process.exit(failed || orphaned.length || silent.length ? 1 : 0);
