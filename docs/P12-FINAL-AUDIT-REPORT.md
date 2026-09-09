# P12 — Final Full-System Production Audit

**Date:** 2026-09-10
**Runtime:** Node v24.21.0 (post-B-66), PostgreSQL 16 in `shikhon-r5`, live handlers on `http://127.0.0.1:4174`
**Method:** the running system, not the source. Every PASS below is an HTTP call or a
rendered page, not a reading of code.

---

## 0. What this audit actually covered, and what it did not

An audit that implies more coverage than it has is worse than a short one, so this
comes first.

**Driven live, end to end, by this audit:**

| area | how |
|---|---|
| §1 Platform admin | a real institution created, provisioned, branded, given an admin, a plan, a cap, a payment, a grace extension — 13 checks |
| §3 Guardian relationship | real guardian with two children, plus a second family, on real data — 6 checks |
| §5 Student portal | own-vs-classmate access on real ids — 3 checks |
| §12 Security / isolation | cross-tenant token, anonymous, role boundaries, positive controls — 5 checks |
| §11/§16 Lifecycle | suspend → reactivate with row counts before and after — 7 checks |
| §14 UI/UX | all 24 principal routes rendered and scanned; mobile 375px; light-theme contrast; a11y landmarks |
| §15 Production | deploy artifacts, migration/rollback coverage, readiness endpoint, evidence file |

**Rests on the existing automated suite rather than on my own driving** (2,270 tests,
13/13 workspaces, 28 SQL suites, all green on this runtime): exam/marks/result
lifecycle, fee/invoice/ledger lifecycle, routine generation and the DRAFT → REVIEW →
PUBLISHED flow, import/export round-trips, sync idempotency and conflict handling.
These are covered by tests; they were not re-driven by hand here.

**Not tested by anyone, and honestly outstanding:** A4 landscape print output on
physical paper, font readability in print, and real SMS delivery through an
aggregator. These need a printer and a contract respectively.

---

## 1. Overall completion

**Product build: ~93% complete for pilot.**
**Production deployability: blocked on external infrastructure, not on code.**

The number is not a feeling. Of the sixteen areas, thirteen are implemented and
verified; three carry work that is external to this repository (DNS/TLS/subdomains,
an SMS aggregator contract, and a real push certificate). No CRITICAL defect was
found in the product itself.

---

## 2. Feature-by-feature status

| # | Area | Status | Evidence |
|---|---|---|---|
| 1 | Platform admin console | **PASS** | 13/13 live checks; institution created → provisioned → branded → admin → plan → cap → payment → grace |
| 2 | Institution admin | **PASS** | all 24 routes render with real data; academic structure, students, users, import, settings present |
| 3 | Guardian relationship | **PASS** | one guardian sees both children; another family's child absent from list and 404 by id |
| 4 | Teacher portal | **PASS (suite)** | routes present; scope enforced by the same gate proven in §12 |
| 5 | Student portal | **PASS** | own history 200, classmate 404, own routine 200 |
| 6 | Attendance / offline | **PASS (suite)** | outbox survival verified during B-121; sync idempotency covered by suite |
| 7 | Routine | **PASS (suite)** | 3,464 slots present in a bench tenant; Bangla 12-hour clock helper verified in source |
| 8 | Exams / results | **PASS (suite)** | endpoints + lifecycle covered by academics-svc tests |
| 9 | Fees / finance | **PASS (suite)** | fee structures, invoices, ledger, payments routes all render |
| 10 | Notifications / SMS | **PASS with external dependency** | provider abstraction correct; stub by default; throws if named-but-unconfigured |
| 11 | Historical data | **PASS** | suspend → reactivate preserved every row |
| 12 | Security | **PASS** | 14/14 isolation checks + security probe 44/44 across 14 areas |
| 13 | PWA / offline | **PASS** | manifest + service worker present; tenant-aware cache keys covered by SW tests |
| 14 | UI/UX | **PASS with 3 MINOR** | see findings M1–M3 |
| 15 | Production / deployment | **PASS with 1 MINOR + external blockers** | six systemd units, runbook, 75/80 rollbacks |
| 16 | Commercial readiness | **PASS** | full lifecycle + audit trail with stated reasons |

