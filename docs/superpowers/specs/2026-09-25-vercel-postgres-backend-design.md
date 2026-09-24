# Rollcall — shared backend on Vercel with Postgres

**Date:** 2026-09-25
**Status:** Approved design, awaiting spec review
**Supersedes:** the static-only Vercel deployment (`e17ae84`)

## Purpose

Move the Rollcall backend onto Vercel so attendance records persist server-side
and are reachable from any device, replacing the current browser-only
`localStorage` behaviour.

The audience is **one administrator** — the repo owner — using one shared
attendance dataset across their own laptop and phone. Success is: sign in from
two devices with one password and see the same records.

This is not a multi-tenant or institutional deployment.

## Why the existing backend cannot simply be deployed

`server/index.js` is a long-running stateful process. It cannot run on Vercel
Functions as written:

| Existing mechanism | Why it fails on Vercel |
|---|---|
| `node:sqlite` file at `DB_PATH` | Functions have an ephemeral, largely read-only filesystem. Writes are lost between invocations. |
| Sessions in a module-level `Map` | Each instance has its own memory; instances are created and destroyed freely. Logins break at random. |
| Login rate limit in module-level counters | Counters reset per instance, so the limit is trivially multiplied by spreading attempts. |

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Storage provider | Neon Postgres, added through the Vercel Marketplace | Serverless-friendly driver, free tier, relational so duplicate protection stays a database guarantee |
| Storage structure | **Postgres only** — SQLite removed | The engine under test is the engine in production. Avoids a green suite that does not cover the deployed path. |
| Authentication | Keep one shared `ADMIN_PASSWORD`; sessions persist in Postgres | Preserves the 8-hour bearer model while making redeploys non-destructive and keeping logout genuinely revocable |
| Rate limiter | Persisted in Postgres | Keeps the 15-per-minute cap meaningful across instances |
| Frontend connection | Auto-detect the same-origin API by default; keep the manual "Backend URL" field | Removes the paste-a-URL step for the hosted case while leaving a self-hosted backend reachable |
| Dockerfile | Updated to connect via `DATABASE_URL` | Keeps self-hosting on any Docker host working |

## Non-goals

Explicitly out of scope. Do not build these:

- Per-user accounts, teacher logins, or role-based permissions
- Password recovery or password reset
- Offsite or scheduled database backups
- An audit-log viewing UI (`audit` keeps being written, nothing reads it)
- Multi-tenant isolation between separate classes or institutions

## Architecture

```
web/                  static frontend, served as today (outputDirectory: "web")
api/index.js          the single Vercel function entry point
server/app.js         routing, origin checks, auth, JSON handling — storage-agnostic
server/postgres.js    data layer: parameterised SQL only
web/core.js           shared validation, unchanged and still shared
```

`/api/(.*)` is routed to the single function in `api/index.js`. One entry point
keeps routing, origin checking, and auth in one place rather than duplicating
middleware across per-endpoint files.

Implementation step 1 is a throwaway probe that settles how `/api/*` reaches that
single function — a `vercel.json` rewrite, or a catch-all function filename. The
outcome is fixed either way: exactly **one** function serves every API route, so
auth and origin checks exist in one place.

### Component boundaries

- **`server/app.js`** receives a `store` object and knows nothing about SQL. It
  can be unit-tested against an in-memory fake. It owns HTTP concerns only.
- **`server/postgres.js`** owns every SQL statement. Nothing outside it issues
  queries. It exposes: schema initialisation, `listRecords`, `insertRecords`
  (transactional), `createSession`, `getSession`, `deleteSession`,
  `registerAttempt`.
- **`api/index.js`** is a thin adapter: build the store from `DATABASE_URL`,
  cache the schema-init promise per instance, hand the handler to Vercel.

Splitting these means the request logic can be tested without a database, and
the SQL can be changed without touching HTTP behaviour.

## Schema

```sql
CREATE TABLE IF NOT EXISTS records (
  student_id  TEXT    NOT NULL,
  course_code TEXT    NOT NULL,
  date        TEXT    NOT NULL,
  time_slot   TEXT    NOT NULL,
  present     BOOLEAN NOT NULL,
  PRIMARY KEY (student_id, course_code, date, time_slot)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT   PRIMARY KEY,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  window_start BIGINT PRIMARY KEY,
  attempts     INT    NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id    BIGSERIAL   PRIMARY KEY,
  at    TIMESTAMPTZ NOT NULL,
  event TEXT        NOT NULL,
  count INT         NOT NULL
);
```

The composite primary key on `records` is what makes duplicate rejection a
database guarantee rather than an application-level check, preserving the
protection the SQLite version had. Session rows store a SHA-256 hash of the
bearer token, never the token itself.

Schema initialisation uses `CREATE TABLE IF NOT EXISTS` and is idempotent. The
promise is cached per instance so concurrent requests in the same instance share
one initialisation rather than racing.

## API contract

Unchanged from the current implementation. The frontend must not need changes to
its request shapes.

| Method | Endpoint | Auth | Success |
|---|---|---|---|
| GET | `/api/health` | none | `200 {ok:true}`, or `503` if the database is unreachable |
| POST | `/api/login` `{password}` | none | `200 {token, expiresIn:28800}` |
| POST | `/api/logout` `{}` | Bearer | `200 {ok:true}` |
| GET | `/api/records` | Bearer | `200 {records:[...]}` |
| POST | `/api/records` `{records:[...]}` | Bearer | `201 {inserted:n}` |

