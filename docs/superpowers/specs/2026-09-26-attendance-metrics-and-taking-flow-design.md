# Rollcall — Attendance metrics and the attendance-taking flow

**Date:** 2026-09-26
**Status:** Approved design, awaiting spec review
**Scope:** Sub-project A — the requester's Phase 1 (fix the attendance logic) and
Phase 2 (rebuild the attendance-taking experience)

## Purpose

Two problems, one root cause. The app currently reports attendance as
`present ÷ planned semester classes` (48, or 32 for Ethics and Morality), so a
student with one present class out of 48 planned reads **2.1% — At Risk**. The
number is mathematically defensible and completely useless to a teacher in
week three, and the status labels built on it are actively misleading.

At the same time the screen that produces the data is hard to use safely: small
rows, no reliable sense of who is still unmarked, and a single Save button that
commits the session with no review step.

Success is: every percentage on every screen means something a teacher can act
on, the status badge reflects how the class is actually attending, and marking a
class on a phone is a fast, mistake-resistant operation.

Audience is unchanged: **one teacher**, one section (1AM, 45 students, 8 courses,
23 weekly periods), browser storage by default, optional shared backend.

## Scope decomposition (agreed)

The requester's five phases are three independent subsystems. Each gets its own
spec → plan → implementation cycle. This spec covers only A.

| Cycle | Phases | Status |
|---|---|---|
| **A** | 1 — attendance logic, 2 — attendance-taking flow | **This spec** |
| B | 3 — attendance correction and audit | Not started. Decisions already agreed: correction + audit shapes live in the shared core so browser and server modes behave identically; audit endpoints land on the current `node:sqlite` backend and stay portable to the planned Postgres API. This reverses the "audit-log viewing UI" non-goal in `2026-09-25-vercel-postgres-backend-design.md`. |
| C | 4 — dashboard UX, 5 — visual system | Not started. This is where `app.js` gets split into view modules and `styles.css` gets unminified and tokenised. Approach A explicitly defers that structural work here. |

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| What counts as a class held | Distinct `(date, timeSlot)` sessions recorded for a course | One denominator per course, so student and course numbers reconcile |
| Current attendance | `present ÷ classes held` | Answers "how is this student attending?" — drives status |
| Planned-total metric | Kept, renamed **Semester progress**, always shown with its denominator | Preserves the original C++ metric without letting it masquerade as attendance |
| Status thresholds | Unchanged: ≥85 Excellent, ≥70 Good, ≥60 Warning, else At Risk | The requester asked to fix the input, not the thresholds |
| Zero classes held | `current: null`, label **No classes yet**, excluded from status tallies | A missing denominator is not 0%, and a course with no classes yet must never count as at-risk |
| Partial session in the course figure | Unmarked rows count as absent: `Σ present ÷ (classes held × 45)` | Mirrors how an individual student's score treats an unmarked row, so both views always agree |
| Unmarked-save gate | Primary Save disabled; separate secondary "Save as partial (n/45)…" path | The gate is impossible to miss; the escape hatch is deliberate |
| Third metric | The dashboard's "Recorded presence" (present ÷ recorded entries) is **deleted** | It is neither metric, and it is the main source of the current confusion |
| Verification | Automated suite + desktop pass by the implementer; phone checklist run by the requester | No browser automation exists, and touch ergonomics only a real device can judge |

## Metric model

Record identity is unchanged: `{studentId, courseCode, date, timeSlot, present}`
keyed by all four fields. **No schema change, no migration, no change to the C++
interchange format or to saved browser data.**

```js
// web/core.js — the single place the maths lives
heldSessions(records, code)          // number: distinct (date, timeSlot) sessions holding ≥1 record for the course
studentMetrics(records, id, code)    // one student × one course
markTally(marks, students)           // { present, absent, unmarked } — pure, for the live counters
courseMetrics(records, code)         // whole-course roll-up, for the dashboard chart
statusOf(current)                    // label from a percentage or null
isPartial(records, code, date, timeSlot)  // marked rows < roster size
```

`studentMetrics` returns:

| Field | Definition |
|---|---|
| `present` | rows for this student and course with `present === true` |
| `absent` | rows for this student and course with `present === false` |
| `held` | `heldSessions(records, code)` — course-wide, not per student |
| `planned` | `catalog.courses[code].totalClasses` — 48, or 32 for GEEM-1101 |
| `current` | `present / held * 100`, or `null` when `held === 0` |
| `semesterProgress` | `min(100, present / planned * 100)` |
| `status` | `statusOf(current)` |