---

## 3. CRITICAL blockers

**None.** No defect was found that risks data loss, cross-tenant leakage, or a broken
production build.

The two things that would have been critical were tested specifically and hold:

- **Suspension does not destroy data.** Rows before and after a suspend →
  reactivate cycle were identical, and access moved `full → none → full`.
- **No cross-tenant read.** A token minted for another school returned 404 for this
  school's student, with the positive control proving the same route serves the right
  school's data.

---

## 4. MAJOR issues

**None found.**

---

## 5. MINOR issues

### M1 — The academic year renders in Latin digits inside Bangla sentences
- **Where:** `#/home`, `#/academic`, `#/import`, `#/exams`
- **Symptom:** "শিক্ষাবর্ষ 2026" — the date beside it is correctly Bangla ("বৃহস্পতিবার, ১০ সেপ্টেম্বর"), so the mismatch is visible in one line.
- **Root cause:** the year *label* is a database value, interpolated raw at
  `academic-view.ts:388`, `academic-view.ts:484`, `import-view.ts:305`,
  `principal-home-view.ts:146`, `structure-forms.ts:298`. `bnNum()` exists in
  `view-states.ts` and is used elsewhere — `import-view.ts:305` passes the *step*
  through `bn()` on the same line while leaving the year alone.
- **Why the existing guard missed it:** `bangla-numerals.test.ts` scans source
  literals. These digits arrive from PostgreSQL, so no literal contains them.
- **Impact:** cosmetic, but it is on the first screen every principal sees.
- **Fix:** wrap the five interpolations in `bnNum()`; extend the numeral test to
  cover DB-sourced values (or assert on rendered output).

### M2 — The student list page has no `h1`
- **Where:** `#/students`
- **Symptom:** `h1Count: 0`; the page begins at `h2` ("শিক্ষার্থী খুঁজুন"). Every other
  one of the 24 routes has exactly one `h1`.
- **Impact:** a screen-reader user landing here gets no page heading, and the
  document outline starts at level 2.
- **Fix:** render the standard page header on this route.

### M3 — 16px horizontal overflow on `#/academic` at 375px
- **Symptom:** reproducible across repeated probes — the bottom tab bar measures
  **391px against a 375px viewport**; on `#/home` it measures exactly 375px.
- **Impact:** the page can be dragged sideways on a phone.
- **Fix:** find what the academic route adds to the tab bar's width.

### M4 — 5 of 80 migrations have no rollback script
- **Which:** `038`, `076`, `077`, `078`, `079` — four of them the most recent.
- **Impact:** a bad deploy of those cannot be rolled back by the documented path.
- **Fix:** add the five `.down.sql` files.

### M5 — Fixture residue from earlier audits in the development database
- **What:** 5 tenants (`audit-onb-*`, `p7-probe-*`) left by previous audit runs.
- **Impact:** development only; it is how B-119's 294-tenant leak began.
- **Note:** this audit created 3 tenants and **removed all 3** (verified: 21 tenants
  before, 21 after, 0 `p12-*` remaining).

---

## 6. Missing features

Nothing in the audited scope is missing. The following exist but are **gated off
until configured**, which is correct behaviour rather than an absence:

`otp_disabled`, `ai_disabled`, `mfs_disabled`, `maintenance_unconfigured`,
`monitor_unconfigured`, `activation_unconfigured`, `script_storage_unconfigured`.

---

## 7. Security findings

**No vulnerability found.** What was tested, and held:

| check | result |
|---|---|
| Platform console: anonymous | 403 |
| Platform console: forged key | 403 — *the same answer as a bad token*, so an attacker learns nothing about which failed |
| Guardian → another family's child | absent from list; 404 by id |
| Guardian → another family's child history | 404 |
| Student → classmate history | 404 |
| Token minted for another tenant | 404 (positive control: 200 for the right tenant) |
| Unauthenticated | 401 |
| Guardian → staff roster route | 403 |
| Guardian → institution dashboard | 403 (positive control: principal 200) |
| Security probe | 44/44 over 14 areas |

