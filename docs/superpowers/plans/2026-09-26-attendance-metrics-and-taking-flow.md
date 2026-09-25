# Attendance Metrics and Taking Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the misleading planned-total attendance metric with current attendance (present ÷ classes held), and rebuild the attendance register so a class can be marked quickly and safely on a phone.

**Architecture:** All maths moves into named functions in `web/core.js` (one source of truth, unit-tested with `node --test`). `web/app.js` keeps its existing single-file template-string style and is rewired call-site by call-site. `web/styles.css` gains one readable block for the register; the full visual system stays untouched until the later cycle. No storage, schema, or file-format changes.

**Tech Stack:** Vanilla ES modules, `node:test` + `node:assert/strict`, plain CSS, GitHub Pages static deployment. No build step, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-26-attendance-metrics-and-taking-flow-design.md`

## Global Constraints

- Node ≥ 24 (`package.json` engines); no new runtime or dev dependencies.
- CI (`.github/workflows/pages.yml`) runs `npm test` and `node --check web/app.js` on every push and PR. Both must pass after every task.
- Roster is exactly 45 students, 8 courses, 23 weekly periods from `web/catalog.js`. Never hardcode `45` in `web/app.js`; use `students.length`.
- Planned totals: 48 per course, 32 for `GEEM-1101`.
- Status thresholds are unchanged: ≥85 Excellent, ≥70 Good, ≥60 Warning, else At Risk; plus `No classes yet` when classes held is 0.
- Labels are fixed: **Current attendance** = present ÷ classes held (drives status); **Semester progress** = present ÷ planned classes.
- Record identity `studentId|courseCode|date|timeSlot` stays the unique key. Duplicate inserts stay rejected at every layer.
- No data migration. The localStorage key `rollcall-records-v1`, the record shape, and the `attendance_data.txt` format are unchanged.
- Register targets: body text ≥13px, mark buttons ≥44×44px, existing forest green `#194c3d` identity preserved.
- Do not restyle surfaces outside the register in this cycle.

## Review Focus

Inputs and conditions the spec implies but no test in this plan fully exercises, most likely to bite first. Each already has its test added to the owning task:

1. **Empty workspace** (zero records): every percentage must render "—", status `No classes yet`, no `NaN`, no 0% (Task 1, Task 3).
2. **Foreign or legacy files**: an imported `attendance_data.txt` may contain a session marked for only some students — held counting must still work and the row must render (Task 1, Task 3).
3. **Corrupt or hand-edited data**: `present` exceeding `held`, or an unknown course code — clamp, never crash, never print `undefined` (Task 1).
4. **Search + filter + mark-all interplay**: counters must describe the whole roster while the table is filtered, and toggling the filter must not lose marks (Task 4).
5. **Date display**: the confirmation's weekday comes from the chosen date, including rescheduled dates, and must not shift by timezone (Task 1, Task 5).

---

## Task 1: Core metrics module

**Files:**
- Modify: `web/core.js`
- Test: `tests/core.test.js`

**Interfaces:**
- Consumes: `catalog` from `web/catalog.js` (unchanged).
- Produces, all exported from `web/core.js`:
  - `heldSessions(records, code) → number`
  - `statusOf(current) → 'No classes yet'|'Excellent'|'Good'|'Warning'|'At Risk'`
  - `studentMetrics(records, id, code) → {present, absent, held, planned, current, semesterProgress, status}`
  - `markTally(marks, students?) → {present, absent, unmarked, total}`
  - `courseMetrics(records, code) → {held, present, marked, current}`
  - `isPartial(records, code, date, timeSlot) → boolean`
  - `weekdayName(iso) → string` (empty string for anything that is not `YYYY-MM-DD`)
  - `reportCsv(records, students, courses) → string`
  - `percentage(records, id, code)` and `status(p)` are **deleted** and must not remain.

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `tests/core.test.js` with:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from '../web/catalog.js';
import {heldSessions,statusOf,studentMetrics,markTally,courseMetrics,reportCsv,weekdayName,makeSession,mergeRecords,parseLegacy,toLegacy,validateRecords,validDate} from '../web/core.js';
const marks=Object.fromEntries(catalog.students.map(s=>[s.id,true]));
const saturday=catalog.routine[0];
const session=(date='06-09-2025',period=saturday,m=marks)=>makeSession([],period,date,m);

test('Catalog preserves the C++ class structure',()=>{assert.equal(catalog.students.length,45);assert.equal(catalog.courses.length,8);assert.equal(catalog.routine.length,23);assert.equal(catalog.courses.find(c=>c.code==='GEEM-1101').totalClasses,32);});

test('Classes held counts distinct sessions, not rows',()=>{
 assert.equal(session().length,45);
 assert.equal(heldSessions(session(),'EEE-1121'),1);
 assert.equal(heldSessions([...session(),...session('07-09-2025')],'EEE-1121'),2);
 assert.equal(heldSessions(session(),'CSE-1121'),0);
});

test('Two periods of one course on one day are two classes',()=>{
 const sunday=catalog.routine.filter(p=>p.day==='Sunday'&&p.courseCode==='GEEL-1106');
 assert.equal(sunday.length,2);
 const first=makeSession([],sunday[0],'07-09-2025',marks),second=makeSession([],sunday[1],'07-09-2025',marks);
 assert.equal(heldSessions([...first,...second],'GEEL-1106'),2);
});

test('Current attendance uses classes held as its denominator',()=>{
 const one=studentMetrics(session(),'C251027','EEE-1121');
 assert.deepEqual({present:one.present,held:one.held,current:one.current},{present:1,held:1,current:100});
 const missed=session('07-09-2025',saturday,{...marks,C251027:false});
 const both=studentMetrics([...session(),...missed],'C251027','EEE-1121');
 assert.deepEqual({held:both.held,present:both.present,current:both.current},{held:2,present:1,current:50});
});

test('Status thresholds are unchanged and driven by current attendance',()=>{
 assert.equal(statusOf(100),'Excellent');assert.equal(statusOf(85),'Excellent');assert.equal(statusOf(84.99),'Good');
 assert.equal(statusOf(70),'Good');assert.equal(statusOf(69.99),'Warning');assert.equal(statusOf(60),'Warning');
 assert.equal(statusOf(59.99),'At Risk');assert.equal(statusOf(null),'No classes yet');
 const dates=['06-09-2025','07-09-2025','08-09-2025','09-09-2025','10-09-2025'];
 const build=present=>{let rows=[];dates.forEach((date,i)=>{const m=Object.fromEntries(catalog.students.map(s=>[s.id,i<present]));rows=[...rows,...makeSession(rows,saturday,date,m)];});return rows;};
 assert.deepEqual([5,4,3,2].map(n=>studentMetrics(build(n),'C251027','EEE-1121').status),['Excellent','Good','Warning','At Risk']);
 assert.deepEqual([5,4,3,2].map(n=>studentMetrics(build(n),'C251027','EEE-1121').current),[100,80,60,40]);
});