`present ≤ held` holds by construction, so the clamp on `current` is purely
defensive against corrupt or duplicated input. `semesterProgress` genuinely
needs its cap, because more sessions than planned can be recorded.

`statusOf(current)`: `null` → `'No classes yet'`; `≥85` → `'Excellent'`;
`≥70` → `'Good'`; `≥60` → `'Warning'`; otherwise `'At Risk'`.

`courseMetrics(records, code)` returns `{held, present, marked, current}` where
`marked` is the number of student-slot rows recorded for the course and
`current = Σ present ÷ (held × 45)`. With fully marked sessions this equals the
mean of `studentMetrics(...).current` across the roster; the two definitions
differ only for partially marked sessions, and the chosen one keeps the course
figure consistent with individual scores.

### The consequence, stated plainly

A class counts as held whether or not everyone was marked. A student left
**unmarked** therefore has no present record for it and is treated as absent —
identical to being marked absent. This is deliberate: it keeps one honest
denominator instead of silently shrinking it. Two mechanisms contain the damage:
Phase 2 deletes accidental partial sessions by gating the save, and cycle B adds
audited correction for the ones that still happen.

### Labels and call sites

- **Current attendance** — `present ÷ classes held`; the figure in every status badge
- **Semester progress** — `present ÷ planned`; always rendered with its denominator ("out of 48 planned")

| Surface | Change |
|---|---|
| Dashboard student snapshot (`studentTable`) | Columns become Present / Classes held, Current attendance, Status |
| Students page + status filter | Same columns; filter list gains **No classes yet**; explanatory notice rewritten for both metrics |
| Student profile dialog | Shows **both** metrics per course |
| Reports matrix | Metric switch defaulting to Current attendance, toggling to Semester progress |
| Reports saved sessions | Unchanged counts, plus a **Partial · 40/45** flag |
| Dashboard course chart | Current attendance per course (was the deleted third metric) |
| Dashboard stat "Recorded presence" | Deleted; replaced by **Average current attendance** across courses that have classes held (the dashboard's final composition is cycle C's decision) |
| CSV report export | Always both metrics regardless of the on-screen switch, explicitly labelled, e.g. `CSE-1121 current (%)` and `CSE-1121 semester (%)` |
| Data & settings "original engine" panel | Rewritten to describe both metrics and the thresholds |
| `percentage()` and `status()` | Removed; replaced by the named metric functions |

## The attendance-taking flow

**Rows and controls.** A `rosterrow` class gives ~52px rows on desktop and ~60px
on mobile, with 14px names and a larger avatar. The mark controls become a
segmented Present / Absent pair per row with a **44×44px minimum touch target**:
green fill when present, red fill when absent, white with a border when
unselected. `aria-pressed` stays. The existing `:focus-visible` ring is checked
against both fills.

**Counters.** The single summary string becomes a three-part strip — **Present
(green) / Absent (red) / Unmarked (amber)** — inside an `aria-live="polite"`
region. Counts are always computed over the full roster, never the search
filter, so searching a name cannot appear to change the numbers. The hardcoded
`45` in `counts()` is replaced with `students.length`, and the arithmetic moves
into `markTally` in `core.js` so it is unit-tested.

**Unmarked highlighting.** An unmarked student's row shows an amber accent bar
and tint **and a visible "Unmarked" chip** — never colour alone. The toolbar
gains a **Show unmarked only (n)** toggle, which is the companion to Mark all
present: mark everyone, filter to exceptions, fix them, save.

**The save gate.** While any student is unmarked the primary Save is disabled and
the bar explains why: *"3 students unmarked — mark them, or save this session as
partial."* A distinctly secondary control, **Save as partial (42/45)…**, opens
the same review step. A partial save requires at least one marked student; a
session with nobody marked is not a session (use Mark all absent for that).

**The review step.** Both paths open a native `<dialog>` showing course code and
title, date with weekday, period start–end, and a Present / Absent / Unmarked
count grid, plus the names of absent students and, for a partial save, the
unmarked names with the note that they are recorded as absent. Actions are
**Back to roster** and **Confirm & save** (or **Save partial session**). Esc
equals Back. No mark is lost on any exit path. The dialog is built to be reused
by cycle B, which adds a correction-reason field to the same layout.

