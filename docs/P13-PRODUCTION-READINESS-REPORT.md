# P13 — Production Infrastructure & First Pilot Readiness

**Date:** 2026-09-10
**Runtime:** Node v24.21.0, PostgreSQL 16 (`shikhon-r5`), live handlers on `http://127.0.0.1:4174`
**Method:** the running system. Nothing below is claimed from reading source alone.

---

## Verdict

## **NO-GO for production — and the blockers are not code.**

Every repository-side requirement for production is implemented and evidenced.
Nothing is missing that engineering can supply. What stands between this and a
live pilot is **five external dependencies** and **one real school**, listed in
§3 with the exact action and owner for each.

This report deliberately does not say GO. Two of the required gates —
*production infrastructure available* and *one complete real pilot journey* —
cannot be evidenced from here, and a GO issued without them would be the kind
of claim this project has spent thirteen phases refusing to make.

---

## 1. Phase A — what is configured, and what is not

Read from the live go-live endpoint (`GET /api/v1/platform/readiness`), which
is the product's own answer rather than mine. This is the **development**
deployment, so most items are correctly off; the column that matters is *what
turns it on*.

| # | Item | Status here | What turns it on |
|---|---|---|---|
| 1 | Wildcard DNS | **EXTERNAL — not done** | `*.sikhon.systems` A/CNAME at the DNS provider |
| 2 | Wildcard TLS | **EXTERNAL — not done** | wildcard certificate for `*.sikhon.systems` |
| 3 | Subdomain routing | **PASS (code)** — gated off by `WILDCARD_DNS_READY` | set the flag *after* 1 and 2 |
| 4 | Production domain | **EXTERNAL** | `sikhon.systems` pointed at the deployment |
| 5 | Push delivery | **PASS (code), BLOCKED (delivery)** | `scripts/generate-vapid-keys.mjs`, then `VAPID_*` |
| 6 | SMS aggregator | **PASS (code), BLOCKED (delivery)** | an aggregator contract + `SMS_*` |
| 7 | Env vars / secrets | **PASS — completed in this phase** | `deploy/env.example`, now guarded by a test |
| 8 | Backup / restore | **PASS (procedure), EXTERNAL (schedule)** | a production backup schedule; restore is rehearsed |
| 9 | Worker / cron | **PASS (code)** | `systemctl enable --now` on three timers |
| 10 | Monitoring / health | **PASS (code), BLOCKED (paging)** | `ALERT_WEBHOOK_URL` |

The readiness endpoint's own words, verbatim, on this deployment:

```
NOT READY  sms_provider       কোনো অ্যাগ্রিগেটর নেই — বার্তা লগে যায়, ফোনে নয়
NOT READY  sms_dlr            SMS_DLR_SECRET নেই — বার্তা পৌঁছেছে কি না জানা যাবে না
READY      otp_login          চালু — কিন্তু অ্যাগ্রিগেটর ছাড়া ওটিপি পৌঁছাবে না
NOT READY  web_push           বন্ধ — scripts/generate-vapid-keys.mjs চালিয়ে কী তৈরি করুন
NOT READY  subdomains         বন্ধ — *.sikhon.systems এর DNS ও TLS এখনো হয়নি
NOT READY  maintenance_cron   DATABASE_MAINTENANCE_URL নেই — পার্টিশন তৈরি হবে না
READY      platform_console   নতুন প্রতিষ্ঠান যোগ করা যাবে
```

That an unconfigured deployment says so, in Bangla, on the operator's own
screen, is itself a readiness feature. `subdomainsReady()` **fails closed** and
is an explicit switch precisely because a DNS lookup from a serverless function
proves nothing about a visitor's resolver.

---

## 2. Phase B — verified in this phase

### 2.1 Subdomain routing — **PASS**, 12 checks

The model is `school-slug.<platform-domain>` → slug → tenant → that school's
branding, **before** anyone signs in. What it must never do is decide *who you
are*: authenticated tenancy comes from the JWT's `tid`.

**The resolver, on 16 shapes a visitor can type** — every one correct:

