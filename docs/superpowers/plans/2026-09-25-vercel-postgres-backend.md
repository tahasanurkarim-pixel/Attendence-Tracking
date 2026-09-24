# Rollcall Postgres Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SQLite-backed `server/index.js` with a Vercel Function at `/api/*` backed by Neon Postgres, so attendance records persist server-side and reach every device.

**Architecture:** `api/index.js` is the single Vercel Function entry and builds a `pg` Pool plus a store; `server/app.js` holds HTTP concerns (routing, origin, auth, JSON) and knows nothing about SQL; `server/postgres.js` holds every SQL statement and is the only module that talks to the database. `web/core.js` validation stays shared and unchanged.

**Tech Stack:** Node 24 (ESM), `pg`, Neon Postgres, Vercel Functions, `node:test`/`node:assert`.

**Spec:** `docs/superpowers/specs/2026-09-25-vercel-postgres-backend-design.md`

## Global Constraints

- Node `>=24`; the package is ESM (`"type": "module"`). All new files use `import`/`export`.
- `ADMIN_PASSWORD` must be **at least 16 characters**; the handler throws at construction if shorter.
- Exactly **one** new runtime dependency: `pg`. No ORMs, no migration frameworks.
- Session API lifetime stays **28800 seconds** (8 hours).
- Login rate limit stays **15 attempts per 60 seconds**.
- Request body cap stays **20 MB**.
- HTTP status codes are fixed and must match the spec exactly: `400`, `401`, `403`, `409`, `413`, `415`, `429`, `500`.
- API field names are **camelCase** (`studentId`, `courseCode`, `date`, `timeSlot`, `present`); database columns are **snake_case**. Translation happens only inside `server/postgres.js`.
- `records` primary key is `(student_id, course_code, date, time_slot)` — duplicate rejection is a database guarantee, never an application check.
- Session rows store a **SHA-256 hash** of the token, never the token.
- `web/core.js` is **not modified** by any task.
- No secret is ever committed. `DATABASE_URL` and `ADMIN_PASSWORD` come from the environment.

## Review Focus

These are the failure modes the spec implies but no task's own tests exercise. Each is pinned by a test in the task named beside it.

