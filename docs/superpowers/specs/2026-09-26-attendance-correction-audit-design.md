# Rollcall — Attendance correction and audit history

**Date:** 2026-09-26
**Status:** Approved design, awaiting spec review
**Scope:** Cycle B — the requester's Phase 3 (allow attendance correction, with an audit trail)

## Purpose

Cycle A deliberately kept saved sessions read-only, because duplicate rejection
was the only thing protecting the records. That protection is right but
incomplete: a teacher who mistaps, or who marks a class before an expected
student arrives, currently has no repair path except re-taking the class — and a
session saved as *partial* can never be completed at all.

This cycle makes saved sessions correctable and keeps a permanent, honest record
of every change: who changed what, when, from which value to which, and why.

Success is: a mistap is fixable in seconds without touching the original history,
a partial session can be completed, and months later the teacher can open any
session and see exactly what happened to it.

Audience is unchanged: one teacher, one section, browser storage by default with
a shared backend as the connected mode.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| What a correction may change | Present↔Absent for marked students, plus filling in students who were left unmarked | Repairs the partial sessions cycle A created; nothing is ever deleted |
| Record model | Update in place, log the change | One row per student per session, so every percentage and export keeps its current shape |
| Audit scope | Every write — saves, imports and corrections | A session's history becomes a complete story, not just the edits |
| Reasons | Marked incorrectly, Student arrived late, Administrative correction, Other | Exactly the requester's list; Other requires a note |
| Editing UX | Edit in place on the register; audit derived from the diff | Repairing a partial session stays the same gesture as marking one |
| History placement | Register (marker + link) and Reports (per-row link) | Visible where the class is fixed and where sessions are reviewed |
| Sessions older than this update | Shown honestly: "No history for this session" | The app does not know when those sessions were taken; inventing a timestamp would falsify the log |
| Actor | Server derives `Administrator`; browser mode uses `This browser` | The client never asserts identity, so accounts can slot in later |

## Non-goals

- No deleting a session or a student's row (the requester declined this)
- No accounts, roles or per-user permissions — the actor stays a label
- No timed late-arrival flow (arrival times are not recorded anywhere)
- No undo UI: the history is the record, and a further correction is the fix
- No Postgres migration; the planned Vercel work is untouched
- No dashboard or visual-system work (cycle C)

## Core API (`web/core.js`)

All of it pure, deterministic, and unit-tested. **`at` and `actor` are always
passed in** — core never reads the clock, so every case is reproducible.

```js
correctionReasons = ['Marked incorrectly','Student arrived late','Administrative correction','Other']

diffSession(records, {courseCode,date,timeSlot}, marks, students)
  → [{studentId, from: true|false|null, to: true|false}]
  // only real differences; from === null means the student had no row

validateCorrection(records, {courseCode,date,timeSlot,changes,reason,note,actor,at})
  → normalised correction, or throws with a human message

applyCorrection(records, correction)
  → { records, entry }
  // updates existing rows by exact key, inserts rows for newly marked students,
  // never deletes, never mutates its input, returns a new array

sessionEntry(records, {courseCode,date,timeSlot}, {at,actor}) → save entry
importEntry(rows, {at,actor})                                 → import entry
sessionHistory(audit, {courseCode,date,timeSlot})             → entries, newest first
```

Validation rules (`validateCorrection` rejects, with these messages):

| Condition | Message |
|---|---|
| Session has no saved rows | `This session has no saved attendance to correct.` |
| `changes` empty | `Nothing changed, so there is nothing to correct.` |
| Unknown or duplicated student id | `Unknown student in this correction.` |
| `to` not a boolean | `Each change needs a present or absent value.` |
| No actual difference from stored records | `Nothing changed, so there is nothing to correct.` |
| Reason missing or not one of the four | `Choose a correction reason.` |
| Reason is Other without a note | `Describe the reason when you choose Other.` |
| Note longer than 200 characters | `Keep the note under 200 characters.` |
| `at` missing or not ISO 8601 | `Corrections need a timestamp.` |

Actor defaults to `This browser` and is capped at 60 characters.

## Audit entry shapes

