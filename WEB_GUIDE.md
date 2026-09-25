# Rollcall — attendance studio

Rollcall brings the existing C++ attendance system to a responsive website. The original `attendance_system.cpp` and `attendance.csv` remain unchanged.

## GitHub Pages

The `web/` directory is the complete frontend, with relative asset URLs that work under `/Attendence-Tracking/`. The workflow runs tests and publishes only `web/`, never the database or original CSV.

First-time setup: repository **Settings → Pages → Build and deployment → Source → GitHub Actions**. Then open **Actions → Test and deploy Rollcall → Run workflow** (or rerun the failed run). Subsequent pushes to `main` automatically test and deploy.

GitHub Pages hosts static files, not a Node process or database. Without a connected backend, this app is a working single-browser attendance tracker. Records persist in localStorage. The app labels this mode and offers backups. Shared storage requires separately hosting the included backend.

## Preserved rules

| C++ concept | Web implementation |
|---|---|
| 45 students | Exact roster in `web/catalog.js` |
| 8 courses, 23 periods | Exact titles, totals, times and days |
| All present / all absent / individual | Register controls |
| Student + course + date + time slot | Unique key in JS and SQLite |
| Present ÷ classes held | **Current attendance**, drives the status badge |
| Present ÷ fixed course total × 100 | **Semester progress**, capped at 100% |
| 85 / 70 / 60 thresholds | Excellent / Good / Warning / At Risk, plus "No classes yet" when nothing is recorded |
| `attendance_data.txt` | Lossless pipe-delimited import/export |
| Choose day separately from date | Supports rescheduled classes |

A course's **classes held** is the count of distinct `(date, time slot)` sessions with records. A student left unmarked in a session has no present record for it and is treated as absent; saving a session with unmarked students therefore requires the deliberate "Save as partial" path, and a review dialog states the Present, Absent and Unmarked counts before anything is written.

Correctness improvements: real calendar-date validation, validation of every imported row, duplicate checks for every student (not only the first), all-or-nothing imports, atomic database transactions, and removal of the 2,000-record array ceiling. The C++ file itself is retained as a historical reference. It still has its original record limit.

The old `attendance.csv` has a different schema, unrecognized student identifiers and no time slot. It cannot be losslessly mapped to the current system; no fabricated mapping is applied.

## Local preview

Requires Node.js 24+ for the backend/tests. The static frontend can be served with Python:

```sh
npm run dev
# Open http://localhost:5173
npm test
```

There are no npm dependencies or build steps.

## Shared backend

The backend uses Node's SQLite module, a persistent database, eight-hour opaque bearer sessions, scrypt password verification, a login rate limit, an exact CORS origin, and transactional imports. Records cannot be read or written without authentication. Tokens are stored only for the browser tab session. A restart invalidates sessions but retains attendance.

Set these environment variables through your host's secret/environment settings:

- `ADMIN_PASSWORD`: a unique strong password of at least 16 characters; keep it secret.
- `ALLOWED_ORIGIN`: the exact frontend origin, `https://tahasanurkarim-pixel.github.io` for GitHub Pages (no path or trailing slash).
- `DB_PATH`: a path on a persistent volume, such as `/data/attendance.sqlite`.
- `PORT`: your hosting platform's port (default 3000).

Start with `npm start`, or build the included Dockerfile. Mount persistent storage at `/data`. Put the service behind HTTPS using your host or reverse proxy. In the frontend, open **Data & settings**, enter the HTTPS backend URL and sign in. To migrate browser-local records, export them before connecting, then import them after connecting. Nothing is uploaded automatically.

For same-origin local testing set `ALLOWED_ORIGIN=http://localhost:3000` and open the backend's root URL. If using the separate development server, set `ALLOWED_ORIGIN=http://localhost:5173`.

This version supports one administrator workspace. It does not implement independent teacher accounts, role-based permissions, student self-service, password recovery, or automatic offsite backups. Add those before using it as a multi-tenant institutional service. Schedule database backups for any shared deployment. The roster is already in the public source repository; attendance records must remain out of git.

## API

| Method | Endpoint | Authentication |
|---|---|---|
| GET | `/api/health` | Public health status |
| POST | `/api/login` with `{ "password": "…" }` | Returns an expiring token |
| GET | `/api/records` | `Authorization: Bearer <token>` |
| POST | `/api/records` with `{ "records": [...] }` | Authenticated, atomic append |
| POST | `/api/logout` with `{}` | Revokes current token |

Duplicate imports return 409; invalid rows return 400. An insert audit records timestamp and count. The database unique constraint prevents duplicate writes even across concurrent requests.

## Testing

`npm test` checks the exact catalog size, current-attendance and semester-progress semantics, the planned-total cap, boundary thresholds, zero-classes-held handling, classes-held counting, partial sessions, bulk and mixed attendance, duplicate rejection, date validation, file round trips, authentication, origin rejection, transaction rollback, logout and persistence across backend restarts. UI functionality should additionally be checked in a browser before expanding this into an institution-wide deployment.