Record objects keep their existing field names (`studentId`, `courseCode`,
`date`, `timeSlot`, `present`) at the API boundary. Mapping to snake_case column
names happens inside `server/postgres.js` only, so `web/core.js` and the
frontend are untouched by the schema naming.

## Data flow

**Sign in.** `POST /api/login` → check the rate-limit window in `login_attempts`
→ `scrypt` compare against `ADMIN_PASSWORD` → on success insert a session row
with the token's hash and an 8-hour expiry → return the raw token once.

**Authenticated read.** `GET /api/records` → hash the presented bearer token →
look up `sessions` → reject `401` if absent or expired → `SELECT` all records.

**Authenticated write.** `POST /api/records` → validate rows with
`validateRecords` from `web/core.js` → `BEGIN` → insert all rows → `COMMIT`. A
unique-constraint violation rolls back and returns `409`, so imports stay
all-or-nothing exactly as before.

**Logout.** Delete the session row, which genuinely revokes the token.

## Error handling

Status codes are preserved exactly, because the frontend and the existing tests
both depend on them:

| Code | Condition |
|---|---|
| 400 | Invalid rows, invalid JSON, or no records supplied |
| 401 | Missing, unknown, or expired session; wrong password |
| 403 | Request `Origin` outside the allowlist |
| 409 | Duplicate attendance; the whole import is rejected |
| 413 | Body over 20 MB |
| 415 | `POST` without `application/json` |
| 429 | More than 15 login attempts in 60 seconds |
| 500 | Unexpected failure; logged server-side with a generic client message |

Database errors are never surfaced verbatim to the client. `/api/health` reports
failure when the database is unreachable rather than returning `ok`, so a
misconfigured `DATABASE_URL` is visible instead of silently healthy.

## Security

- `ADMIN_PASSWORD` and `DATABASE_URL` are Vercel environment variables, never
  committed. `ADMIN_PASSWORD` stays ≥16 characters, enforced at startup.
- Passwords are verified with `scrypt` and `timingSafeEqual`, unchanged.
- Session tokens are 256 bits of randomness; only their hashes are stored.
- `connect-src` **keeps** `'self' https:`. It is deliberately not narrowed to
  `'self'`: the app's existing "Backend URL" field and the self-hosted Docker
  path must still reach a backend on a different origin. Built-in same-origin
  storage is the default route, not the only permitted target.
- The origin allowlist is the request's own host, plus `ALLOWED_ORIGIN` when set.
  Same-origin is decided by comparing the `Origin` header's host against the
  `Host` header, a comparison a browser cannot forge, so preview deployments work
  without opening the API to arbitrary origins.
- All SQL is parameterised. No string interpolation into queries.

## Testing

`tests/core.test.js` is unchanged — it is pure validation with no database.

`tests/server.test.js` keeps its existing assertions but runs against **real
Postgres**. Because the suite now needs a database, `npm test` requires
`DATABASE_URL` (or `TEST_DATABASE_URL`), and the suite **fails loudly with an
explanatory message if it is unset** rather than silently skipping — a silent
skip would let a broken deployment path pass CI.

New cases required beyond the existing ones:

1. Atomic rollback — a duplicate row mid-import leaves the record count unchanged
2. `409` on a duplicate whose first student is absent from existing data
3. Session persistence — a token issued by one handler instance is accepted by a
   freshly constructed one
4. Rate limit — the 16th attempt within a window returns `429` when counted
   through a different handler instance
5. Expired session returns `401`
6. `web/core.js` field names round-trip correctly through the snake_case mapping

CI: the Pages workflow gains a Postgres service container so the suite still
proves the production path on every push. Existing `web/core.js` checks and the
Pages deploy step are otherwise unchanged.

## Deployment

Environment variables on the Vercel project:

| Name | Value |
|---|---|
| `DATABASE_URL` | Injected by the Neon integration |
| `ADMIN_PASSWORD` | The admin password, ≥16 characters |
| `ALLOWED_ORIGIN` | Optional; only needed if a separate origin must call the API |

## Rollout

1. Implement with tests; run the suite against Postgres locally
2. Deploy a **preview** deployment
3. Verify `/api/health`, then login → read → write → duplicate `409` → logout by curl
4. Set `ADMIN_PASSWORD` in Vercel
5. Promote to production
6. Confirm sign-in from a browser, on two devices

## Rollback

The current static-only production deployment (`e17ae84`) keeps serving
throughout. If the Postgres path misbehaves, production is rolled back to that
deployment via the Vercel API, and the site continues working on
`localStorage` with no data loss to existing browser records.

No server-side attendance data exists yet, so there is no migration to reverse.

## Known risks

1. **Vercel function detection with `buildCommand: null`** — the current
   `vercel.json` disables the build step for the static site. Whether `api/`
   functions are still detected and bundled must be confirmed empirically before
   anything else is built.
2. **Neon free-tier connection limits** under concurrent serverless invocations.
   The serverless driver pools over HTTP, which should be sufficient, but this is
   unverified until load exists.
3. **`scrypt` cold-start cost** — roughly 100 ms per new instance while the
   password hash is derived. Acceptable, and unchanged in character from today.
4. **Browser data does not migrate itself.** Existing `localStorage` records must
   be exported and re-imported after connecting. Nothing uploads automatically.

## Definition of done

- The test suite passes against real Postgres, and fails clearly when
  `DATABASE_URL` is absent
- `web/core.js` is unchanged
- The API contract table above is satisfied, verified by curl against the
  deployed preview
- Duplicate imports return `409` and leave the database unchanged
- A session issued before a redeploy still works after it
- Both production aliases serve the app, and sign-in works from a browser
