import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const base=process.env.PUBLIC_TEST_URL || 'http://127.0.0.1:3001';
const checks=[];
async function session(){const r=await fetch(base+'/api/session',{method:'POST',redirect:'manual'});assert.equal(r.status,200);assert.equal((await r.json()).mode,'guest');const cookie=r.headers.get('set-cookie');assert.ok(cookie?.includes('HttpOnly'));return cookie.split(';')[0];}
async function api(path,cookie,body){return fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
const a=await session(),b=await session();assert.notEqual(a,b);
const anonymous=await fetch(base+'/api/projects');assert.equal(anonymous.status,401);checks.push('missing cookie is rejected');
const list=await api('/api/projects',a);assert.equal(list.status,200);assert.deepEqual((await list.json()).projects,[]);checks.push('fresh visitor sees no existing private projects');
const made=await api('/api/projects',a,{sample:true});assert.equal(made.status,201);const project=await made.json();
assert.equal((await api('/api/projects/'+project.id,b)).status,404);checks.push('second visitor cannot access first visitor project');
const read=await api('/api/projects/'+project.id,a);assert.equal(read.status,200);checks.push('same cookie persists visitor project');
const tampered=a.slice(0,-1)+(a.endsWith('0')?'1':'0');assert.equal((await api('/api/projects',tampered)).status,401);checks.push('tampered cookie rejected');
const foreign=await fetch(base+'/api/session',{method:'POST',headers:{Origin:'https://example.org'}});assert.equal(foreign.status,403);checks.push('foreign origin cannot establish session');
const run=await fetch(base+'/api/projects/'+project.id+'/process',{method:'POST',headers:{Cookie:b}});assert.equal(run.status,404);checks.push('cloud queue cannot execute another visitor project');
const paper=project.state.papers[0];const material=await api(`/api/projects/${project.id}/papers/${paper.id}`,a);assert.equal(material.status,200);checks.push('guest can read stored demo source');
writeFileSync('outputs/revalidation-public/public-access.json',JSON.stringify({base,checks,at:new Date().toISOString()},null,2));console.log({passed:checks.length,base});