**Sticky save bar.** `.savebar` is already `position: sticky`; the work is making
it usable on a phone: edge-to-edge at ≤720px, `padding-bottom:
env(safe-area-inset-bottom)`, ≥44px primary button, z-index above rows, and
enough roster bottom padding that the last student is not hidden behind it.

**Behaviour deliberately kept.** Saved sessions stay read-only in this cycle —
duplicate rejection is the correctness guarantee that cycle B replaces with
audited correction. Only the wording changes, to say so. Demo mode cannot save, a
load error disables save, and leaving with unsaved marks still confirms.
Mark all present and Mark all absent both stay.

**Out of scope (YAGNI).** Per-student notes, undo stack, swipe gestures, per-row
history, offline sync.

## Acceptance criteria

Sub-project A is done when all of these hold:

1. Every attendance percentage in the UI is either **Current attendance** or **Semester progress**, and each is labelled with its denominator.
2. Status badges are driven by Current attendance alone; no surface still shows a status derived from the planned-total metric.
3. A course with no classes held shows **No classes yet** and "—", never 0% or At Risk.
4. `npm test` and `node --check web/app.js` pass, including the tests that replace the two encoding the old rule.
5. Saving is impossible while a student is unmarked without deliberately choosing the partial path, and the review step shows course, date, period times, and Present / Absent / Unmarked counts.
6. Marking a class is possible one-handed on a phone with the save bar reachable and no student hidden behind it.
7. No saved data is migrated, and old browser data, JSON backups, and C++ `attendance_data.txt` files still load unchanged.

## Architecture and files touched

- `web/core.js` — metric API, `markTally`, `isPartial`, partial-save option on `makeSession`
- `web/app.js` — call sites rewired to the metric API; attendance view rebuilt; review dialog
- `web/styles.css` — one clearly-marked readable block for the attendance register, plus save-bar refinements. Full sheet unification stays in cycle C
- `tests/core.test.js` — the two tests encoding the old rule are replaced
- `tests/server.test.js` — unaffected; `server/index.js` imports only `validateRecords`

Browser storage key, record shape, and the C++ export/import format are all
unchanged, so no data migration exists and rollback is a plain revert.

## Testing

**Automated** (`npm test`, plus `node --check web/app.js` — the same two checks CI
runs):

- Held-counting: no records → 0; two dates for one course → 2; two periods of one
  course on one day → 2; many students in one session → 1
- Current attendance at the exact 85 / 70 / 60 boundaries
- `held === 0` → `current === null`, status `No classes yet`, UI renders "—"
- `semesterProgress` capped at 100, and 32 planned for GEEM-1101
- Partial session: 40 of 45 marked still counts as one held class and is flagged partial
- Unmarked student in a partially marked session scores `0/1 — At Risk` (documented intent)
- Consistency: with complete sessions, `courseMetrics().current` equals the mean of `studentMetrics().current`
- `markTally` counts over the full roster, ignoring the visible filter
- `makeSession` with `allowPartial`: returns only marked rows, throws with nothing marked, still rejects duplicates

**Manual, desktop (implementer):** run `npm start` (needs `ADMIN_PASSWORD` of 16+
characters) and walk dashboard → attendance → students → reports confirming both
metrics, the labels, and that the review dialog's numbers match the roster.

**Manual, phone (requester):** a short checklist — mark all present, unmark two,
confirm the amber chip and counters, attempt to save, confirm the block, save
through the review step, confirm the sticky bar is thumb-reachable, confirm
nothing jumps or hides behind the bar.

## Risks

| Risk | Mitigation |
|---|---|
| Existing data looks dramatically different on first load (1 of 48 → 100%) | Expected and intended; called out in the plan so it is not mistaken for a bug |
| The two metrics drift apart in exports | Both exported columns carry explicit `current` / `semester` labels |
| New CSS lands in a minified two-line sheet | One readable, clearly-marked block; unification is cycle C's job |
| Partial sessions quietly depress attendance | Counter strip exposes unmarked students, the save gate blocks the accidental case, cycle B repairs the rest |
| `app.js` remains monolithic | Accepted under Approach A; cycle C restructures it |

## Non-goals

- No corrections, edit-attendance, or audit endpoints — cycle B
- No dashboard restructure, typography scale, or colour-system work — cycle C
- No accounts, roles, or per-user attribution beyond a stored actor field in cycle B
- No change to the planned-total metric's value, the risk thresholds, or the C++ file format
- No new runtime dependencies