test('A course with no classes held has no percentage and no risk status',()=>{
 const empty=studentMetrics([],'C251027','EEE-1121');
 assert.deepEqual({held:empty.held,current:empty.current,status:empty.status,semesterProgress:empty.semesterProgress},{held:0,current:null,status:'No classes yet',semesterProgress:0});
 assert.equal(courseMetrics([],'EEE-1121').current,null);
});

test('Semester progress keeps the planned total and the 100% cap',()=>{
 assert.equal(studentMetrics(session(),'C251027','EEE-1121').planned,48);
 assert.equal(studentMetrics([],'C251027','GEEM-1101').planned,32);
 assert.ok(Math.abs(studentMetrics(session(),'C251027','EEE-1121').semesterProgress-100/48*100)<1e-9);
 let rows=[];for(let day=1;day<=30;day++)for(const month of ['09','10'])rows=makeSession(rows,saturday,String(day).padStart(2,'0')+'-'+month+'-2025',marks);
 assert.equal(studentMetrics(rows,'C251027','EEE-1121').semesterProgress,100);
});

test('Unmarked students read as absent for a held class',()=>{
 const rows=validateRecords(session().filter(r=>r.studentId!=='C253002'));
 assert.equal(heldSessions(rows,'EEE-1121'),1);
 const unmarked=studentMetrics(rows,'C253002','EEE-1121');
 assert.deepEqual({present:unmarked.present,held:unmarked.held,current:unmarked.current,status:unmarked.status},{present:0,held:1,current:0,status:'At Risk'});
});

test('Course current attendance equals the mean of student figures when sessions are complete',()=>{
 const rows=[...session(),...session('07-09-2025',saturday,{...marks,C251027:false,C253002:false})];
 const perStudent=catalog.students.map(s=>studentMetrics(rows,s.id,'EEE-1121').current);
 const mean=perStudent.reduce((a,b)=>a+b,0)/perStudent.length;
 const course=courseMetrics(rows,'EEE-1121');
 assert.ok(Math.abs(course.current-mean)<1e-9);
 assert.deepEqual({held:course.held,present:course.present,marked:course.marked},{held:2,present:88,marked:90});
});

test('markTally counts every student in the roster',()=>{
 const oneUnmarked={...marks};delete oneUnmarked['C253002'];
 assert.deepEqual(markTally(oneUnmarked,catalog.students),{present:44,absent:0,unmarked:1,total:45});
 assert.deepEqual(markTally({...marks,C253002:false},catalog.students),{present:44,absent:1,unmarked:0,total:45});
 assert.deepEqual(markTally({},catalog.students),{present:0,absent:0,unmarked:45,total:45});
 assert.deepEqual(markTally({C251027:true},catalog.students.slice(0,2)),{present:1,absent:0,unmarked:1,total:2});
});

test('Unknown course codes and empty record sets stay safe',()=>{
 const unknown=studentMetrics([],'C251027','NOPE-0000');
 assert.deepEqual({planned:unknown.planned,held:unknown.held,current:unknown.current,status:unknown.status},{planned:0,held:0,current:null,status:'No classes yet'});
 const doubled=[...session(),session()[0]];
 const clamped=studentMetrics(doubled,'C251027','EEE-1121');
 assert.deepEqual({present:clamped.present,held:clamped.held,current:clamped.current},{present:2,held:1,current:100});
 const course=courseMetrics([],'NOPE-0000');
 assert.deepEqual({held:course.held,marked:course.marked,current:course.current},{held:0,marked:0,current:null});
});

test('weekdayName names the chosen date without a timezone shift',()=>{
 assert.equal(weekdayName('2025-09-06'),'Saturday');
 assert.equal(weekdayName('2025-09-07'),'Sunday');
 assert.equal(weekdayName('2025-12-31'),'Wednesday');
 assert.equal(weekdayName('06-09-2025'),'');
 assert.equal(weekdayName(''),'');
});

test('Report CSV carries both metrics with labelled columns',()=>{
 const empty=reportCsv([],catalog.students,catalog.courses).split('\r\n');
 assert.equal(empty.length,46);
 assert.ok(empty[0].includes('"EEE-1121 current (%)"'));
 assert.ok(empty[0].includes('"EEE-1121 semester (%)"'));
 assert.ok(empty[1].startsWith('"C251027","Mohammad Sifat Ullah","","0.0"'));
 assert.ok(reportCsv(session(),catalog.students,catalog.courses).split('\r\n')[1].startsWith('"C251027","Mohammad Sifat Ullah","100.0","2.1"'));
});

test('All present, all absent and individual attendance',()=>{
 assert.equal(session().length,45);
 const mixed={...marks,C253002:false};
 assert.equal(makeSession([],saturday,'06-09-2025',mixed).filter(r=>r.present).length,44);
 assert.equal(makeSession([],saturday,'06-09-2025',Object.fromEntries(catalog.students.map(s=>[s.id,false]))).filter(r=>r.present).length,0);
 assert.throws(()=>makeSession([],saturday,'06-09-2025',{}));
});

test('Reject duplicate even when first student is missing from existing data',()=>{const rows=session();assert.throws(()=>mergeRecords(rows.slice(1),rows),/already exists/);assert.equal(mergeRecords(rows,session('07-09-2025')).length,90);});

test('Legacy file round trip and invalid rows',()=>{assert.deepEqual(parseLegacy(toLegacy(session())),session());assert.throws(()=>parseLegacy('2,2025-3-3,CSE-1121,0'));assert.throws(()=>validateRecords([{...session()[0],studentId:'unknown'}]));assert.throws(()=>validateRecords([...session(),session()[0]]));assert.throws(()=>validateRecords([{...session()[0],present:'1'}]));});

test('Calendar validation and manual rescheduled dates',()=>{assert.ok(validDate('29-02-2024'));assert.ok(!validDate('29-02-2025'));assert.ok(!validDate('31-04-2025'));assert.equal(makeSession([],saturday,'07-09-2025',marks).length,45);});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/core.test.js`
Expected: FAIL — `SyntaxError: The requested module '../web/core.js' does not provide an export named 'heldSessions'`

- [ ] **Step 3: Write the metrics module**

Replace the top of `web/core.js` (everything above `export function validDate`) with the following, leaving `validDate`, `validateRecords`, `mergeRecords`, `makeSession`, `parseLegacy` and `toLegacy` below it untouched. `percentage` and `status` are deleted.

```js
import { catalog } from './catalog.js';
export const key = r => [r.studentId,r.courseCode,r.date,r.timeSlot].join('|');
export const sessionKey = r => [r.courseCode,r.date,r.timeSlot].join('|');
const courseOf = code => catalog.courses.find(c=>c.code===code);
const markedRows = (records,code,date,timeSlot) => records.filter(r=>r.courseCode===code && r.date===date && r.timeSlot===timeSlot).length;