| input | resolves to | why |
|---|---|---|
| `monipur-school.sikhon.systems` | `monipur-school` | a real school |
| `MONIPUR-SCHOOL.sikhon.systems` | `monipur-school` | case normalised |
| `sikhon.systems` | *(nothing)* | apex is not a school |
| `localhost` | *(nothing)* | no room for a label |
| `www` / `app` / `platform` / `api` / `staging` | *(nothing)* | reserved |
| `-bad` / `ab` / `a_b` | *(nothing)* | not the slug shape |
| `../etc` / `%2e%2e` | *(nothing)* | traversal in a label |
| `x'or'1=1` / `<script>` | *(nothing)* | injection in a label |

**Unknown, suspended, inactive, malformed** — tested against the live API:

| state | identity resolves? | API |
|---|---|---|
| active | yes, to its own tenant id | open |
| **suspended** | **yes — the school still exists** | **closed (`access=none`)** |
| archived | no — neutral branding, `tenantId: null` | closed |
| unknown slug | no — neutral branding, `tenantId: null` | n/a |
| malformed slug | no — and a 200, not a 500 | n/a |

Suspended still resolving is deliberate and correct: a parent typing their
school's address should see *their school*, not a stranger's error page. The
API behind it is shut by the same PostgreSQL-level gate P12 verified.

**A forged `Host` / `X-Forwarded-Host` header changes nothing** — the response
to an authenticated request was **byte-identical** to the honest one. No handler
in `services/` or `packages/` reads the Host header for tenant identity; the
only host-adjacent route is `GET /ops/brand`, which is pre-auth by design and
returns seven public fields.

### 2.2 Backup / restore — **PASS as a procedure**

`scripts/restore-drill.mjs` was **run, not read**, against the development
database:

```
backup 5.1 MB (1.3s) → restore into an isolated database (4.0s)
7 schema counts and 27 table counts identical
16 tenants identical per entity (students · teachers · guardians ·
                                 attendance · marks · invoices)
RTO observed: 5.9s          PASSED
```

The drill is a comparison, not a ceremony — it counts what went in, counts what
came out, and fails on any difference, because `pg_restore` exits 0 having
skipped objects it could not create. It also refuses to overstate itself: the
evidence block it prints records `environment: local-docker` and says plainly
that this **rehearses** the production restore rather than closing it.

**Still external:** the backup *schedule*. RPO is a property of the schedule,
not of any restore, and the drill correctly declines to measure it.

**Historical data / no destructive suspension:** re-confirmed in P12 —
suspend → reactivate left every row identical while access moved
`full → none → full`.

### 2.3 Environment and secrets — **PASS, and a real gap closed**

Diffing every `process.env.*` in `services/` and `packages/` against
`deploy/env.example` found **five production-runtime variables the template
never documented**. An operator provisioning from it would not have failed
loudly — the deployment starts and behaves however the fallback behaves.

| variable | what its absence does |
|---|---|
| `SMS_WORKER_TENANT_IDS` | **empty means no school's queue is drained** — indistinguishable from a broken aggregator |
| `SERVICE_KEY_TENANT_SWITCH` | governs whether a service key may act for another tenant |
| `ANS_SIGNING_SECRET` | unsigned outbound events |
| `AI_MODEL_SIKHOK` / `AI_MODEL_SHIKHO` | model version becomes a surprise rather than a deploy |

All five are now documented with the consequence spelled out, and
`packages/server-core/test/env-template.test.ts` fails the build if the template
drifts from what the code reads again. It carries a negative control.

### 2.4 Push — **code PASS, delivery BLOCKED**

Lifecycle implemented and covered by **48 tests** (23 API, 25 UI): permission →
subscription → tenant association → target selection → queue → delivery →
failure → retry/idempotency → unsubscribe. `vapidFromEnv()` returns null
without keys and the UI reports push as unavailable rather than pretending.

**External delivery is BLOCKED, not PASS.** No VAPID keys exist on any
deployment and no push has ever been delivered to a real device.
`production-evidence.json` records `real_push_delivery: blocked`.

### 2.5 SMS — **code PASS, delivery BLOCKED**

**79 tests** across seven files. The design is careful in the places that
matter:

- **Unconfigured is the stub, not a failure** — messages land in the log.
- **Named without credentials THROWS** — it does not fall back. "A school that
  believes its messages are going out is worse off than one that knows they are
  not."
- **HTTP 200 with a failure body is a failure** — the subtle case aggregators
  actually produce.
- **`SMS_TEST_RECIPIENTS` is an allowlist**, and the tests pin the trap:
  *empty means unrestricted, not "send to nobody"*; a withheld row is
  **recorded, not hidden**; withholding does not consume an attempt.