```js
// one correction = one entry, so the reason is stored once and reads as one event
{ kind:'correction', at, actor, courseCode, date, timeSlot, reason, note,
  changes:[{studentId, from:true|false|null, to:true|false}] }

{ kind:'save',   at, actor, courseCode, date, timeSlot, tally:{present,absent,unmarked} }
{ kind:'import', at, actor, count }
```

Browser mode keeps them in `rollcall-audit-v1` as an array, next to
`rollcall-records-v1`. The server keeps them in a new `audit_log` table.

## Storage

**Browser mode.** Records are written first, then the audit entry, both under the
existing `navigator.locks` key. A crash between the two writes can lose one log
line; it can never corrupt or lose attendance. This asymmetry is deliberate: a
missing log line is recoverable by hand, a half-written record set is not.

If the stored audit cannot be read at boot, editing is disabled with
`Saved history could not be read. Export a backup before editing.` and the
unreadable value is left untouched so a backup can still rescue it. This mirrors
the existing `loadError` behaviour for records.

**Backups.** The JSON backup becomes `{version:2, records, audit}`. Import
accepts both shapes: a bare array (old backups, records only) or the v2 object.
Importing the old shape leaves history untouched. This is the only format change,
and it exists so that a device change does not silently discard the audit trail.

**C++ interchange** (`attendance_data.txt`) stays records-only; the format has no
place for history and its round trip is unchanged.

**Server.** A new table, and the write-only `audit` table stops receiving writes
(nothing reads it; `audit_log` carries more for the same event):

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('save','import','correction')),
  course_code TEXT,
  date        TEXT,
  time_slot   TEXT,
  reason      TEXT,
  note        TEXT,
  present     INTEGER,
  absent      INTEGER,
  unmarked    INTEGER,
  count       INTEGER,
  changes     TEXT
);
```

Every statement stays inside the storage layer, so the planned Postgres port
remains mechanical.

## Register and correction flow

**Locked session.** The notice reports the recorded history instead of warning
about read-only: `Taken 26-09-2026 11:52 by Administrator`, plus an `Edited` chip
and a `History` link when corrections exist. The save bar's disabled button
becomes **Edit attendance**. Sessions with no log entries show
`No history for this session — it was taken before history recording was added.`

**Editing.** `editing` state on the register: the recorded marks load as green and
red flags, unmarked students keep their amber chips, all marking controls work
including Mark all Present / Mark all Absent, and the bar reads
`Editing · nothing is written until you confirm` with **Save changes** and
**Discard changes**. Save changes is disabled while the diff is empty. Discard
changes restores the stored values and returns to the locked view; discarding or
navigating away with an unsaved diff confirms first, using the existing pattern.

**In-progress edits survive re-renders.** Marks are restored from the stored
session when the session is opened or edit mode begins — **never on a re-render
while editing**. Cycle A's `attendance()` restores marks on every render while a
session is saved, which would silently discard a half-finished correction on any
re-render (a storage event from another tab, a return to the view, a filter
toggle); the edit path must keep the accumulating diff instead.

**Guards.** Edit attendance is unavailable while a sample preview is open or when
the stored records failed to load, matching the existing save block, and history
that cannot be read blocks editing entirely (see Storage).

**Confirming.** The review dialog is reused with a before→after diff list
(`Sultan Mahmud  Absent → Present`, `Md. Zunaed Rahman Afif  unmarked → Present`),
the Present/Absent/Unmarked grid, a required reason select that starts on
`Choose a reason…`, and a note field that appears only for Other and is required
there. Buttons: `Back to roster` and `Save correction`.

**After saving.** The session returns to its locked view with the new values, an
`Edited` chip, and a toast naming the count, e.g.
`Correction saved — 2 students updated.`

**History dialog.** Same pattern as the student profile. Entries newest first:

```
Taken      26-09-2026 11:52  Administrator
Corrected  26-09-2026 14:03  Administrator · Marked incorrectly
             Sultan Mahmud          Absent → Present
             Md. Zunaed Rahman Afif  unmarked → Present