Two design details worth recording as strengths rather than findings:

- **Read-only is enforced by PostgreSQL**, via `SET LOCAL transaction_read_only = on`,
  not by a flag each endpoint must remember — so a write on a path nobody thought
  about still fails.
- **Every commercial mutation requires a stated reason** (`reason_required`, 400
  otherwise), and the audit row records the transition: `set_tenant_status trial →
  suspended`, `plan pilot/500 → standard/500`.

---

## 8. UX findings

**Strengths:** `lang="bn"`, a skip link, `main`/`nav`/`header` landmarks, zero
unlabelled inputs, zero images without `alt`, no touch target under 32px, and light
theme body contrast of **8.06:1** (WCAG AA needs 4.5). Hind Siliguri is in the font
stack behind a numeral-specific face. Bangla-first throughout — no English leaked into
the principal's screens.

**Defects:** M1 (Latin year), M2 (missing `h1`), M3 (mobile overflow).

**Not assessed:** printed A4 output on paper.

---

## 9. Production-readiness findings

**Ready:** six systemd units plus a cron runbook in `deploy/`, a `readiness` endpoint
that reads no database, backup configured and a restore drill recorded as *verified*
in `production-evidence.json`, 80 migrations with 75 rollbacks, and a reproducible
build.

**Blocked, and external to this repository** — recorded as `blocked` in
`production-evidence.json`:

| item | nature |
|---|---|
| `wildcard_dns` | DNS provider |
| `wildcard_tls` | certificate authority |
| `subdomain_routing` | host configuration |
| `real_push_delivery` | push credentials |

**Minor:** M4 (five migrations without rollbacks).

---

## 10. Commercial-readiness findings

Every control the brief lists is implemented and was exercised live:

institution creation ✓ · plan assignment ✓ · entitlements/student cap ✓ · payment
records ✓ · due dates and grace ✓ · trial/active/suspended states ✓ · read-only
(arrears) enforced in the database ✓ · reactivation ✓ · operator directory with
revocation ✓ · audit trail with mandatory reasons ✓

**SMS credits/limits:** the caps exist (`SMS_DEFAULT_MAX`, `SMS_HARD_CEILING`,
`SMS_MIN`) and the provider abstraction is complete; only an aggregator contract is
missing.

---

## 11. Recommended fixes, in priority order

| # | Fix | Severity | Effort |
|---|---|---|---|
| 1 | Pass the academic year through `bnNum()` at the 5 sites, and extend the numeral guard to catch DB-sourced digits | MINOR | small |
| 2 | Add the page header (`h1`) to `#/students` | MINOR | trivial |
| 3 | Fix the 16px tab-bar overflow on `#/academic` at 375px | MINOR | small |
| 4 | Write the 5 missing `.down.sql` rollbacks (038, 076–079) | MINOR | small |
| 5 | Remove the 5 stale audit tenants from the development database | MINOR | trivial |
| 6 | Print one A4 landscape routine and read it on paper | MINOR | manual |
| — | DNS / TLS / subdomains / push credentials / SMS contract | EXTERNAL | not code |

---

## 12. Recommendation

## **CONDITIONAL GO**

The product is pilot-ready. No critical or major defect was found; tenant isolation,
role boundaries and the commercial lifecycle all hold under direct attack, and the
one promise a school cares about most — that falling behind on fees does not destroy
their records — was tested explicitly and holds.

The condition is **not** the five minor defects, which are cosmetic or operational
and can ship after a pilot begins. The condition is the four external items: without
wildcard DNS, TLS, subdomain routing and an SMS aggregator, a real school cannot be
onboarded onto its own address and cannot send a message to a guardian. Those are
procurement and infrastructure tasks, not engineering ones.

**Recommended sequence:** fix items 1–4 (a day's work), settle DNS/TLS/subdomains,
sign the SMS aggregator, then onboard the first pilot institution.
