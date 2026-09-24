import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.js';
import {catalog} from '../web/catalog.js';
import {makeSession} from '../web/core.js';
test('Authenticated API, CORS, atomic duplicates, logout and disk persistence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rollcall-test-')),dbPath=join(dir,'test.sqlite');
 let app=createApp({dbPath,password:'test-password-for-local-tests',origin:'https://example.com'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.server.address().port;
 const req=(path,body,token,origin)=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(origin?{Origin:origin}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{
 assert.equal((await req('/api/records')).status,401);
 assert.equal((await req('/api/login',{password:'wrong'})).status,401);
 assert.equal((await req('/api/health',undefined,undefined,'https://evil.example')).status,403);
 const login=await req('/api/login',{password:'test-password-for-local-tests'});assert.equal(login.status,200);const {token}=await login.json();
 const rows=makeSession([],catalog.routine[0],'06-09-2025',Object.fromEntries(catalog.students.map(s=>[s.id,true])));
 assert.equal((await req('/api/records',{records:rows},token)).status,201);
 const newer={...rows[0],date:'07-09-2025'};
 assert.equal((await req('/api/records',{records:[newer,rows[1]]},token)).status,409);
 assert.equal((await(await req('/api/records',undefined,token)).json()).records.length,45);
 assert.equal((await req('/api/records',{records:[{...newer,present:'yes'}]},token)).status,400);
 assert.equal((await req('/api/logout',{},token)).status,200);
 assert.equal((await req('/api/records',undefined,token)).status,401);
 await new Promise(r=>app.server.close(r));app.db.close();
 app=createApp({dbPath,password:'test-password-for-local-tests'});
 assert.equal(app.db.prepare('SELECT count(*) AS n FROM records').get().n,45);
 }finally{app.server.closeAllConnections();if(app.server.listening)await new Promise(r=>app.server.close(r));app.db.close();rmSync(dir,{recursive:true,force:true});}
});
