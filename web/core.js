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
export function validDate(s) {
  if(typeof s!=='string' || !/^\d{2}-\d{2}-\d{4}$/.test(s)) return false;
  const [d,m,y]=s.split('-').map(Number), dt=new Date(Date.UTC(y,m-1,d));
  return y>=1900 && y<=9999 && dt.getUTCFullYear()===y && dt.getUTCMonth()===m-1 && dt.getUTCDate()===d;
}
export function validateRecords(rows) {
  if(!Array.isArray(rows) || rows.length>100000) throw Error('Invalid records or file too large.');
  const seen=new Set();
  return rows.map((r,i)=>{
    if(!r || !catalog.students.some(s=>s.id===r.studentId) || !validDate(r.date) || typeof r.present!=='boolean' || !catalog.routine.some(p=>p.courseCode===r.courseCode && p.startTime===r.timeSlot)) throw Error(`Invalid student, course, date, time or status on row ${i+1}.`);
    const clean={studentId:r.studentId,courseCode:r.courseCode,date:r.date,timeSlot:r.timeSlot,present:r.present};
    if(seen.has(key(clean))) throw Error(`Duplicate record on row ${i+1}.`);
    seen.add(key(clean)); return clean;
  });
}
export function mergeRecords(existing,incoming) {
  const clean=validateRecords(incoming), seen=new Set(existing.map(key));
  if(clean.some(r=>seen.has(key(r)))) throw Error('Attendance already exists for a student in this session. No records were changed.');
  return [...existing,...clean];
}
export function makeSession(existing,period,date,marks) {
  if(!catalog.routine.some(p=>p.day===period?.day && p.courseCode===period.courseCode && p.startTime===period.startTime)) throw Error('Choose a scheduled class.');
  if(catalog.students.some(s=>typeof marks[s.id]!=='boolean')) throw Error('Mark every student before saving.');
  const rows=catalog.students.map(s=>({studentId:s.id,courseCode:period.courseCode,date,timeSlot:period.startTime,present:marks[s.id]}));
  mergeRecords(existing,rows); return rows;
}
export function parseLegacy(text) {
  return validateRecords(text.split(/\r?\n/).filter(l=>l.trim()&&!l.startsWith('#')).map((l,i)=>{
    const a=l.split('|');
    if(a.length!==5 || !['0','1'].includes(a[4])) throw Error(`Invalid C++ format on row ${i+1}. Expected StudentID|CourseCode|Date|TimeSlot|Present.`);
    return {studentId:a[0],courseCode:a[1],date:a[2],timeSlot:a[3],present:a[4]==='1'};
  }));
}
export const toLegacy = rows => '# Attendance Data File\n# Format: StudentID|CourseCode|Date|TimeSlot|Present\n'+rows.map(r=>[r.studentId,r.courseCode,r.date,r.timeSlot,r.present?1:0].join('|')).join('\n')+'\n';
