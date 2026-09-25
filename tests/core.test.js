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
 assert.ok(Math.abs(studentMetrics(session(),'C251027','EEE-1121').semesterProgress-1/48*100)<1e-9);
 let rows=[];for(let day=1;day<=30;day++)for(const month of ['09','10'])rows=[...rows,...makeSession(rows,saturday,String(day).padStart(2,'0')+'-'+month+'-2025',marks)];
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
