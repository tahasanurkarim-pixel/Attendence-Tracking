import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {validateRecords} from '../web/core.js';

export function createApp({dbPath='data/attendance.sqlite',password=process.env.ADMIN_PASSWORD,origin=process.env.ALLOWED_ORIGIN||'http://localhost:3000'}={}){
 if(!password||password.length<16)throw Error('Set ADMIN_PASSWORD to at least 16 characters.');
 if(dbPath!==':memory:')mkdirSync(dirname(resolve(dbPath)),{recursive:true});
 const db=new DatabaseSync(dbPath);db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
 db.exec(`CREATE TABLE IF NOT EXISTS records(studentId TEXT NOT NULL,courseCode TEXT NOT NULL,date TEXT NOT NULL,timeSlot TEXT NOT NULL,present INTEGER NOT NULL CHECK(present IN (0,1)),PRIMARY KEY(studentId,courseCode,date,timeSlot)); CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at TEXT NOT NULL,event TEXT NOT NULL,count INTEGER NOT NULL);`);
 const salt=randomBytes(16),hash=scryptSync(password,salt,64),sessions=new Map();
 let attempts=0,windowStart=Date.now();
 const root=fileURLToPath(new URL('../web/',import.meta.url));
 const all=()=>db.prepare('SELECT * FROM records ORDER BY rowid').all().map(r=>({...r,present:!!r.present}));
 const digest=s=>createHash('sha256').update(s).digest('hex');
 const server=http.createServer(async(req,res)=>{
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.headers.origin){if(req.headers.origin!==origin)return send(403,{error:'Origin is not allowed.'});res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.writeHead(204);return res.end();}
  try{
   if(path==='/api/health'&&req.method==='GET')return send(200,{ok:true});
   if(!path.startsWith('/api/')){
    if(req.method!=='GET')return send(405,{error:'Method not allowed.'});
    const filename=path==='/'?'index.html':decodeURIComponent(path.slice(1));
    if(!['index.html','styles.css','app.js','core.js','catalog.js','favicon.svg'].includes(filename))return send(404,{error:'Not found.'});
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(filename)]+'; charset=utf-8');return res.end(readFileSync(resolve(root,filename)));
   }
   let body;
   if(req.method==='POST'){
    if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'Expected application/json.'});
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>20000000)return send(413,{error:'Request too large.'});chunks.push(chunk);}
    try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return send(400,{error:'Invalid JSON.'});}
   }
   if(path==='/api/login'&&req.method==='POST'){
    if(Date.now()-windowStart>60000){windowStart=Date.now();attempts=0;}
    if(++attempts>15)return send(429,{error:'Too many login attempts. Try again in one minute.'});
    if(typeof body?.password!=='string'||body.password.length>1024||!timingSafeEqual(hash,scryptSync(body.password,salt,64)))return send(401,{error:'Incorrect password.'});
    for(const [k,v] of sessions)if(v<Date.now())sessions.delete(k);
    const token=randomBytes(32).toString('hex');sessions.set(digest(token),Date.now()+8*3600000);return send(200,{token,expiresIn:28800});
   }
   const token=req.headers.authorization?.replace(/^Bearer /,'')||'',tokenHash=digest(token);
   if(!sessions.has(tokenHash)||sessions.get(tokenHash)<Date.now())return send(401,{error:'Session expired. Sign in again.'});
   if(path==='/api/logout'&&req.method==='POST'){sessions.delete(tokenHash);return send(200,{ok:true});}
   if(path==='/api/records'&&req.method==='GET')return send(200,{records:all()});
   if(path==='/api/records'&&req.method==='POST'){
    let rows;try{rows=validateRecords(body?.records);if(!rows.length)throw Error('No records supplied.');}catch(e){return send(400,{error:e.message});}
    db.exec('BEGIN IMMEDIATE');
    try{const insert=db.prepare('INSERT INTO records VALUES(?,?,?,?,?)');for(const r of rows)insert.run(r.studentId,r.courseCode,r.date,r.timeSlot,Number(r.present));db.prepare('INSERT INTO audit(at,event,count) VALUES(?,?,?)').run(new Date().toISOString(),'records.import',rows.length);db.exec('COMMIT');}
    catch(e){db.exec('ROLLBACK');if(e.message.includes('UNIQUE'))return send(409,{error:'Duplicate attendance. No records were changed.'});throw e;}
    return send(201,{inserted:rows.length});
   }
   return send(404,{error:'Not found.'});
  }catch(e){console.error('Request failed:',e.message);if(!res.headersSent)send(500,{error:'The server could not complete this request.'});else res.end();}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;
 return {server,db};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {server}=createApp({dbPath:process.env.DB_PATH||'data/attendance.sqlite'});
 server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Rollcall server listening.'));
}
