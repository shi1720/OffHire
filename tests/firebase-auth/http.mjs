import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Run only against a local production Next server connected to demo emulators.
// The allowed operator email is synthetic and no CALL-E jobs are dispatched.
const base=process.env.OFFHIRE_AUTH_HTTP_ORIGIN||'http://127.0.0.1:3400';
const authHost=process.env.OFFHIRE_AUTH_TEST_HOST||'127.0.0.1:9199';
const ownerEmail=process.env.OFFHIRE_AUTH_HTTP_OWNER||'operator@example.test';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
assert.match(authHost,/^(127\.0\.0\.1|localhost):\d+$/);
assert.match(ownerEmail,/@example\.test$/);
const here=path.dirname(fileURLToPath(import.meta.url));
const runtime=path.join(here,'.runtime');
const suffix=randomUUID().replaceAll('-','');
const results=[];
async function test(name,fn){try{await fn();results.push({name,status:'passed'});console.log(`PASS ${name}`);}catch(e){results.push({name,status:'failed',error:e.message});console.log(`FAIL ${name}: ${e.message}`);}}
async function api(p,{method='GET',cookie,body,headers={},origin=base}={}){
 const h=new Headers(headers);if(cookie)h.set('cookie',cookie);
 if(method==='POST'){if(origin!==null)h.set('origin',origin);h.set('content-type','application/json');}
 return fetch(base+p,{method,headers:h,...(body!==undefined?{body:JSON.stringify(body)}:{}),redirect:'manual'});
}
async function google(email,verified=true){
 const response=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=test-only`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestUri:'http://localhost',postBody:new URLSearchParams({providerId:'google.com',id_token:JSON.stringify({sub:`http-google-${email}`,email,email_verified:verified})}).toString(),returnSecureToken:true})});
 const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;
}
const cfg=await api('/api/auth/config');const config=await cfg.json();
assert.equal(config.provider,'firebase');assert.equal(config.firebase.projectId,'demo-offhire','Do not run HTTP integration against a real Firebase project');
const account=await google(ownerEmail);
let cookie;
await test('Production HTTP server mints operator cookie from emulator Google token',async()=>{
 const res=await api('/api/auth/session',{method:'POST',body:{idToken:account.idToken}});assert.equal(res.status,200,await res.text());
 const full=res.headers.get('set-cookie');assert.ok(full);for(const attr of ['HttpOnly','SameSite=Lax','Secure','Path=/','Max-Age=86400'])assert.ok(full.includes(attr));cookie=full.split(';')[0];
});
await test('HTTP authenticated live state is accessible and calls remain disabled',async()=>{
 const res=await api('/api/state?mode=live',{cookie});assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'private, no-store');const data=await res.json();assert.equal(data.mode,'live');assert.equal(data.connection.owner,true);assert.equal(data.connection.email,ownerEmail);assert.equal(data.connection.liveEnabled,false);
});
await test('HTTP anonymous and forged Sites identities cannot read live state or evidence export',async()=>{
 const headers={'oai-authenticated-user-id':account.localId,'oai-authenticated-user-email':ownerEmail};
 for(const p of ['/api/state?mode=live','/api/export?mode=live','/api/audit?mode=live'])assert.equal((await api(p,{headers})).status,403);
});
await test('HTTP nonallowlisted Google user denied even with forged Sites headers',async()=>{
 const other=await google(`http-other-${suffix}@example.test`);assert.equal((await api('/api/auth/session',{method:'POST',body:{idToken:other.idToken},headers:{'oai-authenticated-user-email':ownerEmail,'oai-authenticated-user-id':account.localId}})).status,403);
});
await test('HTTP ID token cannot replace server session cookie',async()=>{
 assert.equal((await api('/api/state?mode=live',{cookie:`__session=${account.idToken}`})).status,403);
});
await test('HTTP stale ID-token authentication time denied',async()=>{
 const parts=account.idToken.split('.');const payload=JSON.parse(Buffer.from(parts[1],'base64url'));payload.auth_time=Math.floor(Date.now()/1000)-600;parts[1]=Buffer.from(JSON.stringify(payload)).toString('base64url');
 const res=await api('/api/auth/session',{method:'POST',body:{idToken:parts.join('.')}});assert.equal(res.status,403);assert.match((await res.json()).error,/fresh operator session/);
});
await test('HTTP absent, hostile, and cross-site origins cannot mutate session',async()=>{
 for(const options of [{origin:null},{origin:'https://attacker.example'},{headers:{'sec-fetch-site':'cross-site'}},{origin:'https://attacker.example',headers:{'x-forwarded-host':'127.0.0.1:3400','x-forwarded-proto':'http'}}])assert.equal((await api('/api/auth/logout',{method:'POST',body:{},cookie,...options})).status,403);
});
await test('HTTP signed-in demo remains separate from matching anonymous hash cookie',async()=>{
 const res=await api('/api/state?mode=demo',{cookie});assert.equal(res.status,200);assert.equal(res.headers.get('set-cookie'),null);const signed=await res.json();
 const hash=createHash('sha256').update(account.localId).digest('hex');const a=await api('/api/state?mode=demo',{cookie:`__session=demo.${hash}`});assert.equal(a.status,200);const anon=await a.json();
 assert.equal(signed.rentals[0].workspaceId,`demo-user-${hash}`);assert.equal(anon.rentals[0].workspaceId,`demo-${hash}`);
 assert.notEqual(anon.rentals[0].workspaceId,signed.rentals[0].workspaceId);
 assert.equal((await api(`/api/rentals/${signed.rentals[0].id}/plan?mode=demo`,{method:'POST',cookie:`__session=demo.${hash}`,body:{scenario:'confirmed'}})).status,404);
});
await test('HTTP independent anonymous demos cannot plan each other’s asset',async()=>{
 const first=await api('/api/state?mode=demo');const firstData=await first.json();
 const second=await api('/api/state?mode=demo');const secondData=await second.json();const cookieB=second.headers.get('set-cookie').split(';')[0];
 assert.notEqual(firstData.rentals[0].workspaceId,secondData.rentals[0].workspaceId);
 assert.equal((await api(`/api/rentals/${firstData.rentals[0].id}/plan?mode=demo`,{method:'POST',cookie:cookieB,body:{scenario:'confirmed'}})).status,404);
});
await test('HTTP logout expires the browser session cookie',async()=>{
 const res=await api('/api/auth/logout',{method:'POST',cookie,body:{}});assert.equal(res.status,200);assert.match(res.headers.get('set-cookie'),/^__session=;/);assert.ok(res.headers.get('set-cookie').includes('Max-Age=0'));
});
await mkdir(runtime,{recursive:true});
await writeFile(path.join(runtime,'http-results.json'),JSON.stringify({ranAt:new Date().toISOString(),source:'Running production Next server via real HTTP',origin:base,project:'demo-offhire',scope:'Local emulator identity tokens, server session exchange and Firestore state. No live calls, customer data, global emulator resets, or revocation of the shared HTTP operator. Does not prove Google popup/browser cookies or production signed-JWT verification.',results},null,2));
console.log(`${results.filter(r=>r.status==='passed').length} passed; ${results.filter(r=>r.status==='failed').length} failed`);
process.exitCode=results.some(r=>r.status==='failed')?1:0;
