import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
process.env.NODE_ENV='test';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'engx-control-'));
process.env.DATABASE_PATH=path.join(dir,'test.sqlite');
process.env.JWT_SECRET=crypto.randomBytes(32).toString('hex');
const {app,db}=await import('./server.mjs');
const server=http.createServer(app); await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const password='Test-only-long-password-123';
async function req(url,method='GET',body,token){ const r=await fetch(base+url,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})}); let data;try{data=await r.json()}catch{data={}}return [r.status,data]; }
const code=(purpose)=>JSON.parse(execFileSync(process.execPath,[new URL('./control-cli.mjs',import.meta.url).pathname,purpose],{env:process.env,encoding:'utf8'})).code;
const empty=()=>({workspaceIds:[],domains:[],recordTypes:[],canViewUsers:false,canViewAudit:false,canSuspendMembers:false});
let primary,one,two,assistant,assistantBody;
await test('control plane security and scope boundaries',async(t)=>{
 t.after(async()=>{await new Promise(r=>server.close(r));db.close();fs.rmSync(dir,{recursive:true,force:true});});
 await t.test('requires a console-generated one-time setup code',async()=>{
  assert.equal((await req('/api/control/status'))[1].configured,false);
  assert.equal((await req('/api/control/setup','POST',{code:'not-a-real-code',email:'primary@example.test',name:'Primary',password}))[0],400);
  const setupCode=code('setup-code'); const [s,b]=await req('/api/control/setup','POST',{code:setupCode,email:'primary@example.test',name:'Primary',password}); assert.equal(s,201);primary=b.token;assert.equal(b.account.role,'primary');
  assert.equal((await req('/api/control/setup','POST',{code:setupCode,email:'another@example.test',name:'Other',password}))[0],409);
  assert.equal((await req('/api/control/status'))[1].configured,true);
 });
 await t.test('isolates ordinary and control tokens',async()=>{
  for (const [key,email] of [['one','one@example.test'],['two','two@example.test']]){const [s,b]=await req('/api/auth/register','POST',{email,name:key,password});assert.equal(s,201);if(key==='one')one=b;else two=b;}
  assert.equal((await req('/api/control/me','GET',undefined,one.token))[0],401);
  assert.equal((await req('/api/me','GET',undefined,primary))[0],401);
  assert.equal((await req('/api/control/assistants'))[0],401);
  const stamp=new Date().toISOString();
  for(const [wid,domain,type,name] of [[one.workspace.id,'medical','device','ALLOWED'],[one.workspace.id,'mobiles','device','WRONG_DOMAIN'],[one.workspace.id,'medical','part','WRONG_TYPE'],[two.workspace.id,'medical','device','WRONG_WORKSPACE']]) db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),wid,stamp,stamp,null,one.user.id,domain,type,JSON.stringify({name}),1);
  db.prepare('INSERT INTO memberships VALUES (?,?,?,?,?)').run(crypto.randomUUID(),two.workspace.id,one.user.id,'technician','active');
 });
 await t.test('supports exactly three assistants and empty grants deny data',async()=>{
  assistantBody={name:'Assistant one',email:'assistant@example.test',password,active:true,grants:empty()};
  assert.equal((await req('/api/control/assistants/4','PUT',assistantBody,primary))[0],400);
  assert.equal((await req('/api/control/assistants/1','PUT',assistantBody,primary))[0],200);
  const [s,b]=await req('/api/control/login','POST',{email:assistantBody.email,password});assert.equal(s,200);assistant=b.token;
  const ov=(await req('/api/control/overview','GET',undefined,assistant))[1];assert.deepEqual(ov.workspaces,[]);assert.ok(!ov.users||!ov.users.length);assert.deepEqual((await req('/api/control/records','GET',undefined,assistant))[1].records,[]);
  assert.equal((await req('/api/control/assistants','GET',undefined,assistant))[0],403);
  assert.equal((await req('/api/control/assistants/1','PUT',assistantBody,assistant))[0],403);
  assert.equal((await req('/api/control/assistants/0','PUT',assistantBody,assistant))[0],403);
 });
 await t.test('enforces workspace, domain and type scope including omitted filters',async()=>{
  assistantBody.grants={workspaceIds:[one.workspace.id],domains:['medical'],recordTypes:['device'],canViewUsers:true,canViewAudit:true,canSuspendMembers:true};
  assert.equal((await req('/api/control/assistants/1','PUT',assistantBody,primary))[0],200);
  assistant=(await req('/api/control/login','POST',{email:assistantBody.email,password}))[1].token;
  const [status,b]=await req('/api/control/records','GET',undefined,assistant);assert.equal(status,200);assert.deepEqual(b.records.map(r=>r.data.name),['ALLOWED']);
  for(const query of [`workspace_id=${two.workspace.id}`,`domain=mobiles`,`type=part`])assert.equal((await req('/api/control/records?'+query,'GET',undefined,assistant))[0],403);
  const ov=(await req('/api/control/overview','GET',undefined,assistant))[1];assert.deepEqual(ov.workspaces.map(w=>w.id),[one.workspace.id]);for(const u of ov.users)for(const m of u.memberships)assert.equal(m.workspace_id,one.workspace.id);
  assert.equal((await req('/api/control/memberships','PATCH',{workspace_id:two.workspace.id,user_id:one.user.id,status:'suspended'},assistant))[0],403);
  assert.equal((await req('/api/control/memberships','PATCH',{workspace_id:one.workspace.id,user_id:one.user.id,status:'suspended'},assistant))[0],403);
  const assistantAudit=(await req('/api/control/audit','GET',undefined,assistant))[1].events;assert.ok(assistantAudit.every(e=>e.workspace_id===one.workspace.id&&e.domain==='medical'&&e.entity_type==='device'));
 });
 await t.test('revokes suspended sessions and validates grants',async()=>{
  assert.equal((await req('/api/control/assistants/1','PUT',{...assistantBody,grants:{...assistantBody.grants,domains:['*']}},primary))[0],400);
  assert.equal((await req('/api/control/assistants/1','PUT',{...assistantBody,active:false},primary))[0],200);
  assert.equal((await req('/api/control/me','GET',undefined,assistant))[0],401);
  assert.equal((await req('/api/control/login','POST',{email:assistantBody.email,password}))[0],401);
 });
 await t.test('resets primary only with a bound one-time code and invalidates old sessions',async()=>{
  const resetCode=code('reset-primary');const newPassword='Changed-long-password-456';
  assert.equal((await req('/api/control/reset','POST',{code:resetCode,email:'someone@example.test',password:newPassword}))[0],400);
  const [s,b]=await req('/api/control/reset','POST',{code:resetCode,email:'primary@example.test',password:newPassword});assert.equal(s,200);const old=primary;primary=b.token;
  assert.equal((await req('/api/control/me','GET',undefined,old))[0],401);
  assert.equal((await req('/api/control/reset','POST',{code:resetCode,email:'primary@example.test',password:newPassword}))[0],400);
  assert.equal((await req('/api/control/login','POST',{email:'primary@example.test',password}))[0],401);
  const newer='Changed-again-password-789';const [ps,pb]=await req('/api/control/password','POST',{currentPassword:newPassword,newPassword:newer},primary);assert.equal(ps,200);assert.equal((await req('/api/control/me','GET',undefined,primary))[0],401);primary=pb.token;
 });
 await t.test('audits sensitive reads and changes without credential material',async()=>{
  await req('/api/control/records','GET',undefined,primary); const [s,b]=await req('/api/control/audit','GET',undefined,primary);assert.equal(s,200);
  assert.ok(b.events.some(e=>e.action==='records_read'));assert.ok(b.events.some(e=>e.action==='assistant_changed'));assert.ok(b.events.some(e=>e.action==='primary_reset'));
  const text=JSON.stringify(b);assert.ok(!text.includes(password));assert.ok(!text.includes('password_hash'));assert.ok(!text.includes(primary));
 });
});