That allowlist is what makes a first pilot survivable: a real aggregator can run
against real school data without a single message reaching a real parent.

**No real SMS has been delivered. Nothing here claims otherwise.**

### 2.6 Worker / cron and monitoring — **code PASS**

Three systemd timers with valid schedules — maintenance 19:00 UTC (01:00 BST),
SMS 18:00 UTC (00:00 BST), monitor every 15 minutes via
`OnBootSec` + `OnUnitActiveSec`. The monitor POSTs firing alerts to
`ALERT_WEBHOOK_URL`; unset, it reports `delivered: false` with the reason rather
than silently succeeding. **Paging is BLOCKED until that URL exists.**

---

## 3. What I need from you — exact owner and action

| # | Blocker | Owner | Action |
|---|---|---|---|
| 1 | Wildcard DNS | you / DNS provider | point `*.sikhon.systems` at the deployment |
| 2 | Wildcard TLS | you / CA | issue and install a `*.sikhon.systems` certificate |
| 3 | Flip subdomains on | you | set `WILDCARD_DNS_READY=1` **after** 1 and 2, never before |
| 4 | SMS aggregator | you / commercial | contract with a BD aggregator (SSL Wireless adapter is written); then `SMS_PROVIDER`, `SMS_ENDPOINT`, `SMS_API_TOKEN`, `SMS_SENDER_ID`, `SMS_DLR_SECRET` — **and `SMS_TEST_RECIPIENTS` before the first dispatch** |
| 5 | Push keys | you | run `node scripts/generate-vapid-keys.mjs`, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| 6 | Alert destination | you | an https `ALERT_WEBHOOK_URL` that reaches a human |
| 7 | Backup schedule | you / host | a scheduled backup; the restore side is rehearsed and passing |
| 8 | Production secrets | you | `JWT_*`, `PLATFORM_API_KEY`, `ACTIVATION_PEPPER`, `PII_MASTER_KEY_V1`, `CRON_SECRET`, `SERVICE_API_KEY` |
| 9 | **A real pilot school** | you | B-5. Without one, the pilot journey below cannot be run at all |

Items 1–8 are configuration. Item 9 is a relationship, and it is the one that
cannot be hurried.

---

## 4. The pilot journey — **NOT RUN, and why**

The brief asks for one complete journey *"using a real pilot institution, not
only fixtures."* **It has not been run, and I am not going to simulate it and
call it done.**

Two things prevent it:

1. **No real pilot institution exists.** B-5 is open. Every institution in the
   database is a fixture created by this project's own tooling.
2. **The infrastructure it would run on does not exist yet** — items 1–4 above.

What *has* been driven end to end against the running system, on real data, is
the whole of that journey's mechanism: platform admin → institution → branding
→ admin → plan/cap/payment/grace (13 checks, P12); guardian, student and
teacher visibility with cross-family and cross-tenant denial (14 checks);
suspend → reactivate preserving every row (7 checks); and the subdomain model
(12 checks, this phase).

The distance between that and a pilot is a school and a domain, not code.

---

## 5. Regression after this phase's changes

| gate | result |
|---|---|
| Full suite | see §6 below |
| Typecheck | 0 / 0 / 0 |
| Build | clean |
| Security probe | 44 / 44 over 14 areas |
| Tenant isolation | 14 / 14 |
| Subdomain model | 12 / 12 |
| Restore drill | PASSED — 27 tables, 16 tenants, RTO 5.9s |
| `index.html` | byte-identical at `496199bd` |

## 6. Recommendation

**NO-GO for production**, on the two gates the brief itself sets: external
dependencies unmet, and no real pilot journey evidenced.

**CONDITIONAL GO for a pilot** the moment items 1–5 and 9 are supplied. The
sequence I would run, in this order:

1. DNS and TLS, then `WILDCARD_DNS_READY=1`.
2. VAPID keys and `ALERT_WEBHOOK_URL` — cheap, and they make the rest
   observable.
3. Aggregator credentials **with `SMS_TEST_RECIPIENTS` set to your own phone
   only**. Send one message to yourself and read it.
4. Backup schedule, then re-run `restore-drill.mjs` against production so the
   evidence block says `production` instead of `local-docker`.
5. Onboard the pilot school and walk the full journey on their real data.

Nothing in step 5 is expected to surprise us. That is what the previous twelve
phases were for.