export function heldSessions(records,code) {
  return new Set(records.filter(r=>r.courseCode===code).map(r=>r.date+'|'+r.timeSlot)).size;
}
export function isPartial(records,code,date,timeSlot) {
  const marked=markedRows(records,code,date,timeSlot);
  return marked>0 && marked<catalog.students.length;
}
export function statusOf(current) {
  if(current===null || current===undefined) return 'No classes yet';
  return current>=85?'Excellent':current>=70?'Good':current>=60?'Warning':'At Risk';
}
export function studentMetrics(records,id,code) {
  const rows=records.filter(r=>r.studentId===id && r.courseCode===code);
  const present=rows.filter(r=>r.present).length;
  const held=heldSessions(records,code);
  const planned=courseOf(code)?.totalClasses || 0;
  const current=held?Math.min(100,present/held*100):null;
  const semesterProgress=planned?Math.min(100,present/planned*100):0;
  return {present,absent:rows.length-present,held,planned,current,semesterProgress,status:statusOf(current)};
}
export function courseMetrics(records,code) {
  const held=heldSessions(records,code);
  const present=records.filter(r=>r.courseCode===code && r.present).length;
  const marked=records.filter(r=>r.courseCode===code).length;
  return {held,present,marked,current:held?Math.min(100,present/(held*catalog.students.length)*100):null};
}
export function markTally(marks,students=catalog.students) {
  let present=0,absent=0,unmarked=0;
  for(const student of students) {
    const mark=marks[student.id];
    if(mark===true) present++;
    else if(mark===false) absent++;
    else unmarked++;
  }
  return {present,absent,unmarked,total:students.length};
}
export function weekdayName(iso) {
  if(typeof iso!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const date=new Date(iso+'T00:00:00');
  return Number.isNaN(date.getTime())?'':date.toLocaleDateString('en-US',{weekday:'long'});
}
export function reportCsv(records,students,courses) {
  const quote=v=>'"'+String(v).replaceAll('"','""')+'"';
  const header=['Student ID','Name',...courses.flatMap(c=>[c.code+' current (%)',c.code+' semester (%)'])];
  const rows=students.map(s=>[s.id,s.name,...courses.flatMap(c=>{const m=studentMetrics(records,s.id,c.code);return [m.current===null?'':m.current.toFixed(1),m.semesterProgress.toFixed(1)];})]);
  return [header,...rows].map(row=>row.map(quote).join(',')).join('\r\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 18 tests pass (`tests/server.test.js` is unaffected because `server/index.js` imports only `validateRecords`).

- [ ] **Step 5: Commit**

```bash
git add web/core.js tests/core.test.js
git commit -m "Add current-attendance metrics to core with tests"
```

---

## Task 2: Partial-save contract in makeSession

**Files:**
- Modify: `web/core.js` (the `makeSession` function only)
- Test: `tests/core.test.js`

**Interfaces:**
- Consumes: `markTally`, `isPartial`, `heldSessions`, `studentMetrics` from Task 1.
- Produces: `makeSession(existing, period, date, marks, options?)` where `options` is `{allowPartial?: boolean}` defaulting to `{allowPartial:false}`. Strict mode keeps throwing `Mark every student before saving, or confirm a partial session.`; partial mode returns rows for marked students only and throws `Mark at least one student before saving.` when nothing is marked.

- [ ] **Step 1: Write the failing test**

Append to `tests/core.test.js`:

```js
test('Partial save records only marked students',()=>{
 const partial={...marks};delete partial['C253002'];delete partial['C253003'];
 const rows=makeSession([],saturday,'06-09-2025',partial,{allowPartial:true});
 assert.equal(rows.length,43);
 assert.ok(!rows.some(r=>r.studentId==='C253002'));
 assert.equal(heldSessions(rows,'EEE-1121'),1);
 assert.equal(isPartial(rows,'EEE-1121','06-09-2025',saturday.startTime),true);
 assert.equal(isPartial(rows,'EEE-1121','07-09-2025',saturday.startTime),false);
 assert.equal(isPartial(rows,'EEE-1121','06-09-2025','12:20 PM'),false);
 assert.throws(()=>makeSession([],saturday,'06-09-2025',partial),/Mark every student/);
 assert.throws(()=>makeSession([],saturday,'06-09-2025',{}, {allowPartial:true}),/at least one student/);
 const unmarked=studentMetrics(rows,'C253002','EEE-1121');
 assert.deepEqual({present:unmarked.present,held:unmarked.held,current:unmarked.current,status:unmarked.status},{present:0,held:1,current:0,status:'At Risk'});
});
```

Also extend the import line of `tests/core.test.js` with `isPartial`:

```js
import {heldSessions,statusOf,studentMetrics,markTally,courseMetrics,isPartial,reportCsv,weekdayName,makeSession,mergeRecords,parseLegacy,toLegacy,validateRecords,validDate} from '../web/core.js';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/core.test.js`
Expected: FAIL — `AssertionError` on `assert.equal(rows.length,43)` because the strict rule throws `Mark every student before saving.`

- [ ] **Step 3: Implement the option**

Replace `makeSession` in `web/core.js` with:

```js
export function makeSession(existing,period,date,marks,{allowPartial=false}={}) {
  if(!catalog.routine.some(p=>p.day===period?.day && p.courseCode===period.courseCode && p.startTime===period.startTime)) throw Error('Choose a scheduled class.');
  const marked=catalog.students.filter(s=>typeof marks[s.id]==='boolean');
  if(!allowPartial && marked.length!==catalog.students.length) throw Error('Mark every student before saving, or confirm a partial session.');
  if(allowPartial && !marked.length) throw Error('Mark at least one student before saving.');
  const rows=marked.map(s=>({studentId:s.id,courseCode:period.courseCode,date,timeSlot:period.startTime,present:marks[s.id]}));
  mergeRecords(existing,rows); return rows;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 19 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/core.js tests/core.test.js
git commit -m "Support explicitly partial attendance saves"
```

---

## Task 3: Rewire the read-only surfaces

**Files:**
- Modify: `web/app.js` (import line, `badge`, `progress`, `studentTable`, `filteredStudents`, `studentsPage`, `dashboard`, `profile`, `reportsPage`, click handler, state line, settings copy)
- Test: `tests/core.test.js` (already covers `reportCsv`), plus grep and `node --check` checks below

**Interfaces:**
- Consumes: `studentMetrics`, `courseMetrics`, `markTally`, `reportCsv` from Task 1.
- Produces: no new exports. The dashboard's 4th stat becomes Average current attendance; `recordedRate` and every use of `percentage(`, `status(` and the literal `45` are gone from `web/app.js`.

- [ ] **Step 1: Write the failing check**

Run: `grep -c "percentage(\|recordedRate(" web/app.js`
Expected: FAIL — prints a count of 6 or more, proving the old rule is still wired.

- [ ] **Step 2: Rewire the import line and state**

In `web/app.js`, replace the import line with:

```js
import {studentMetrics,courseMetrics,markTally,weekdayName,reportCsv,sessionKey,mergeRecords,makeSession,parseLegacy,toLegacy,validateRecords} from './core.js';
```

Add `reportMetric` to the state line so it reads:

```js
let view='dashboard',day=days.includes(new Date().toLocaleDateString('en-US',{weekday:'long'}))?new Date().toLocaleDateString('en-US',{weekday:'long'}):'Saturday',periodIndex=routine.findIndex(p=>p.day===day),date=today(),marks={},search='',course=courses[0].code,filter='all',reportMetric='current',busy=false;
```

- [ ] **Step 3: Rewire badge, progress and the student table**

Replace `badge`, `progress` and `studentTable` with:

```js
function badge(label){const cls=label==='At Risk'?'risk':label==='No classes yet'?'nodata':label.toLowerCase();return `<span class="badge ${cls}">● ${label}</span>`;}
function progress(p){return p===null?`<div class="progress nodata"><span class="track"><i style="width:0"></i></span><span>—</span></div>`:`<div class="progress"><span class="track"><i style="width:${p}%"></i></span>${p.toFixed(1)}%</div>`;}
function studentTable(list){return `<div class="tablewrap"><table><thead><tr><th>Student</th><th>Present / Held</th><th>Current attendance</th><th>Status</th><th></th></tr></thead><tbody>${list.length?list.map(s=>{const m=studentMetrics(records,s.id,course);return `<tr><td>${studentCell(s)}</td><td>${m.present} <span style="color:#9ba58e">/ ${m.held} held</span></td><td>${progress(m.current)}</td><td>${badge(m.status)}</td><td><button class="textbutton" data-student="${s.id}">View profile →</button></td></tr>`;}).join(''):'<tr><td colspan="5" class="empty">No students match your search.</td></tr>'}</tbody></table></div>`;}
function averageCurrent(){const values=courses.map(c=>courseMetrics(records,c.code).current).filter(v=>v!==null);return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;}
```

Delete the `recordedRate` function.

- [ ] **Step 4: Rewire dashboard, students page and profile**

In `dashboard()`, make these surgical replacements (each old string appears exactly once in the file):

1. `${stat('Total students','45',` → `${stat('Total students',students.length,`
2. `${stat('Recorded presence',records.length?recordedRate(records).toFixed(1)+'%':'—','Across recorded entries only','report')}` → `${stat('Average current attendance',averageCurrent()===null?'—':averageCurrent().toFixed(1)+'%','Across courses with classes held','report')}`
3. `<div><h2>Attendance by course</h2><p>Present entries as a share of recorded entries</p></div>` → `<div><h2>Current attendance by course</h2><p>Present entries as a share of classes held</p></div>`
4. The whole chart element:

```js
`<div class="chart" role="img" aria-label="Recorded presence by course">${courses.map(c=>{const rows=records.filter(r=>r.courseCode===c.code),p=recordedRate(rows);return `<div class="barcol"><span>${rows.length?p.toFixed(0)+'%':'—'}</span><div class="bar" style="height:${p*.8+2}%" title="${c.code}: ${rows.length?p.toFixed(1)+'%':'No records'}"></div></div>`;}).join('')}</div>`
```

becomes:

```js
`<div class="chart" role="img" aria-label="Current attendance by course">${courses.map(c=>{const m=courseMetrics(records,c.code);return `<div class="barcol"><span>${m.current===null?'—':m.current.toFixed(0)+'%'}</span><div class="bar" style="height:${m.current===null?2:m.current*.8+2}%" title="${c.code}: ${m.current===null?'No classes yet':m.current.toFixed(1)+'% across '+m.held+' classes held'}"></div></div>`;}).join('')}</div>`
```

5. `<div class="chartlegend"><i class="dot"></i>${records.length?'Recorded presence · not the fixed-total semester score':'Your chart will grow as you record classes.'}</div>` → `<div class="chartlegend"><i class="dot"></i>${records.length?'Current attendance · present ÷ classes held':'Your chart will grow as you record classes.'}</div>`
6. `<p>${esc(course)} · Semester attendance against the planned course total</p>` → `<p>${esc(course)} · Present ÷ classes held</p>`
7. `<small>Section 1AM · 45 students</small>` → `<small>Section 1AM · ${students.length} students</small>`
8. `${v==='students'?'<span class="count">45</span>':''}` → `${v==='students'?`<span class="count">${students.length}</span>`:''}`
9. In the click handler, replace the save branch with:

```js
 if(b.id==='save'){const rows=makeSession(records,routine[periodIndex],legacyDate(date),marks);const t=markTally(marks,students);busy=true;b.disabled=true;b.textContent='Saving…';try{await saveRows(rows);toast(`Attendance saved — ${t.present} present, ${t.absent} absent.`);}finally{busy=false;render();}return;}
```

In `studentsPage()`:
- Replace the notice with:

```js
`<div class="notice">Current attendance = present classes ÷ classes held, and it drives the status. Semester progress = present ÷ planned classes (48, or 32 for Ethics) and is shown separately in Reports. Status: ≥85% Excellent · ≥70% Good · ≥60% Warning · below 60% At Risk. A course with no classes held shows “No classes yet”.</div>`
```

- Replace the status filter options with:

```js
${['all','Excellent','Good','Warning','At Risk','No classes yet'].map(v=>`<option ${filter===v?'selected':''} value="${v}">${v==='all'?'All statuses':v}</option>`).join('')}
```

- Replace `filteredStudents` with:

```js
function filteredStudents(){return students.filter(s=>(s.name+' '+s.id).toLowerCase().includes(search.toLowerCase())&&(filter==='all'||studentMetrics(records,s.id,course).status===filter));}
```

Replace `profile(id)` with:

```js
function profile(id){const s=students.find(s=>s.id===id);$('#dialog').innerHTML=`<div class="modalhead"><div>${studentCell(s)}</div><button class="iconbtn" data-close aria-label="Close profile">${icon('close')}</button></div><div class="reportmeta">Course-by-course attendance · classes held and planned totals</div><div class="tablewrap"><table><thead><tr><th>Course</th><th>Present / Held</th><th>Current attendance</th><th>Semester progress</th><th>Status</th></tr></thead><tbody>${courses.map(c=>{const m=studentMetrics(records,id,c.code);return `<tr><td>${c.code}</td><td>${m.present} / ${m.held}</td><td>${progress(m.current)}</td><td>${m.semesterProgress.toFixed(1)}% <span style="color:#9ba58e">/ ${c.totalClasses} planned</span></td><td>${badge(m.status)}</td></tr>`;}).join('')}</tbody></table></div><p class="hint" style="padding-top:16px">Current attendance is present ÷ classes held. Semester progress is present ÷ planned classes (48 per course, 32 for Ethics and Morality).</p>`;$('#dialog').showModal();}
```

- [ ] **Step 5: Rewire reports, export and settings copy**

Replace `reportsPage()` with:

```js
function reportsPage(){const grouped=Object.groupBy(records,sessionKey);const cell=(id,code)=>{const m=studentMetrics(records,id,code);return reportMetric==='current'?(m.current===null?'—':m.current.toFixed(1)+'%'):m.semesterProgress.toFixed(1)+'%';};return head('The full picture.','Review saved sessions and export your semester report.',`<button data-action="report">${icon('download')}Export report CSV</button><button data-action="print">Print report</button>`)+`<section class="panel"><div class="panelhead"><div><h2>Semester attendance matrix</h2><p>${reportMetric==='current'?'Current attendance · present ÷ classes held':'Semester progress · present ÷ planned classes'}</p></div><div class="metricswitch"><button data-metric="current" class="${reportMetric==='current'?'selected':''}" aria-pressed="${reportMetric==='current'}">Current</button><button data-metric="semester" class="${reportMetric==='semester'?'selected':''}" aria-pressed="${reportMetric==='semester'}">Semester</button></div><span class="chip">${students.length} students · ${courses.length} courses</span></div><div class="tablewrap"><table><thead><tr><th>Student</th>${courses.map(c=>`<th>${c.code}</th>`).join('')}</tr></thead><tbody>${students.map(s=>`<tr><td>${studentCell(s)}</td>${courses.map(c=>`<td>${cell(s.id,c.code)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section><section class="panel"><div class="panelhead"><h2>Saved sessions</h2><span class="chip">${Object.keys(grouped).length} sessions</span></div>${records.length?`<div class="tablewrap"><table><thead><tr><th>Course</th><th>Date</th><th>Period</th><th>Present</th><th>Absent</th><th>Completeness</th></tr></thead><tbody>${Object.values(grouped).sort((a,b)=>b[0].date.split('-').reverse().join('').localeCompare(a[0].date.split('-').reverse().join(''))).map(rows=>`<tr><td>${rows[0].courseCode}</td><td>${rows[0].date}</td><td>${rows[0].timeSlot}</td><td>${rows.filter(r=>r.present).length}</td><td>${rows.filter(r=>!r.present).length}</td><td>${rows.length===students.length?'Complete':`Partial · ${rows.length}/${students.length}`}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No sessions yet. Your saved classes will appear here.</div>'}</section>`;}
```

In the click handler, replace the CSV export line with:

```js
 if(a==='report')download('semester-attendance.csv',reportCsv(records,students,courses),'text/csv');
```

Add the metric switch before the `const a=b.dataset.action;` line:

```js
 if(b.dataset.metric){reportMetric=b.dataset.metric;render();return;}
```

In `settingsPage()`, replace the original-engine paragraph's rule lines with:

```html
<p>${students.length} students. ${courses.length} courses. ${routine.length} weekly periods.<br>Present or absent, individual or bulk marking.<br>Unique student + course + date + time slot.<br>Current attendance = present ÷ classes held (drives status).<br>Semester progress = present ÷ planned classes, capped at 100%.<br>Excellent ≥85% · Good ≥70% · Warning ≥60% · At Risk &lt;60% · No classes yet when nothing is recorded.</p>
```

- [ ] **Step 6: Verify no old rule or hardcoded roster size remains**

Run: `grep -n "percentage(\|recordedRate(\|\b45\b" web/app.js`
Expected: PASS — no output.

Run: `node --check web/app.js`
Expected: PASS — no output.

Run: `npm test`
Expected: PASS — 19 tests pass.

- [ ] **Step 7: Verify in the browser**

Run: `ADMIN_PASSWORD=local-verification-password npm start` and open `http://localhost:3000`.
Expected: the dashboard stat now reads "Average current attendance —" with no records, the chart shows "—" per course, the students page shows "Present / Held n / 0 held", "—" and "No classes yet" badges, the status filter offers "No classes yet", the profile dialog shows both metrics, and the Reports matrix toggles between Current and Semester without errors. Report CSV download contains both labelled column groups.

- [ ] **Step 8: Commit**

```bash
git add web/app.js
git commit -m "Report current attendance across every read-only surface"
```

---

## Task 4: Rebuild the register rows, counters and unmarked state

**Files:**
- Modify: `web/app.js` (`attendance`, `rosterRows`, new `visibleRoster`/`countStrip`/`refreshRegister`, state line, click handler, input handler, remove `counts` and `bind`)
- Modify: `web/styles.css` (append one readable block at the end)

**Interfaces:**
- Consumes: `markTally` (Task 1), the metric rewiring (Task 3).
- Produces: module-level `rosterFilter` state (`'all' | 'unmarked'`), `visibleRoster()`, `rosterRows()`, `countStrip(tally)`, `refreshRegister()`; DOM ids `#countstrip`, `#unmarkedonly`, `#roster`.

- [ ] **Step 1: Write the failing check**

Run: `grep -c "registersummary" web/app.js`
Expected: FAIL — prints `1`, proving the cramped single-line counter is still in use.

- [ ] **Step 2: Add the register state and roster helpers**

Add `rosterFilter` to the state line so it reads:

```js
let view='dashboard',day=days.includes(new Date().toLocaleDateString('en-US',{weekday:'long'}))?new Date().toLocaleDateString('en-US',{weekday:'long'}):'Saturday',periodIndex=routine.findIndex(p=>p.day===day),date=today(),marks={},search='',course=courses[0].code,filter='all',reportMetric='current',rosterFilter='all',busy=false;
```

Replace `rosterRows` and `counts` in `web/app.js` with:

```js
function visibleRoster(){const q=search.toLowerCase();return students.filter(s=>(s.name+' '+s.id).toLowerCase().includes(q)&&(rosterFilter!=='unmarked'||typeof marks[s.id]!=='boolean'));}
function rosterRows(){const locked=sessionRecords().length>0;const list=visibleRoster();return list.length?list.map(s=>{const mark=marks[s.id],unmarked=typeof mark!=='boolean';return `<tr class="rosterrow${unmarked?' unmarked':''}"><td class="sl">${String(s.sl).padStart(2,'0')}</td><td>${studentCell(s)}${unmarked?'<span class="chip amber">Unmarked</span>':''}</td><td><div class="mark"><button class="present ${mark===true?'selected':''}" aria-pressed="${mark===true}" aria-label="${esc(s.name)} present" data-mark="${s.id}" data-value="true" ${locked?'disabled':''}>✓ Present</button><button class="absent ${mark===false?'selected':''}" aria-pressed="${mark===false}" aria-label="${esc(s.name)} absent" data-mark="${s.id}" data-value="false" ${locked?'disabled':''}>− Absent</button></div></td></tr>`;}).join(''):`<tr class="rosterrow"><td colspan="3" class="empty">${rosterFilter==='unmarked'&&!search?'Every student is marked.':'No matching students.'}</td></tr>`;}
function countStrip(tally){return `<span class="count present"><strong>${tally.present}</strong> Present</span><span class="count absent"><strong>${tally.absent}</strong> Absent</span><span class="count unmarked"><strong>${tally.unmarked}</strong> Unmarked</span>`;}
function refreshRegister(){const tally=markTally(marks,students);const strip=$('#countstrip');if(strip)strip.innerHTML=countStrip(tally);const toggle=$('#unmarkedonly');if(toggle)toggle.textContent=`Unmarked only (${tally.unmarked})`;const body=$('#roster');if(body)body.innerHTML=rosterRows();}
```

- [ ] **Step 3: Rebuild the register markup**

Replace `attendance()` with:

```js
function attendance(){const saved=sessionRecords(),locked=saved.length>0,p=routine[periodIndex];if(locked)marks=Object.fromEntries(saved.map(r=>[r.studentId,r.present]));const tally=markTally(marks,students);return head('Make every class count.','Choose your class, mark the roster, and save once.')+`<section class="panel"><div class="filters"><label>Routine day<select id="day">${days.map(d=>`<option ${day===d?'selected':''}>${d}</option>`).join('')}</select></label><label>Class period<select id="period">${routine.map((p,i)=>p.day===day?`<option value="${i}" ${i===periodIndex?'selected':''}>${p.startTime} – ${p.endTime} · ${p.courseCode}</option>`:'').join('')}</select></label><label>Class date<input id="date" type="date" value="${date}" min="1900-01-01" max="9999-12-31" required></label></div><p class="hint">${esc(courses.find(c=>c.code===p.courseCode).title)} · You may select a different date for a rescheduled class, just like the C++ system.</p></section>${locked?'<div class="notice">This session is saved and read-only in this version. Attendance correction arrives in the next update.</div>':''}<section class="panel"><div class="toolbar"><input class="search" id="search" aria-label="Search roster" placeholder="Find a student…" value="${esc(search)}"><button data-mark-all="true" ${locked?'disabled':''}>✓ All present</button><button data-mark-all="false" ${locked?'disabled':''}>All absent</button><button id="unmarkedonly" data-roster-filter="unmarked" class="${rosterFilter==='unmarked'?'selected':''}" aria-pressed="${rosterFilter==='unmarked'}" ${locked?'disabled':''}>Unmarked only (${tally.unmarked})</button></div><p class="hint registerhint">Fast way: tap All present, then Unmarked only to fix the exceptions.</p><div class="countstrip" id="countstrip" aria-live="polite">${countStrip(tally)}</div><div class="tablewrap"><table class="roster"><thead><tr><th>#</th><th>Student</th><th>Attendance</th></tr></thead><tbody id="roster">${rosterRows()}</tbody></table></div></section><div class="savebar"><div><strong>${p.courseCode} · ${legacyDate(date)}</strong><p>${locked?'Saved session · changes are locked':'Unsaved marks stay in this session until you leave.'}</p></div><button class="primary" id="save" ${locked||busy||loadError?'disabled':''}>${locked?'Attendance saved':busy?'Saving…':'Save attendance →'}</button></div><div style="height:24px"></div>`;}
```

- [ ] **Step 4: Rewire the handlers**

In the click handler, replace the mark, mark-all and save branches with:

```js
 if(b.dataset.mark){marks[b.dataset.mark]=b.dataset.value==='true';refreshRegister();return;}
 if(b.dataset.markAll!==undefined){marks=Object.fromEntries(students.map(s=>[s.id,b.dataset.markAll==='true']));refreshRegister();return;}
 if(b.dataset.rosterFilter){rosterFilter=rosterFilter==='unmarked'?'all':'unmarked';b.setAttribute('aria-pressed',String(rosterFilter==='unmarked'));b.classList.toggle('selected',rosterFilter==='unmarked');$('#roster').innerHTML=rosterRows();return;}
 if(b.id==='save'){const rows=makeSession(records,routine[periodIndex],legacyDate(date),marks);const t=markTally(marks,students);busy=true;b.disabled=true;b.textContent='Saving…';try{await saveRows(rows);toast(`Attendance saved — ${t.present} present, ${t.absent} absent.`);}finally{busy=false;render();}return;}
```

Replace the `input` handler's roster branch and delete `bind` plus its call:

```js
document.addEventListener('input',e=>{if(e.target.id==='search'){search=e.target.value;if(view==='students')$('#studentResults').innerHTML=studentTable(filteredStudents());else $('#roster').innerHTML=rosterRows();}});
```

In `navigate(v)`, add `rosterFilter='all';` next to the existing `marks={};`, and in the `change` handler where `marks={};` is reset for day/period/date, add `rosterFilter='all';`.

Delete `function bind(){counts();}` and the `bind();` call inside `render()`.

- [ ] **Step 5: Give the register its readable style block**

Append to the end of `web/styles.css`:

```css
/* ==== Attendance register (cycle A; the visual-system pass unifies these in cycle C) ==== */
.rosterrow .sl{color:#9aa48c;font-size:12px}
.rosterrow td{padding:10px 23px}
.rosterrow .studentcell strong{font-size:14px}
.rosterrow .studentcell small{font-size:11px}
.rosterrow .avatar{height:40px;width:40px;font-size:12px}
.rosterrow.unmarked{background:#fdf7e6}
.rosterrow.unmarked td:first-child{border-left:4px solid #d9a12b;padding-left:19px}
.rosterrow.unmarked td{border-bottom-color:#f4e6c8}
.chip.amber{background:#fdf2d8;border-color:#f0dfb4;color:#8a5a08;font-size:11px;margin-left:8px}
.countstrip{display:flex;flex-wrap:wrap;gap:10px;padding:14px 23px;border-bottom:1px solid var(--line);background:#fbfcf8}
.countstrip .count{display:flex;align-items:baseline;gap:7px;padding:8px 15px;border-radius:9px;font-size:13px;font-weight:600;border:1px solid var(--line);background:#fff;color:#4c5847}
.countstrip .count strong{font:700 18px 'Manrope',sans-serif}
.countstrip .present{color:#186b3f;border-color:#cfe6d5;background:#f2f9f4}
.countstrip .absent{color:#a3232a;border-color:#f0d2d3;background:#fdf4f4}
.countstrip .unmarked{color:#8a5a08;border-color:#f2dfb6;background:#fefaf0}
.registerhint{padding:14px 23px 0}
.mark button{min-height:44px;min-width:104px;font-size:13px;font-weight:600;background:#fff;color:#4a5346;border-color:#c9d0c2}
.mark button.present.selected{background:#1d6b4a;border-color:#1d6b4a;color:#fff}
.mark button.absent.selected{background:#a3232a;border-color:#a3232a;color:#fff}
.mark button:disabled{background:#f4f6f1;color:#98a190;border-color:#e2e6dc}
.progress.nodata{color:#9aa48c;gap:8px}
.badge.nodata{background:#f1f2ee;color:#7c857e}
.metricswitch{display:inline-flex;gap:4px}
.metricswitch button{font-size:11px;padding:8px 12px}
.metricswitch button.selected{background:var(--green);color:#fff;border-color:var(--green)}
@media(max-width:720px){.rosterrow td{padding:14px 12px}.rosterrow .mark{display:flex;width:100%}.mark button{flex:1;min-width:0;font-size:12px}.countstrip{gap:8px;padding:12px}.countstrip .count{flex:1;justify-content:center;font-size:11px}.countstrip .count strong{font-size:16px}}
@media print{.countstrip,.mark,.rosterrow .chip{display:none!important}}
```

- [ ] **Step 6: Verify**

Run: `grep -c "registersummary" web/app.js`
Expected: PASS — prints `0`.

Run: `node --check web/app.js && npm test`
Expected: PASS — no syntax errors, 19 tests pass.

Manual check with `ADMIN_PASSWORD=local-verification-password npm start`: rows are roughly 52px with 44px Present/Absent buttons; tapping a mark updates the amber "Unmarked" chip and the counter strip without a full re-render; All present fills every counter to 45/0/0; Unmarked only filters to the students you have not touched and shows "Every student is marked." when none remain; search narrows rows without changing the counters.

- [ ] **Step 7: Commit**

```bash
git add web/app.js web/styles.css
git commit -m "Rebuild the register with counters and unmarked highlighting"
```

---

## Task 5: Save gate and review confirmation

**Files:**
- Modify: `web/app.js` (`saveBar`/`saveHint`/`updateSaveBar`, `reviewDialog`, `saveToast`, click handler, `refreshRegister`)
- Modify: `web/styles.css` (append review-dialog styles)

**Interfaces:**
- Consumes: `markTally`, `isPartial`, `weekdayName` (Tasks 1–2), `refreshRegister` (Task 4), `makeSession(..., {allowPartial:true})` (Task 2).
- Produces: DOM ids `#save`, `#savepartial`, `#savehint`, `#confirmSave`; functions `saveBar(period, locked, tally)`, `saveHint(locked, tally)`, `updateSaveBar(tally)`, `reviewDialog(period, partial)`, `saveToast(tally, partial)`.

- [ ] **Step 1: Write the failing check**

Run: `grep -c "confirmSave\|savepartial" web/app.js`
Expected: FAIL — prints `0`, proving there is no gate and no review step yet.

- [ ] **Step 2: Replace the save bar with a gated bar**

In `web/app.js`, replace the save-bar markup inside `attendance()` (the `<div class="savebar">…</div>` element and the trailing spacer) with:

```js
${saveBar(p,locked,tally)}<div style="height:24px"></div>
```

Add these functions:

```js
function saveHint(locked,tally){if(locked)return 'Saved session · read-only in this version; attendance correction arrives in the next update.';if(loadError)return loadError;return tally.unmarked?`${tally.unmarked} student${tally.unmarked===1?'':'s'} unmarked — mark them, or save this session as partial.`:tally.total+' students marked — ready to review and save.';}
function saveBar(period,locked,tally){return `<div class="savebar" id="savebar"><div><strong>${period.courseCode} · ${legacyDate(date)} · ${period.startTime} – ${period.endTime}</strong><p id="savehint">${esc(saveHint(locked,tally))}</p></div><div class="saveactions"><button class="primary" id="save" ${locked||busy||loadError||tally.unmarked>0?'disabled':''}>${locked?'Attendance saved':busy?'Saving…':'Save attendance →'}</button><button id="savepartial" class="secondary" ${locked||busy||loadError||tally.unmarked===0?'hidden':''}>Save as partial (${tally.total-tally.unmarked}/${tally.total})…</button></div></div>`;}
function saveToast(tally,partial){return partial?`Attendance saved — ${tally.present} present, ${tally.absent} absent. ${tally.unmarked} unmarked ${tally.unmarked===1?'student is':'students are'} recorded as absent.`:`Attendance saved — ${tally.present} present, ${tally.absent} absent.`;}
function updateSaveBar(tally){const hint=$('#savehint');if(hint)hint.textContent=saveHint(sessionRecords().length>0,tally);const save=$('#save');if(save)save.disabled=sessionRecords().length>0||busy||!!loadError||tally.unmarked>0;const partial=$('#savepartial');if(partial){partial.hidden=sessionRecords().length>0||busy||!!loadError||tally.unmarked===0;partial.textContent=`Save as partial (${tally.total-tally.unmarked}/${tally.total})…`;}}
function reviewDialog(period,partial){const tally=markTally(marks,students);const absent=students.filter(s=>marks[s.id]===false).map(s=>s.name);const unmarked=students.filter(s=>typeof marks[s.id]!=='boolean').map(s=>s.name);$('#dialog').innerHTML=`<div class="modalhead"><div><h2>Confirm attendance</h2><p>${period.courseCode} · ${esc(courses.find(c=>c.code===period.courseCode).title)}</p></div><button class="iconbtn" data-close aria-label="Back to the roster">${icon('close')}</button></div><div class="reviewmeta">${weekdayName(date)} · ${legacyDate(date)} · ${period.startTime} – ${period.endTime}</div><div class="reviewgrid"><div class="reviewcell present"><strong>${tally.present}</strong><span>Present</span></div><div class="reviewcell absent"><strong>${tally.absent}</strong><span>Absent</span></div><div class="reviewcell unmarked"><strong>${tally.unmarked}</strong><span>Unmarked</span></div></div><div class="modalbody">${absent.length?`<p class="namelist"><strong>Absent:</strong> ${esc(absent.join(', '))}</p>`:''}${partial&&unmarked.length?`<p class="namelist warn"><strong>${unmarked.length} unmarked:</strong> ${esc(unmarked.join(', '))} — recorded as absent.</p>`:''}<div class="reviewactions"><button data-close>Back to roster</button><button class="primary" id="confirmSave">${partial?'Save partial session':'Confirm & save'}</button></div></div>`;$('#dialog').showModal();}
```

Update `refreshRegister()` to end with `updateSaveBar(tally);`.

- [ ] **Step 3: Wire the handlers**

In the click handler, replace the save branch with the two-step flow and add the confirm branch before it:

```js
 if(b.id==='confirmSave'){const partial=markTally(marks,students).unmarked>0;const rows=makeSession(records,routine[periodIndex],legacyDate(date),marks,{allowPartial:partial});const tally=markTally(marks,students);busy=true;b.disabled=true;b.textContent='Saving…';try{await saveRows(rows);$('#dialog').close();toast(saveToast(tally,partial));}finally{busy=false;b.disabled=false;b.textContent=partial?'Save partial session':'Confirm & save';render();}return;}
 if(b.id==='save'){reviewDialog(routine[periodIndex],false);return;}
 if(b.id==='savepartial'){reviewDialog(routine[periodIndex],true);return;}
```

- [ ] **Step 4: Style the review step**

Append to the end of `web/styles.css`:

```css
/* ==== Review step (cycle A) ==== */
.reviewmeta{padding:0 24px 16px;font-size:13px;color:#4c5847}
.reviewgrid{display:flex;gap:12px;padding:0 24px 4px}
.reviewcell{flex:1;border:1px solid var(--line);border-radius:10px;padding:14px;text-align:center;font-size:12px;font-weight:600}
.reviewcell strong{display:block;font:700 24px 'Manrope',sans-serif;margin-bottom:4px}
.reviewcell.present{color:#186b3f;border-color:#cfe6d5;background:#f2f9f4}
.reviewcell.absent{color:#a3232a;border-color:#f0d2d3;background:#fdf4f4}
.reviewcell.unmarked{color:#8a5a08;border-color:#f2dfb6;background:#fefaf0}
.namelist{font-size:12px;line-height:1.7;color:#6f7a68;margin:14px 0 0}
.namelist.warn{color:#8a5a08}
.reviewactions{display:flex;gap:10px;justify-content:flex-end;margin-top:22px}
.reviewactions button{min-height:44px}
.saveactions{display:flex;gap:10px;align-items:center}
.savebar .secondary{background:#fff;color:#394b31;border-color:#c9d0c2}
@media(max-width:720px){.reviewgrid{flex-direction:column}.reviewactions{flex-direction:column-reverse}.reviewactions button{width:100%}}
```

- [ ] **Step 5: Verify**

Run: `grep -c "confirmSave\|savepartial" web/app.js`
Expected: PASS — prints `4` or more.

Run: `node --check web/app.js && npm test`
Expected: PASS — no syntax errors, 19 tests pass.

Manual check with `ADMIN_PASSWORD=local-verification-password npm start`: with everyone unmarked the Save button is disabled and the bar reads "45 students unmarked — mark them, or save this session as partial."; after All present the Save enables and the partial button hides; leaving two students unmarked keeps Save disabled and shows "Save as partial (43/45)…"; both paths open the dialog with the course, weekday, date, period times and matching counts; Esc and Back return to the roster with every mark intact; confirming a partial save writes 43 rows, flags the session "Partial · 43/45" in Reports, and the toast names the 2 unmarked students.

- [ ] **Step 6: Commit**

```bash
git add web/app.js web/styles.css
git commit -m "Gate the register behind a review step with partial saves"
```

---

## Task 6: Make the save bar usable on a phone

**Files:**
- Modify: `web/styles.css` (append mobile rules)

**Interfaces:**
- Consumes: the `#savebar`/`.saveactions` markup from Task 5.
- Produces: no code interfaces; layout behaviour only.

- [ ] **Step 1: Add the mobile rules**

Append to the end of `web/styles.css`:

```css
/* ==== Phone ergonomics for the register (cycle A) ==== */
@media(max-width:720px){
 .savebar{position:sticky;bottom:0;margin:0 -17px;border-radius:12px 12px 0 0;border-left:0;border-right:0;border-bottom:0;padding:12px 14px calc(12px + env(safe-area-inset-bottom));z-index:30;flex-direction:column;align-items:stretch;gap:10px}
 .savebar strong{font-size:13px;line-height:1.5}
 .saveactions{flex-direction:column;gap:8px}
 .saveactions button{width:100%;min-height:44px;font-size:13px}
 .tablewrap{padding-bottom:88px}
}
```

- [ ] **Step 2: Verify the desktop layout is unchanged**

Run: `node --check web/app.js && npm test`
Expected: PASS — 19 tests pass.

Manual check with `ADMIN_PASSWORD=local-verification-password npm start`: at desktop width the save bar looks as before; resizing below 720px makes it edge-to-edge with stacked, full-width buttons; the last student can be scrolled clear of the bar; printing the register still hides the bar and the mark buttons.

- [ ] **Step 3: Commit**

```bash
git add web/styles.css
git commit -m "Make the register save bar usable one-handed on a phone"
```

---

## Task 7: Update the docs and run the full verification

**Files:**
- Modify: `README.md` (lines 57–93)
- Modify: `WEB_GUIDE.md` (lines 21–22, 26, 75)

**Interfaces:**
- Consumes: everything above.
- Produces: no code interfaces.

- [ ] **Step 1: Update README's displayed fields and status section**

In `README.md`, replace:

```
Attended classes

Total classes

Attendance percentage
```

with:

```
Attended classes

Classes held

Current attendance (present ÷ classes held)

Semester progress (present ÷ planned classes)
```

Replace `The system categorizes attendance percentage as:` with `The system categorizes current attendance as:`, and after the `At Risk` row add:

```
No classes held yet

No classes yet
```

- [ ] **Step 2: Update WEB_GUIDE's rule table and notes**

In `WEB_GUIDE.md`, replace the two table rows:

```
| Present ÷ fixed course total × 100 | `web/core.js`, capped at 100% |
| 85 / 70 / 60 thresholds | Excellent / Good / Warning / At Risk |
```

with:

```
| Present ÷ classes held | **Current attendance**, drives the status badge |
| Present ÷ fixed course total × 100 | **Semester progress**, capped at 100% |
| 85 / 70 / 60 thresholds | Excellent / Good / Warning / At Risk, plus "No classes yet" when nothing is recorded |
```

Replace the recorded-presence paragraph (`The UI also displays **recorded presence**, …`) with:

```
A course's **classes held** is the count of distinct `(date, time slot)` sessions with records. A student left unmarked in a session has no present record for it and is treated as absent; saving a session with unmarked students therefore requires the deliberate "Save as partial" path, and a review dialog states the Present, Absent and Unmarked counts before anything is written.
```

Replace the `npm test` sentence with:

```
`npm test` checks the exact catalog size, current-attendance and semester-progress semantics, the planned-total cap, boundary thresholds, zero-classes-held handling, classes-held counting, partial sessions, bulk and mixed attendance, duplicate rejection, date validation, file round trips, authentication, origin rejection, transaction rollback, logout and persistence across backend restarts. UI functionality should additionally be checked in a browser before expanding this into an institution-wide deployment.
```

- [ ] **Step 3: Run the full verification**

```bash
npm test
node --check web/app.js
grep -n "percentage(\|recordedRate(\|\b45\b\|registersummary" web/app.js
```
Expected: 19 tests pass; no syntax errors; the grep prints nothing.

- [ ] **Step 4: Desktop walkthrough**

Run: `ADMIN_PASSWORD=local-verification-password npm start` and open `http://localhost:3000`.
Confirm in order: dashboard (Average current attendance "—", chart with "—", snapshot columns), students page (both metrics, status filter including "No classes yet"), profile dialog (both metrics per course), reports matrix switch, CSV download with both labelled metric groups, register gate and review dialog, and that an existing saved session still opens read-only with its counts.

- [ ] **Step 5: Hand the phone checklist to the requester**

Ask the requester to open the site (or the LAN dev server) on their phone and report on each item:

1. Take attendance opens with all 45 students unmarked, yellow "Unmarked" chips and counters 0/0/45.
2. Tap All present: counters read 45/0/0, the chips disappear, and the Save button enables.
3. Tap Absent on two students: counters read 43/2/0 and those rows turn red.
4. Tap Unmarked only: the table empties to "Every student is marked."
5. Mark three students back to Present after a fresh render, leave them unmarked instead, and confirm the amber chips and counters reflect it.
6. Try to save with students unmarked: Save is disabled and the bar explains why; tapping Save as partial opens the confirmation.
7. Confirm the dialog matches the roster exactly, then confirm and check the toast and the Reports entry.
8. Confirm the save bar sits at the bottom of the screen, is reachable with a thumb, and no row is trapped behind it.
9. Confirm nothing jumps, no dialog traps focus off-screen, and the page still scrolls normally.

- [ ] **Step 6: Commit**

```bash
git add README.md WEB_GUIDE.md
git commit -m "Document current attendance and semester progress"
```

---

## Verification handoff

Sub-project A is complete when: `npm test` and `node --check web/app.js` pass; the greps for `percentage(`, `recordedRate(`, `registersummary` and the literal `45` in `web/app.js` are empty; the desktop walkthrough in Task 7 Step 4 passes; and the requester has reported on the Task 7 Step 5 phone checklist. Only then does cycle B (attendance correction and audit) begin, starting from its own spec.

Known and intended after this cycle: existing saved data will read very differently (1 present of 48 planned was 2.1% At Risk, and becomes 100% Excellent — 1 of 1 class held), saved sessions stay read-only until cycle B, and the visual system beyond the register is untouched until cycle C.
