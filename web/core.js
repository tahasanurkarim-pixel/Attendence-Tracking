import { catalog } from './catalog.js';
export const key = r => [r.studentId,r.courseCode,r.date,r.timeSlot].join('|');
export const sessionKey = r => [r.courseCode,r.date,r.timeSlot].join('|');
export function percentage(records,id,code) {
  const total=catalog.courses.find(c=>c.code===code)?.totalClasses || 0;
  const attended=records.filter(r=>r.studentId===id && r.courseCode===code && r.present).length;
  return total ? Math.min(100,attended/total*100) : 0;
}
export function status(p) { return p>=85?'Excellent':p>=70?'Good':p>=60?'Warning':'At Risk'; }
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