Imported   24-09-2026 09:10  Administrator · 45 records
```

Reachable from the register and from a new History link on each row of the Saved
sessions table in Reports, which also marks corrected sessions as `Edited`.

## Server endpoints

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/api/audit?courseCode&date&timeSlot` | Entries, newest first; filters optional |
| `POST` | `/api/corrections` | Validates against the saved session via the shared core, then updates rows, inserts newly marked students and writes the audit entry in **one transaction**; returns `{changed, entry}` |
| `POST` | `/api/records` | Unchanged behaviour, now also logs: a `save` entry with the tally when the batch is a single session, an `import` entry with the count otherwise |

Both new routes require the existing bearer session (401 otherwise). The actor is
derived server-side as `Administrator`; a client-supplied actor is ignored. A
correction against a session with no rows returns 404; validation failures return
400 with the core's message.

The SQL performs the same semantics `applyCorrection` performs in memory: update
rows by exact key, insert only previously unmarked students, never delete. The
rules stay in `web/core.js`; only the persistence mechanism differs, so the
browser and server paths cannot drift.

## Files touched

- `web/core.js` — diff/validate/apply/history plus entry builders and reason list
- `web/app.js` — locked-state notice, Edit attendance, edit mode, review dialog reason step, history dialog, Reports History column, backup v2
- `web/styles.css` — edit-mode and history styling, appended in a readable block
- `server/index.js` — `audit_log`, the two routes, save/import logging
- `tests/core.test.js`, `tests/server.test.js` — see below
- `README.md`, `WEB_GUIDE.md` — correction, reasons, history, backup v2
- Carried over from the cycle A review: the self-defeating register hint copy and the dead `.registersummary` rule

## Testing

**Core:** diffSession (flip, fill from unmarked, unchanged excluded, unaffected
students absent from the result); validateCorrection (every rejection in the
table above, plus the accepted cases and the Other-with-note path);
applyCorrection (updates in place, inserts only newly marked students, never
deletes a row, returns a new array and leaves the input untouched, entry shape
with `from: null` for filled students, and two corrections produce two entries);
sessionHistory (filters to one session, newest first); sessionEntry and
importEntry shapes.

**Server:** correction happy path with audit read-back; 401 without a session;
400 for a bad reason, Other without a note and an unknown student; 404 for a
session with no rows; correcting the same student twice yields two entries and
the latest record; `POST /api/records` logs `save` for a single-session batch and
`import` for a mixed batch; the composite unique key still rejects a true
duplicate after a correction.

**Browser:** the harness gains the edit loop — locked session offers Edit;
editing shows recorded marks; Save changes is disabled with no diff; the dialog
lists the diff, blocks Other without a note, and blocks a missing reason; saving
writes the correction, the record shows the new value, the `Edited` chip and
`History` appear, and the history dialog lists both the save and the correction.
A real-browser sweep confirms the same against a seeded session.

## Acceptance criteria

1. A saved session can be corrected without re-taking the class, including
   filling in students who were left unmarked.
2. Saving a correction is impossible without a reason; choosing Other is
   impossible without a note.
3. Saving with no differences from the stored session is impossible.
4. Every correction records previous value, new value, timestamp, actor and
   reason, and is listable per session, newest first.
5. No correction path deletes attendance; duplicate protection still holds.
6. Existing records, old JSON backups and `attendance_data.txt` files still load,
   and a v2 backup restores both records and history.

## Risks

| Risk | Mitigation |
|---|---|
| Browser mode's two-key write is not atomic | Records first, audit second; a lost log line never corrupts attendance, and the shared backend path is fully transactional |
| Sessions recorded before this update have no history | Stated plainly in the UI rather than backfilled with invented timestamps |
| `actor` is a label, not an identity | Derived server-side, never client-supplied; accounts replace it later without a format change |
| Backup format change could strand old backups | Import accepts the old bare-array shape; only new backups use v2 |
| Audit array grows without bound in browser storage | Entries are small and appended per write; a semester of corrections is trivial next to the record set |
| The legacy `audit` table stops receiving writes | Nothing reads it, its information is superseded by `audit_log`, and no migration is required |