1. **A session must survive signing in from a second device.** Opening the app on a phone must not invalidate the laptop's session. Nothing about `INSERT INTO sessions` alone guarantees two rows coexist; Task 7 pins it.
2. **A full-semester import must not half-write.** A large import that fails partway, or a duplicate anywhere in the middle, must leave the record count exactly as it was. Task 6 pins the mid-import duplicate case.
3. **A session expiring while a register is open must not appear to have saved.** Past 8 hours the next read or write returns `401` rather than being accepted, so a save can never look successful while storing nothing. Task 4 pins the `401`.
4. **`/api/health` must report failure when the database is unreachable, not `ok`.** The frontend treats any non-`2xx` health response as "no built-in storage" and stays on local records, so a lying `ok` would strand the user on a sign-in that cannot work. Task 4 pins the `503`.
5. **Names containing punctuation must round-trip.** The roster contains honorifics such as `Md.`, so `present` booleans and student IDs must survive the camelCase↔snake_case mapping intact. Task 6 pins the round trip.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/postgres.js` | **Create.** Every SQL statement. Schema init, records read/write, sessions, rate limit. Takes an injected `pg` Pool so tests can supply one. |
| `server/app.js` | **Create.** `/api/*` request handling: routing, origin allowlist, scrypt auth, JSON parse, size cap, status codes. Takes a `store`; no SQL. |
| `api/index.js` | **Create.** Vercel entry. Builds Pool + store + handler once per instance, exports the default handler. |
| `server/index.js` | **Delete** at the end of Task 8, after its behaviour is fully covered. It is the SQLite implementation being replaced. |
| `tests/helpers/postgres.js` | **Create.** Creates a uniquely-named schema, returns a Pool pinned to it, and drops the schema on teardown. |
| `tests/postgres.test.js` | **Create.** Data-layer tests against real Postgres. |
| `tests/app.test.js` | **Create.** Handler tests against an in-memory fake store — no database. |
| `tests/server.test.js` | **Rewrite.** The existing integration assertions, now against Postgres. |
| `vercel.json` | **Modify.** Add the `/api/*` rewrite; keep static config and headers. |
| `web/app.js` | **Modify.** Auto-detect the same-origin API. |
| `.github/workflows/pages.yml` | **Modify.** Add a Postgres service container. |
| `Dockerfile` | **Modify.** Connect via `DATABASE_URL` instead of a SQLite volume. |
| `README.md`, `WEB_GUIDE.md` | **Modify.** Update the backend and self-hosting sections. |
| `package.json` | **Modify.** Add `pg`; add a `start` script that serves the API locally. |

---

### Task 1: Probe Vercel function detection and routing (throwaway)

This task exists because the spec's first known risk is unverified: the project sets `buildCommand: null` and `framework: null`, and it is unknown whether Vercel still detects and bundles `api/` functions under those settings, or how `/api/*` reaches a single function. **Nothing in this task is kept except its answer.**

**Files:**
- Create: `api/probe.js` (deleted at the end of this task)

**Interfaces:**
- Consumes: nothing.
- Produces: a recorded answer — the working mechanism for reaching one function at all `/api/*` paths, and the export shape Vercel accepts.

- [ ] **Step 1: Create the probe function**

```js
// api/probe.js
export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ok: true, url: req.url, method: req.method}));
}
```

- [ ] **Step 2: Deploy the probe as a preview**

```bash
cd /d/vc/Attendence-Tracking
vercel deploy --yes 2>&1 | tail -5
```

Expected: a preview URL is printed. Record it.

- [ ] **Step 3: Test the direct path before adding any rewrite**

```bash
curl -s https://<preview-url>/api/probe
curl -s -o /dev/null -w "%{http_code}\n" https://<preview-url>/api/probe/nested
```

Expected: `/api/probe` returns either `200` with the JSON body (Vercel detected `api/` and file-based routing is active) or `404` (functions were not detected, or the path is not mapped). **Record whichever actually happens** — this one fact decides Step 4. Do not assume.

- [ ] **Step 4: Test an explicit rewrite**

Add the rewrite and redeploy, then re-test.

```json
"rewrites": [
  { "source": "/api/:path*", "destination": "/api/probe" }
]
```

```bash
curl -s https://<preview-url>/api/probe
curl -s https://<preview-url>/api/probe/anything
curl -s -o /dev/null -w "static still served: %{http_code}\n" https://<preview-url>/
curl -s -o /dev/null -w "missing static: %{http_code}\n" https://<preview-url>/nope.txt
```

Expected: both `/api/probe` and `/api/probe/anything` return the JSON body; the root returns `200`; `/nope.txt` returns `404`. If the rewrite swallows static routes, try a catch-all function file `api/[...route].js` instead and re-test.

- [ ] **Step 5: Record the answer**

Write the confirmed mechanism into the spec's Known Risks section as resolved, replacing risk 1's text with the mechanism that worked. Delete the probe:

```bash
rm api/probe.js
git add api/probe.js docs/superpowers/specs/2026-09-25-vercel-postgres-backend-design.md
git commit -m "Settle Vercel api/ function detection and routing mechanism"
```

- [ ] **Step 6: Remove the provisional rewrite**

```bash
git checkout vercel.json
```

The real rewrite is added in Task 8 once the real entry point exists.

---

### Task 2: Provision Neon Postgres

**This task requires the user.** The Vercel Marketplace integration cannot be installed from the CLI. Do not skip ahead: Tasks 3, 6, and 7 need a live `DATABASE_URL`.

**Files:** none.

**Interfaces:**
- Consumes: nothing.
- Produces: `DATABASE_URL` in the Vercel project's environment, and in `.env.local` on this machine via `vercel env pull`.

- [ ] **Step 1: User installs Neon from the Vercel Marketplace**

The user does this in a browser:

1. Open the `rollcall` project in Vercel → **Storage** → **Create Database** → **Neon**
2. Choose the free plan and the region closest to the project
3. Connect it to the `rollcall` project, targeting **all** environments

- [ ] **Step 2: Pull the environment locally without exposing the secret**

```bash
cd /d/vc/Attendence-Tracking
vercel env pull .env.local --yes 2>&1 | tail -5
grep -c DATABASE_URL .env.local
```

Expected: `1`. `.env.local` is already git-ignored via `.env*`. **Do not print the file.** Confirm it is ignored:

```bash
git check-ignore -v .env.local
```

Expected: a `.gitignore:7:.env*` line, confirming it cannot be committed.

- [ ] **Step 3: Confirm the database is reachable and empty**

```bash
cd /d/vc/Attendence-Tracking
node --env-file=.env.local -e "
import('pg').then(async({Pool})=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  const {rows}=await pool.query('SELECT current_database(), current_user, version()');
  console.log('database:',rows[0].current_database);
  const t=await pool.query(\"SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'\");
  console.log('public tables:',t.rows[0].n);
  await pool.end();
}).catch(e=>{console.error('FAILED:',e.message);process.exit(1)});"
```

Expected: prints the database name and `public tables: 0`, then exits 0. A connection failure here means the pull did not work — fix before continuing.

- [ ] **Step 4: Install the driver**

```bash
npm install pg
git add package.json package-lock.json
git commit -m "Add pg driver for Postgres access"
```

---

### Task 3: Postgres data layer

**Files:**
- Create: `server/postgres.js`
- Create: `tests/helpers/postgres.js`
- Test: `tests/postgres.test.js`

**Interfaces:**
- Consumes: a `pg` `Pool`.
- Produces:
  - `createStore(pool)` → object with `init()`, `listRecords()`, `insertRecords(rows)`, `createSession(tokenHash, expiresAt)`, `getSession(tokenHash)`, `deleteSession(tokenHash)`, `registerAttempt(windowStart)`, `close()`
  - `hashToken(token)` → hex SHA-256 string
  - `listRecords()` → `Array<{studentId, courseCode, date, timeSlot, present}>`
  - `insertRecords(rows)` → resolves `undefined`; throws `Error` with `.code === 'DUPLICATE'` on unique violation
  - `createTestDatabase()` (helper) → `{pool, schema, drop()}`
  - `init()` must be called before any other method; the other methods call it themselves, so callers do not have to.

- [ ] **Step 1: Write the test helper**

```js
// tests/helpers/postgres.js
import {Pool} from 'pg';
import {randomBytes} from 'node:crypto';

export function requireDatabaseUrl(){
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if(!url){
    throw Error(
      'These tests need a Postgres database. Set DATABASE_URL (for example via ' +
      '`vercel env pull .env.local` and `node --env-file=.env.local ...`) or ' +
      'TEST_DATABASE_URL. CI supplies one as a service container.'
    );
  }
  return url;
}

export async function createTestDatabase(){
  const url = requireDatabaseUrl();
  const schema = 'test_' + randomBytes(8).toString('hex');
  const admin = new Pool({connectionString: url});
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({connectionString: url, options: `-c search_path=${schema}`});
  return {
    pool,
    schema,
    async drop(){
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  };
}
```

The schema is created fresh per run and dropped at the end, so these tests never touch `public.records`. The unqualified table names in `server/postgres.js` resolve inside that schema because `search_path` is pinned on the Pool.

- [ ] **Step 2: Write the failing data-layer tests**

```js
// tests/postgres.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore, hashToken} from '../server/postgres.js';
import {createTestDatabase} from './helpers/postgres.js';

// Values must match the real catalog: EEE-1121 meets Saturday at 11:30 AM.
const row = (over = {}) => ({
  studentId: 'C251027', courseCode: 'EEE-1121', date: '06-09-2025',
  timeSlot: '11:30 AM', present: true, ...over
});

test('schema init is idempotent and records round-trip', async () => {
  const db = await createTestDatabase();
  const store = createStore(db.pool);
  try {
    await store.init();
    await store.init();
    assert.deepEqual(await store.listRecords(), []);
    await store.insertRecords([row()]);
    assert.deepEqual(await store.listRecords(), [row()]);
  } finally { await db.drop(); }
});

test('duplicate insert throws DUPLICATE and writes nothing', async () => {
  const db = await createTestDatabase();
  const store = createStore(db.pool);
  try {
    await store.insertRecords([row()]);
    await assert.rejects(
      () => store.insertRecords([row()]),
      (e) => e.code === 'DUPLICATE'
    );
    assert.equal((await store.listRecords()).length, 1);
  } finally { await db.drop(); }
});

test('a duplicate midway through a batch rolls the whole batch back', async () => {
  const db = await createTestDatabase();
  const store = createStore(db.pool);
  try {
    await store.insertRecords([row()]);
    await assert.rejects(
      () => store.insertRecords([row({date: '07-09-2025'}), row()]),
      (e) => e.code === 'DUPLICATE'
    );
    const all = await store.listRecords();
    assert.equal(all.length, 1, 'the 07-09 row must not survive the rollback');
  } finally { await db.drop(); }
});

test('sessions store only hashes and can be revoked', async () => {
  const db = await createTestDatabase();
  const store = createStore(db.pool);
  try {
    const until = Date.now() + 3600_000;
    await store.createSession(hashToken('tok-a'), until);
    await store.createSession(hashToken('tok-b'), until);
    assert.equal(await store.getSession(hashToken('tok-a')), until);
    await store.deleteSession(hashToken('tok-a'));
    assert.equal(await store.getSession(hashToken('tok-a')), null);
    assert.equal(await store.getSession(hashToken('tok-b')), until,
      'revoking one session must not affect another');
    const raw = await db.pool.query('SELECT token_hash FROM sessions');
    assert.ok(!raw.rows.some(r => r.token_hash === 'tok-a'),
      'the raw token must never be stored');
  } finally { await db.drop(); }
});

test('registerAttempt counts upward within one window', async () => {
  const db = await createTestDatabase();
  const store = createStore(db.pool);
  try {
    const w = 1_790_000_000_000;
    assert.equal(await store.registerAttempt(w), 1);
    assert.equal(await store.registerAttempt(w), 2);
    assert.equal(await store.registerAttempt(w + 60_000), 1);
  } finally { await db.drop(); }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd /d/vc/Attendence-Tracking
node --env-file=.env.local --test tests/postgres.test.js 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../server/postgres.js'`.

- [ ] **Step 4: Write the data layer**

```js
// server/postgres.js
import {createHash} from 'node:crypto';

const SCHEMA_SQL = `
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
);`;

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function createStore(pool){
  let ready;
  const init = () => (ready ??= pool.query(SCHEMA_SQL).then(() => undefined));

  return {
    init,
    async listRecords(){
      await init();
      const {rows} = await pool.query(
        `SELECT student_id, course_code, date, time_slot, present
           FROM records
          ORDER BY student_id, course_code, date, time_slot`);
      return rows.map(r => ({
        studentId: r.student_id, courseCode: r.course_code,
        date: r.date, timeSlot: r.time_slot, present: r.present
      }));
    },
    async insertRecords(rows){
      await init();
      const client = await pool.connect();
      try{
        await client.query('BEGIN');
        for(const r of rows){
          await client.query(
            `INSERT INTO records (student_id, course_code, date, time_slot, present)
             VALUES ($1, $2, $3, $4, $5)`,
            [r.studentId, r.courseCode, r.date, r.timeSlot, r.present]);
        }
        await client.query(
          `INSERT INTO audit (at, event, count) VALUES (NOW(), 'records.import', $1)`,
          [rows.length]);
        await client.query('COMMIT');
      }catch(e){
        await client.query('ROLLBACK');
        if(e.code === '23505'){
          const dup = Error('Attendance already exists for a student in this session.');
          dup.code = 'DUPLICATE';
          throw dup;
        }
        throw e;
      }finally{
        client.release();
      }
    },
    async createSession(tokenHash, expiresAt){
      await init();
      await pool.query(
        'INSERT INTO sessions (token_hash, expires_at) VALUES ($1, $2)',
        [tokenHash, expiresAt]);
    },
    async getSession(tokenHash){
      await init();
      const {rows} = await pool.query(
        'SELECT expires_at FROM sessions WHERE token_hash = $1', [tokenHash]);
      return rows.length ? Number(rows[0].expires_at) : null;
    },
    async deleteSession(tokenHash){
      await init();
      await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    },
    async registerAttempt(windowStart){
      await init();
      const {rows} = await pool.query(
        `INSERT INTO login_attempts (window_start, attempts) VALUES ($1, 1)
         ON CONFLICT (window_start)
         DO UPDATE SET attempts = login_attempts.attempts + 1
         RETURNING attempts`, [windowStart]);
      return rows[0].attempts;
    },
    close(){ return pool.end(); }
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
node --env-file=.env.local --test tests/postgres.test.js 2>&1 | tail -20
```

Expected: PASS, 5 tests. If they fail with `3D000` or `42P01`, the `search_path` option is not reaching the Pool — confirm the helper passes `options`.

- [ ] **Step 6: Verify no test tables leak into production**

```bash
node --env-file=.env.local -e "
import('pg').then(async({Pool})=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  const {rows}=await pool.query(\"SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema LIKE 'test_%'\");
  console.log('leftover test schemas:',rows.length);
  await pool.end();
}).catch(e=>{console.error(e.message);process.exit(1)});"
```

Expected: `leftover test schemas: 0`.

- [ ] **Step 7: Commit**

```bash
git add server/postgres.js tests/postgres.test.js tests/helpers/postgres.js
git commit -m "Add Postgres data layer with schema-isolated tests"
```

---

### Task 4: Storage-agnostic request handler

**Files:**
- Create: `server/app.js`
- Test: `tests/app.test.js`

**Interfaces:**
- Consumes: `store` with the Task 3 shape, `password`, `allowedOrigins`.
- Produces: `createHandler({store, password, allowedOrigins = []})` → `async (req, res) => void`, usable directly as a Node `http` request listener and as a Vercel Node function. Also `MAX_BODY = 20_000_000` and `RATE_WINDOW_MS = 60_000`, `RATE_LIMIT = 15`.

- [ ] **Step 1: Write the failing handler tests against a fake store**

```js
// tests/app.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHandler} from '../server/app.js';
import {catalog} from '../web/catalog.js';
import {makeSession} from '../web/core.js';

const PASSWORD = 'test-password-for-local-tests';

function fakeStore(){
  const records = [], sessions = new Map(), attempts = new Map();
  return {
    records, sessions, attempts,
    async init(){},
    async listRecords(){ return [...records]; },
    async insertRecords(rows){
      for(const r of rows){
        const dup = records.some(x =>
          x.studentId === r.studentId && x.courseCode === r.courseCode &&
          x.date === r.date && x.timeSlot === r.timeSlot);
        if(dup){ const e = Error('dup'); e.code = 'DUPLICATE'; throw e; }
      }
      records.push(...rows);
    },
    async createSession(h, exp){ sessions.set(h, exp); },
    async getSession(h){ return sessions.has(h) ? sessions.get(h) : null; },
    async deleteSession(h){ sessions.delete(h); },
    async registerAttempt(w){ const n = (attempts.get(w) || 0) + 1; attempts.set(w, n); return n; }
  };
}

async function withServer(run, opts = {}){
  const store = opts.store || fakeStore();
  const handler = createHandler({store, password: PASSWORD, ...opts});
  const server = http.createServer(handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const req = (path, body, token, origin) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? {Authorization: 'Bearer ' + token} : {}),
      ...(origin ? {Origin: origin} : {})
    },
    ...(body === undefined ? {} : {body: JSON.stringify(body)})
  });
  try { return await run({store, req, base}); }
  finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
}

const sessionRows = () => makeSession([], catalog.routine[0], '06-09-2025',
  Object.fromEntries(catalog.students.map(s => [s.id, true])));

test('password shorter than 16 characters is refused at construction', () => {
  assert.throws(() => createHandler({store: fakeStore(), password: 'short'}),
    /at least 16 characters/);
});

test('health is public and reports the store is usable', async () => {
  await withServer(async ({req}) => {
    const res = await req('/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {ok: true});
  });
});

test('health reports 503 when the database is unreachable', async () => {
  const broken = {...fakeStore(), async init(){ throw Error('connection refused'); }};
  await withServer(async ({req}) => {
    const res = await req('/api/health');
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), {ok: false});
  }, {store: broken});
});

test('records require a session, and login rejects a wrong password', async () => {
  await withServer(async ({req}) => {
    assert.equal((await req('/api/records')).status, 401);
    assert.equal((await req('/api/login', {password: 'nope'})).status, 401);
  });
});

test('login, write, read and logout form a working loop', async () => {
  await withServer(async ({req}) => {
    const {token} = await (await req('/api/login', {password: PASSWORD})).json();
    assert.equal((await req('/api/records', {records: sessionRows()}, token)).status, 201);
    const listed = await (await req('/api/records', undefined, token)).json();
    assert.equal(listed.records.length, 45);
    assert.equal((await req('/api/logout', {}, token)).status, 200);
    assert.equal((await req('/api/records', undefined, token)).status, 401);
  });
});

test('a duplicate import returns 409 and leaves records untouched', async () => {
  await withServer(async ({req, store}) => {
    const {token} = await (await req('/api/login', {password: PASSWORD})).json();
    await req('/api/records', {records: sessionRows()}, token);
    const again = await req('/api/records', {records: sessionRows()}, token);
    assert.equal(again.status, 409);
    assert.equal(store.records.length, 45);
  });
});

test('an expired session is rejected', async () => {
  await withServer(async ({req, store}) => {
    const {token} = await (await req('/api/login', {password: PASSWORD})).json();
    for(const [h, exp] of store.sessions) store.sessions.set(h, exp - 9 * 3600_000);
    assert.equal((await req('/api/records', undefined, token)).status, 401);
  });
});

test('origin outside the allowlist is rejected, same-origin is allowed', async () => {
  await withServer(async ({req, base}) => {
    assert.equal((await req('/api/health', undefined, undefined, 'https://evil.example')).status, 403);
    assert.equal((await req('/api/health', undefined, undefined, base)).status, 200);
  });
});

test('the 16th login attempt in a window returns 429', async () => {
  await withServer(async ({req}) => {
    for(let i = 0; i < 15; i++) await req('/api/login', {password: 'nope'});
    assert.equal((await req('/api/login', {password: 'nope'})).status, 429);
  });
});

test('malformed JSON is 400 and a wrong content type is 415', async () => {
  await withServer(async ({req, base}) => {
    const bad = await fetch(base + '/api/login', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{oops'
    });
    assert.equal(bad.status, 400);
    const wrong = await fetch(base + '/api/login', {
      method: 'POST', headers: {'Content-Type': 'text/plain'}, body: 'x'
    });
    assert.equal(wrong.status, 415);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test tests/app.test.js 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../server/app.js'`.

- [ ] **Step 3: Write the handler**

```js
// server/app.js
import {randomBytes, scryptSync, timingSafeEqual} from 'node:crypto';
import {validateRecords} from '../web/core.js';
import {hashToken as hashTokenOf} from './postgres.js';

export const MAX_BODY = 20_000_000;
export const RATE_WINDOW_MS = 60_000;
export const RATE_LIMIT = 15;
const SESSION_MS = 8 * 3600_000;

export function createHandler({store, password, allowedOrigins = []}){
  if(!password || password.length < 16) throw Error('Set ADMIN_PASSWORD to at least 16 characters.');
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  const allowed = new Set(allowedOrigins.filter(Boolean));

  return async function handler(req, res){
    const send = (code, data) => {
      res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify(data));
    };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');

    const path = new URL(req.url, 'http://localhost').pathname;
    const origin = req.headers.origin;
    if(origin){
      let sameOrigin = false;
      try { sameOrigin = new URL(origin).host === req.headers.host; } catch { sameOrigin = false; }
      if(!sameOrigin && !allowed.has(origin)) return send(403, {error: 'Origin is not allowed.'});
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if(req.method === 'OPTIONS'){
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.writeHead(204);
      return res.end();
    }

    try{
      if(path === '/api/health' && req.method === 'GET'){
        try{
          await store.init();
        }catch{
          return send(503, {ok: false, error: 'Database unavailable.'});
        }
        return send(200, {ok: true});
      }

      let body;
      if(req.method === 'POST'){
        if(!req.headers['content-type']?.startsWith('application/json'))
          return send(415, {error: 'Expected application/json.'});
        const chunks = [];
        let size = 0;
        for await (const chunk of req){
          size += chunk.length;
          if(size > MAX_BODY) return send(413, {error: 'Request too large.'});
          chunks.push(chunk);
        }
        try { body = JSON.parse(Buffer.concat(chunks).toString()); }
        catch { return send(400, {error: 'Invalid JSON.'}); }
      }

      if(path === '/api/login' && req.method === 'POST'){
        const windowStart = Math.floor(Date.now() / RATE_WINDOW_MS) * RATE_WINDOW_MS;
        const attempts = await store.registerAttempt(windowStart);
        if(attempts > RATE_LIMIT)
          return send(429, {error: 'Too many login attempts. Try again in one minute.'});
        if(typeof body?.password !== 'string' || body.password.length > 1024 ||
           !timingSafeEqual(hash, scryptSync(body.password, salt, 64)))
          return send(401, {error: 'Incorrect password.'});
        const token = randomBytes(32).toString('hex');
        await store.createSession(hashTokenOf(token), Date.now() + SESSION_MS);
        return send(200, {token, expiresIn: SESSION_MS / 1000});
      }

      const token = req.headers.authorization?.replace(/^Bearer /, '') || '';
      const tokenHash = hashTokenOf(token);
      const expiresAt = token ? await store.getSession(tokenHash) : null;
      if(!expiresAt || expiresAt < Date.now())
        return send(401, {error: 'Session expired. Sign in again.'});

      if(path === '/api/logout' && req.method === 'POST'){
        await store.deleteSession(tokenHash);
        return send(200, {ok: true});
      }
      if(path === '/api/records' && req.method === 'GET'){
        return send(200, {records: await store.listRecords()});
      }
      if(path === '/api/records' && req.method === 'POST'){
        let rows;
        try{
          rows = validateRecords(body?.records);
          if(!rows.length) throw Error('No records supplied.');
        }catch(e){ return send(400, {error: e.message}); }
        try{
          await store.insertRecords(rows);
        }catch(e){
          if(e.code === 'DUPLICATE')
            return send(409, {error: 'Duplicate attendance. No records were changed.'});
          throw e;
        }
        return send(201, {inserted: rows.length});
      }
      return send(404, {error: 'Not found.'});
    }catch(e){
      console.error('Request failed:', e.message);
      if(!res.headersSent) send(500, {error: 'The server could not complete this request.'});
      else res.end();
    }
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/app.test.js 2>&1 | tail -20
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Confirm the handler needs no database**

```bash
grep -c "pg\|DATABASE_URL\|pool" server/app.js || echo "0 - no database coupling"
```

Expected: `0 - no database coupling`.

- [ ] **Step 6: Commit**

```bash
git add server/app.js tests/app.test.js
git commit -m "Extract storage-agnostic API handler"
```

---

### Task 5: Vercel function entry point

**Files:**
- Create: `api/index.js`
- Test: `tests/entry.test.js`

**Interfaces:**
- Consumes: `createStore` (Task 3), `createHandler` (Task 4).
- Produces: `buildHandler({databaseUrl, password, allowedOrigins})` → `Promise<handler>`, and a default export `handler(req, res)` for Vercel.

- [ ] **Step 1: Write the failing test**

```js
// tests/entry.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHandler} from '../api/index.js';

test('buildHandler refuses to build without a database url', async () => {
  await assert.rejects(
    () => buildHandler({password: 'test-password-for-local-tests'}),
    /DATABASE_URL/);
});

test('buildHandler refuses a short password', async () => {
  await assert.rejects(
    () => buildHandler({databaseUrl: 'postgres://localhost/x', password: 'short'}),
    /at least 16 characters/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/entry.test.js 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../api/index.js'`.

- [ ] **Step 3: Write the entry point**

```js
// api/index.js
import {Pool} from 'pg';
import {createStore} from '../server/postgres.js';
import {createHandler} from '../server/app.js';

export async function buildHandler({
  databaseUrl = process.env.DATABASE_URL,
  password = process.env.ADMIN_PASSWORD,
  allowedOrigins = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean)
} = {}){
  if(!databaseUrl) throw Error('DATABASE_URL is not set.');
  const pool = new Pool({connectionString: databaseUrl, max: 3});
  return createHandler({store: createStore(pool), password, allowedOrigins});
}

let ready;
export default async function handler(req, res){
  ready ??= buildHandler().catch((e) => { ready = undefined; throw e; });
  return (await ready)(req, res);
}
```

`max: 3` keeps each instance inside Neon's free-tier connection budget. The `ready` promise is cached so the Pool and scrypt hash are built once per warm instance.

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/entry.test.js 2>&1 | tail -10
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add api/index.js tests/entry.test.js
git commit -m "Add Vercel function entry point"
```

---

### Task 6: Rewrite the integration suite against Postgres

**Files:**
- Modify: `tests/server.test.js` (full rewrite)

**Interfaces:**
- Consumes: `createTestDatabase` (Task 3), `createStore` (Task 3), `createHandler` (Task 4).
- Produces: nothing new; this task proves Tasks 3–5 compose.

- [ ] **Step 1: Rewrite the suite**

```js
// tests/server.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHandler} from '../server/app.js';
import {createStore} from '../server/postgres.js';
import {createTestDatabase} from './helpers/postgres.js';
import {catalog} from '../web/catalog.js';
import {makeSession} from '../web/core.js';

const PASSWORD = 'test-password-for-local-tests';

async function start(pool){
  const store = createStore(pool);
  const server = http.createServer(createHandler({store, password: PASSWORD}));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const req = (path, body, token) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? {Authorization: 'Bearer ' + token} : {})
    },
    ...(body === undefined ? {} : {body: JSON.stringify(body)})
  });
  return {server, store, req, base,
    stop: async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); }};
}

test('authenticated API, duplicates, logout and persistence across instances', async () => {
  const db = await createTestDatabase();
  let app = await start(db.pool);
  try{
    assert.equal((await app.req('/api/records')).status, 401);
    assert.equal((await app.req('/api/login', {password: 'wrong'})).status, 401);

    const login = await app.req('/api/login', {password: PASSWORD});
    assert.equal(login.status, 200);
    const {token} = await login.json();

    const rows = makeSession([], catalog.routine[0], '06-09-2025',
      Object.fromEntries(catalog.students.map(s => [s.id, true])));
    assert.equal((await app.req('/api/records', {records: rows}, token)).status, 201);

    const newer = {...rows[0], date: '07-09-2025'};
    assert.equal((await app.req('/api/records', {records: [newer, rows[1]]}, token)).status, 409);
    assert.equal((await (await app.req('/api/records', undefined, token)).json()).records.length, 45);
    assert.equal((await app.req('/api/records', {records: [{...newer, present: 'yes'}]}, token)).status, 400);

    await app.stop();

    // A brand new handler instance over the same database: the session from
    // before must still work, which is the whole point of persisting sessions.
    app = await start(db.pool);
    assert.equal((await (await app.req('/api/records', undefined, token)).json()).records.length, 45);
    assert.equal((await app.req('/api/logout', {}, token)).status, 200);
    assert.equal((await app.req('/api/records', undefined, token)).status, 401);
  } finally {
    await app.stop();
    await db.drop();
  }
});

test('two devices can hold sessions at the same time', async () => {
  const db = await createTestDatabase();
  const app = await start(db.pool);
  try{
    const a = await (await app.req('/api/login', {password: PASSWORD})).json();
    const b = await (await app.req('/api/login', {password: PASSWORD})).json();
    assert.notEqual(a.token, b.token);
    assert.equal((await app.req('/api/records', undefined, a.token)).status, 200);
    assert.equal((await app.req('/api/records', undefined, b.token)).status, 200);
    await app.req('/api/logout', {}, a.token);
    assert.equal((await app.req('/api/records', undefined, a.token)).status, 401);
    assert.equal((await app.req('/api/records', undefined, b.token)).status, 200,
      'logging out one device must not sign out the other');
  } finally { await app.stop(); await db.drop(); }
});

test('record field names round-trip unchanged', async () => {
  const db = await createTestDatabase();
  const app = await start(db.pool);
  try{
    const {token} = await (await app.req('/api/login', {password: PASSWORD})).json();
    const rows = makeSession([], catalog.routine[0], '06-09-2025',
      Object.fromEntries(catalog.students.map(s => [s.id, true])));
    await app.req('/api/records', {records: rows.slice(0, 3)}, token);
    const stored = (await (await app.req('/api/records', undefined, token)).json()).records;
    assert.deepEqual(stored.map(r => Object.keys(r).sort()),
      [['courseCode','date','present','studentId','timeSlot']]);
    assert.deepEqual(stored.sort((x,y)=>x.studentId.localeCompare(y.studentId)),
      rows.slice(0,3).sort((x,y)=>x.studentId.localeCompare(y.studentId)));
  } finally { await app.stop(); await db.drop(); }
});
```

- [ ] **Step 2: Run the suite to verify it passes**

```bash
node --env-file=.env.local --test tests/server.test.js 2>&1 | tail -20
```

Expected: PASS, 3 tests.

- [ ] **Step 3: Run the entire suite**

```bash
node --env-file=.env.local --test tests/*.test.js 2>&1 | tail -20
```

Expected: PASS, 27 tests total — 7 in `core` (verified: `tests/core.test.js` has 7 today) + 5 `postgres` + 10 `app` + 2 `entry` + 3 `server`.

- [ ] **Step 4: Confirm the suite fails loudly without a database**

```bash
node --test tests/postgres.test.js 2>&1 | tail -8
```

Expected: FAIL with the explanatory message from `requireDatabaseUrl()` naming `DATABASE_URL` — proving a misconfigured environment cannot silently pass CI.

- [ ] **Step 5: Commit**

```bash
git add tests/server.test.js
git commit -m "Rewrite integration suite against Postgres"
```

---

### Task 7: Frontend same-origin auto-detection

**Files:**
- Modify: `web/app.js`

**Interfaces:**
- Consumes: `GET /api/health` returning `{ok:true}`.
- Produces: no exported symbols; the app starts in a "built-in storage detected" state when a same-origin API answers.

- [ ] **Step 1: Add the probe and the `builtin` state**

Locate this line near the top of `web/app.js`:

```js
let connected=false, candidateApi='';
```

Replace it with:

```js
let connected=false, candidateApi='', builtin=false;
```

- [ ] **Step 2: Add the detection function**

Insert immediately before the final `render();` line at the bottom of the file:

```js
async function detectBuiltinApi(){
  if(api) return false;
  try{
    const res = await fetch('/api/health', {signal: AbortSignal.timeout(5000)});
    if(!res.ok) return false;
    const data = await res.json();
    return data?.ok === true;
  }catch{ return false; }
}
```

- [ ] **Step 3: Call it on startup and keep the session across reloads**

The final two lines of `web/app.js` are the initial `render();` and a block that reconnects only when `api` is non-empty. A built-in same-origin connection stores `api` as an empty string, so that guard would silently drop a signed-in user back to local records on every reload. It must test the token alone.

Replace both final lines with:

```js
render();
detectBuiltinApi().then(found => { builtin = found; if(found) render(); });
if(token){
  request('/api/records')
    .then(data => { records = validateRecords(data.records); connected = true; render(); })
    .catch(() => toast('Backend session unavailable. Showing local records; reconnect in settings.', true));
}
```

- [ ] **Step 4: Show the built-in state in the settings panel**

In `settingsPage()`, replace the storage-connection paragraph:

```js
<p>${connected?'Records are stored in your authenticated shared backend.':"Records stay in this browser, on this device. Clearing browser data removes them; download backups regularly. Connect the included backend to share records across devices."}</p>
```

with:

```js
<p>${connected?'Records are stored in your authenticated shared backend.':builtin?'A shared backend is available on this site. Sign in to store records server-side and reach them from any device.':'Records stay in this browser, on this device. Clearing browser data removes them; download backups regularly.'}</p>
```

- [ ] **Step 5: Accept an empty backend URL when built-in storage is present**

In the `connect` action, replace the URL parsing:

```js
const u=new URL($('#api').value);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw Error('Use an HTTPS backend URL.');candidateApi=u.origin;
```

with:

```js
const typed=$('#api').value.trim();if(!typed&&builtin){candidateApi='';}else{const u=new URL(typed);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw Error('Use an HTTPS backend URL.');candidateApi=u.origin;}
```

- [ ] **Step 6: Make the URL field optional in the markup**

In the same panel, replace:

```js
<label>Backend URL<input id="api" type="url" placeholder="https://your-backend.example.com" value="${esc(api)}"></label>
```

with:

```js
<label>Backend URL${builtin?' (optional — this site has built-in storage)':''}<input id="api" type="url" placeholder="${builtin?'':"https://your-backend.example.com"}" value="${esc(api)}"></label>
```

- [ ] **Step 7: Verify the syntax and existing behaviour**

```bash
node --check web/app.js && echo "syntax OK"
npm test 2>&1 | tail -5
```

Expected: `syntax OK`, and the suite still passes.

- [ ] **Step 8: Commit**

```bash
git add web/app.js
git commit -m "Auto-detect the built-in same-origin API"
```

---

### Task 8: Routing config, CI, Dockerfile, docs, and SQLite removal

**Files:**
- Modify: `vercel.json`
- Modify: `.github/workflows/pages.yml`
- Modify: `Dockerfile`
- Modify: `README.md`, `WEB_GUIDE.md`
- Modify: `package.json`
- Delete: `server/index.js`

**Interfaces:**
- Consumes: everything above.
- Produces: a deployable project.

- [ ] **Step 1: Add the API rewrite using the mechanism Task 1 proved**

In `vercel.json`, add the `rewrites` array at the top level, using the exact form Task 1 confirmed (this example is the rewrite form; substitute the catch-all file mechanism if that is what Task 1 proved):

```json
"rewrites": [
  { "source": "/api/:path*", "destination": "/api" }
],
```

`outputDirectory`, `framework`, `buildCommand`, and `headers` stay exactly as they are. Verify the file still parses:

```bash
node -e "console.log('rewrites:', require('./vercel.json').rewrites.length, '| headers:', require('./vercel.json').headers.length)"
```

- [ ] **Step 2: Delete the SQLite implementation**

```bash
git rm server/index.js
grep -rn "server/index.js" --include=*.js --include=*.json --include=*.yml . || echo "no dangling references"
```

Expected: no dangling references except `package.json`'s `start` script, fixed next.

- [ ] **Step 3: Replace the `start` script**

Replace the `scripts` block in `package.json` with:

```json
"scripts": {
  "start": "node --env-file-if-exists=.env.local scripts/dev-api.js",
  "test": "node --env-file-if-exists=.env.local --test tests/*.test.js",
  "dev": "python3 -m http.server 5173 --directory web"
}
```

- [ ] **Step 4: Add the local API runner**

```js
// scripts/dev-api.js
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve, dirname, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildHandler} from '../api/index.js';

const handler = await buildHandler();
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../web');
const TYPES = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};

http.createServer(async (req, res) => {
  if(req.url.startsWith('/api/')) return handler(req, res);
  const name = req.url === '/' ? 'index.html' : decodeURIComponent(req.url.slice(1));
  try{
    const body = readFileSync(resolve(root, name));
    res.writeHead(200, {'Content-Type': TYPES[extname(name)] + '; charset=utf-8'});
    res.end(body);
  }catch{
    res.writeHead(404, {'Content-Type': 'text/plain'});
    res.end('Not found.');
  }
}).listen(Number(process.env.PORT || 3000), () => console.log('Rollcall dev server on http://localhost:3000'));
```

```bash
node --check scripts/dev-api.js && echo "syntax OK"
```

- [ ] **Step 5: Add the Postgres service container to CI**

In `.github/workflows/pages.yml`, add to the `test` job:

```yaml
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: rollcall_test
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/rollcall_test
```

Keep the existing `actions/checkout`, `actions/setup-node`, `npm test`, and the `node --check web/app.js` step exactly as they are. The deploy job is unchanged.

- [ ] **Step 6: Update the Dockerfile**

Replace the whole file with:

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY web ./web
COPY server ./server
COPY api ./api
COPY scripts ./scripts
USER node
ENV PORT=3000
EXPOSE 3000
CMD ["node", "scripts/dev-api.js"]
```

`DATABASE_URL` and `ADMIN_PASSWORD` are supplied at run time; the SQLite volume and `DB_PATH` are gone.

- [ ] **Step 7: Update the documentation**

In `README.md`: replace the `DB_PATH` bullet with `DATABASE_URL`, state that the backend now requires Postgres, remove the "no npm dependencies" sentence, and note that `api/` is a Vercel Function. In `WEB_GUIDE.md`: replace the GitHub-Pages-only storage paragraph with the same-origin sign-in behaviour, and note that tests need a database.

- [ ] **Step 8: Run everything**

```bash
npm test 2>&1 | tail -10
node --check web/app.js && echo "app.js OK"
node --check scripts/dev-api.js && echo "dev-api OK"
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Wire Vercel routing, CI database, Dockerfile and docs for Postgres"
```

---

### Task 9: Deploy, verify, and promote

**Files:** none.

**Interfaces:**
- Consumes: the deployed preview URL and `ADMIN_PASSWORD`.
- Produces: a verified production deployment.

- [ ] **Step 1: Deploy a preview**

```bash
cd /d/vc/Attendence-Tracking
vercel deploy --yes 2>&1 | tail -5
```

Record the preview URL. Do not promote yet.

- [ ] **Step 2: Verify health before anything else**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<preview-url>/api/health
curl -s https://<preview-url>/api/health
```

Expected: `200` and `{"ok":true}`. A `503` or `500` means `DATABASE_URL` is missing from the preview environment — fix that before continuing, since everything else depends on it.

- [ ] **Step 3: Verify the full API loop. Requires `ADMIN_PASSWORD` set in Vercel first.**

```bash
BASE=https://<preview-url>
TOKEN=$(curl -s -X POST -H 'Content-Type: application/json' -d "{\"password\":\"$ADMIN_PASSWORD\"}" $BASE/api/login | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).token))")
echo "unauth:   $(curl -s -o /dev/null -w '%{http_code}' $BASE/api/records)"
echo "authed:   $(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" $BASE/api/records)"
echo "bad login:$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"password":"wrong"}' $BASE/api/login)"
echo "logout:   $(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $TOKEN" -d '{}' $BASE/api/logout)"
echo "after out:$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" $BASE/api/records)"
```

Expected, in order: `401`, `200`, `401`, `200`, `401`. Any other combination means the auth loop is wrong — stop and diagnose rather than promoting.

- [ ] **Step 4: Verify a real write and the duplicate path**

Write one genuine session using the first routine period, then repeat it.

```bash
node --env-file=.env.local --input-type=module -e "
import {makeSession} from './web/core.js';
import {catalog} from './web/catalog.js';
import {writeFileSync} from 'node:fs';
const rows = makeSession([], catalog.routine[0], '06-09-2025',
  Object.fromEntries(catalog.students.map(s => [s.id, true])));
writeFileSync('/tmp/rows.json', JSON.stringify({records: rows}));
console.log('wrote', rows.length, 'rows');
"
```

```bash
FIRST=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" --data @/tmp/rows.json $BASE/api/records)
SECOND=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" --data @/tmp/rows.json $BASE/api/records)
echo "first: $FIRST  duplicate: $SECOND"
```

Expected: `first: 201  duplicate: 409`. Then confirm the count did not grow:

```bash
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/records | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('records:',JSON.parse(s).records.length))"
```

Expected: `records: 45` — not 90.

- [ ] **Step 5: Confirm the frontend still serves and the old static routes work**

```bash
for p in / /app.js /core.js /catalog.js /styles.css /favicon.svg /nope.txt; do
  printf "%-16s " "$p"
  curl -s -o /dev/null -w "%{http_code}\n" $BASE$p
done
```

Expected: `200` for the six real files, `404` for `/nope.txt`. A `200` on `/nope.txt` means the API rewrite is swallowing static routes — fix before promoting.

- [ ] **Step 6: Ask the user to confirm sign-in in a browser**

This step cannot be done by curl and cannot be skipped. Ask the user to open the preview URL, go to **Data & settings**, and sign in with `ADMIN_PASSWORD`, then report whether it connects.

- [ ] **Step 7: Promote to production**

```bash
vercel deploy --prod --yes 2>&1 | tail -5
```

- [ ] **Step 8: Verify production**

```bash
for B in https://rollcall-tahsan1.vercel.app https://rollcall-red.vercel.app; do
  printf "%-40s " "$B"
  curl -s -o /dev/null -w "root=%{http_code} " $B/
  curl -s -o /dev/null -w "health=%{http_code}\n" $B/api/health
done
```

Expected: both aliases return `root=200 health=200`.

- [ ] **Step 9: Commit and push the plan, spec, and implementation**

```bash
cd /d/vc/Attendence-Tracking
git add -A
git commit -m "Ship Postgres-backed API on Vercel" || echo "nothing to commit"
git push origin main
```

---

## Notes for the implementer

- **Do not run `npm test` against production data.** The suite isolates itself in a `test_*` schema and drops it. If you see a test creating tables in `public`, stop — the `search_path` option is not being applied.
- **`ADMIN_PASSWORD` is required for every deployed environment.** A missing or short password makes `buildHandler` throw, which surfaces as a `500` on every API route, including `/api/health`.
- **Task 2 needs the user.** Do not attempt to install the Neon integration from the CLI.
- **Task 1's probe is throwaway.** If it is ever reused as product code, stop and re-classify.
