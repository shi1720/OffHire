import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// This suite can only touch explicitly local emulators and a demo project.
// It never dispatches a CALL-E job or uses a real phone/token/account.
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const runtime=path.join(here,'.runtime');
const project=process.env.OFFHIRE_AUTH_TEST_PROJECT||'demo-offhire';
const authHost=process.env.OFFHIRE_AUTH_TEST_HOST||'127.0.0.1:9199';
const firestoreHost=process.env.OFFHIRE_AUTH_TEST_FIRESTORE||'127.0.0.1:8180';
assert.match(project,/^demo-[a-z0-9-]+$/);
for(const host of [authHost,firestoreHost])assert.match(host,/^(127\.0\.0\.1|localhost):\d+$/);
const origin='https://offhire-auth-test.example';
const suffix=randomUUID().replaceAll('-','');
const ownerEmail=`owner-${suffix}@example.test`;
const passwordEmail=`password-${suffix}@example.test`;
const owners=`${ownerEmail},${passwordEmail}`;
Object.assign(process.env,{
 OFFHIRE_RUNTIME:'firebase',GOOGLE_CLOUD_PROJECT:project,GCLOUD_PROJECT:project,
 FIREBASE_AUTH_EMULATOR_HOST:authHost,FIRESTORE_EMULATOR_HOST:firestoreHost,
 OFFHIRE_PUBLIC_ORIGIN:origin,OFFHIRE_OWNER_EMAILS:owners,
 OFFHIRE_ENABLE_LIVE:'false',CALLE_API_KEY:'',FIREBASE_WEB_API_KEY:'test-only',NODE_ENV:'test',
});
await mkdir(runtime,{recursive:true});
const bundle=path.join(runtime,'auth-route.mjs');
await build({stdin:{contents:`export * from './lib/server/firebase-session.ts'; export {GET,POST} from './app/api/[...path]/route.ts';`,resolveDir:root,loader:'ts'},
 outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',
 plugins:[{name:'cloudflare-env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'local-test'}));b.onLoad({filter:/.*/,namespace:'local-test'},()=>({contents:'export const env = process.env;',loader:'js'}));}}],
});
const app=await import(pathToFileURL(bundle));
const results=[];
async function test(name,fn){try{await fn();results.push({name,status:'passed'});console.log(`PASS ${name}`);}catch(e){results.push({name,status:'failed',error:e.message});console.log(`FAIL ${name}: ${e.message}`);}}
function request(p,{method='GET',cookie,body,headers={},urlBase=origin}={}){
 const h=new Headers(headers);if(cookie)h.set('cookie',cookie);
 if(method==='POST'){if(!h.has('origin'))h.set('origin',origin);h.set('content-type','application/json');}
 return new Request(urlBase+p,{method,headers:h,...(body!==undefined?{body:JSON.stringify(body)}:{})});
}
const call=(p,o)=>{const r=request(p,o);return r.method==='POST'?app.POST(r):app.GET(r);};
const forged={'oai-authenticated-user-id':'pretend-owner','oai-authenticated-user-email':ownerEmail};
let validClaims={uid:'test',email:ownerEmail,email_verified:true,firebase:{sign_in_provider:'google.com'}};

await test('Operator policy requires verified Google email and exact allowlist',()=>{
 assert.equal(app.allowedOperator(validClaims),true);
 for(const patch of [{email_verified:false},{email:`prefix-${ownerEmail}`},{firebase:{sign_in_provider:'password'}},{email:undefined}])assert.equal(app.allowedOperator({...validClaims,...patch}),false);
});
await test('Session creation requires explicit configured Origin',async()=>{
 const r=new Request(origin+'/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 assert.equal((await app.POST(r)).status,403);
});
await test('Cross-origin and cross-site session mutation denied',async()=>{
 assert.equal((await call('/api/auth/logout',{method:'POST',body:{},headers:{origin:'https://attacker.example'}})).status,403);
 assert.equal((await call('/api/auth/logout',{method:'POST',body:{},headers:{'sec-fetch-site':'cross-site'}})).status,403);
});
await test('Fixed public Origin works through internal Cloud Run URL',async()=>{
 assert.equal((await call('/api/auth/logout',{method:'POST',body:{},urlBase:'http://internal:8080'})).status,200);
 assert.equal((await call('/api/auth/logout',{method:'POST',body:{},urlBase:'http://internal:8080',headers:{origin:'https://attacker.example','x-forwarded-host':'offhire-auth-test.example','x-forwarded-proto':'https'}})).status,403);
});
await test('Firebase mode ignores forged Sites identity headers',async()=>{
 assert.equal((await call('/api/state?mode=live',{headers:forged})).status,403);
 assert.equal((await call('/api/export?mode=live',{headers:forged,cookie:`__session=demo.${'a'.repeat(64)}`})).status,403);
});
await test('Invalid token shapes are client errors',async()=>{
 for(const idToken of [null,{},'a'.repeat(8193)])assert.equal((await call('/api/auth/session',{method:'POST',body:{idToken}})).status,400);
});
await test('Production-style cookie has HttpOnly Secure SameSite and bounded age',()=>{
 const cookie=app.firebaseCookie('test-only',86400);
 for(const match of ['__session=test-only','HttpOnly','Secure','SameSite=Lax','Path=/','Max-Age=86400'])assert.ok(cookie.includes(match));
 assert.ok(!cookie.includes('Domain='));
});

let emulatorAvailable=false;
try {await fetch(`http://${authHost}/`,{signal:AbortSignal.timeout(2000)});await fetch(`http://${firestoreHost}/`,{signal:AbortSignal.timeout(2000)});emulatorAvailable=true;}catch{}
if(!emulatorAvailable){
 console.log('SKIP emulator integration: start Auth 9199 and Firestore 8180 for demo-offhire, then rerun.');
 results.push({name:'Actual emulator HTTP integration',status:'skipped',reason:'Local emulators unavailable'});
}else{
 const {getAuth}=await import('firebase-admin/auth');
 const {getApps}=await import('firebase-admin/app');
 async function authRest(action,data){const response=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:${action}?key=test-only`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;}
 async function google(email,verified=true){return authRest('signInWithIdp',{requestUri:'http://localhost',postBody:new URLSearchParams({providerId:'google.com',id_token:JSON.stringify({sub:`google-${email}`,email,email_verified:verified})}).toString(),returnSecureToken:true});}
 const account=await google(ownerEmail);
 let sessionCookie='';
 await test('Actual Auth emulator token creates verified operator session',async()=>{
  const res=await call('/api/auth/session',{method:'POST',body:{idToken:account.idToken}});assert.equal(res.status,200,await res.text());
  const header=res.headers.get('set-cookie');assert.ok(header);sessionCookie=header.split(';')[0];
  const claims=await app.firebaseIdentity(request('/api/state?mode=live',{cookie:sessionCookie}));assert.equal(claims.uid,account.localId);assert.equal(claims.email,ownerEmail);
 });
 const admin=getAuth(getApps()[0]);
 await test('Fresh-auth policy rejects ten-minute-old sign-in',async()=>{
  const oldNow=Date.now;Date.now=()=>oldNow()+600000;
  try{const res=await call('/api/auth/session',{method:'POST',body:{idToken:account.idToken}});assert.equal(res.status,403);assert.match((await res.json()).error,/fresh operator session/);}finally{Date.now=oldNow;}
 });
 await test('ID token cannot be substituted for session cookie',async()=>{
  assert.equal(await app.firebaseIdentity(request('/api/state',{cookie:`__session=${account.idToken}`})),null);
 });
 await test('Wrong-project session cookie rejected',async()=>{
  const parts=sessionCookie.split('=')[1].split('.');const claims=JSON.parse(Buffer.from(parts[1],'base64url'));claims.aud='demo-other-project';parts[1]=Buffer.from(JSON.stringify(claims)).toString('base64url');
  assert.equal(await app.firebaseIdentity(request('/api/state',{cookie:`__session=${parts.join('.')}`})),null);
 });
 await test('Nonallowlisted Google account cannot establish operator session',async()=>{
  const other=await google(`other-${suffix}@example.test`);const res=await call('/api/auth/session',{method:'POST',body:{idToken:other.idToken},headers:forged});assert.equal(res.status,403);
 });
 await test('Verified password account cannot replace Google sign-in',async()=>{
  const password='test-only-password-123!';const user=await authRest('signUp',{email:passwordEmail,password,returnSecureToken:true});await admin.updateUser(user.localId,{emailVerified:true});
  const signed=await authRest('signInWithPassword',{email:passwordEmail,password,returnSecureToken:true});assert.equal((await call('/api/auth/session',{method:'POST',body:{idToken:signed.idToken}})).status,403);
 });
 await test('Unverified Google claims rejected',async()=>{
  const email=`unverified-${suffix}@example.test`;process.env.OFFHIRE_OWNER_EMAILS=owners+','+email;
  try{const user=await google(email,false);const claims=await admin.verifyIdToken(user.idToken);assert.equal(claims.email_verified,false,'Emulator must retain the unverified test claim');assert.equal((await call('/api/auth/session',{method:'POST',body:{idToken:user.idToken}})).status,403);}finally{process.env.OFFHIRE_OWNER_EMAILS=owners;}
 });
 let signedDemo;
 await test('Verified session reaches real Firestore-backed live state',async()=>{
  const res=await call('/api/state?mode=live',{cookie:sessionCookie});assert.equal(res.status,200);const data=await res.json();assert.equal(data.connection.owner,true);assert.equal(data.connection.email,ownerEmail);assert.equal(data.mode,'live');
 });
 await test('Live session does not leak to public demo and is not overwritten',async()=>{
  const res=await call('/api/state?mode=demo',{cookie:sessionCookie});assert.equal(res.status,200);signedDemo=await res.json();assert.equal(signedDemo.mode,'demo');assert.ok(signedDemo.rentals.every(r=>r.workspaceId.startsWith('demo-')));assert.equal(res.headers.get('set-cookie'),null);
 });
 await test('Known Firebase UID cannot impersonate authenticated demo workspace',async()=>{
  const uidHash=createHash('sha256').update(account.localId).digest('hex');const res=await call('/api/state?mode=demo',{cookie:`__session=demo.${uidHash}`});assert.equal(res.status,200);const anon=await res.json();assert.notEqual(anon.rentals[0].workspaceId,signedDemo.rentals[0].workspaceId);
 });
 await test('Two anonymous browser workspaces remain isolated',async()=>{
  const a=await call('/api/state?mode=demo');const cookieA=a.headers.get('set-cookie').split(';')[0];const dataA=await a.json();
  const b=await call('/api/state?mode=demo');const cookieB=b.headers.get('set-cookie').split(';')[0];const dataB=await b.json();assert.notEqual(cookieA,cookieB);assert.notEqual(dataA.rentals[0].workspaceId,dataB.rentals[0].workspaceId);
  const forbidden=await call(`/api/rentals/${dataA.rentals[0].id}/plan?mode=demo`,{method:'POST',cookie:cookieB,body:{scenario:'confirmed'}});assert.equal(forbidden.status,404);
 });
 await test('Removing operator allowlist blocks an existing verified session',async()=>{
  process.env.OFFHIRE_OWNER_EMAILS='';try{assert.equal((await call('/api/state?mode=live',{cookie:sessionCookie})).status,403);}finally{process.env.OFFHIRE_OWNER_EMAILS=owners;}
 });
 await test('Disabled user session is rejected through revocation-aware verification',async()=>{
  await admin.updateUser(account.localId,{disabled:true});try{assert.equal(await app.firebaseIdentity(request('/api/state',{cookie:sessionCookie})),null);assert.equal((await call('/api/state?mode=live',{cookie:sessionCookie})).status,403);}finally{await admin.updateUser(account.localId,{disabled:false});}
 });
 await test('Revoked session is rejected',async()=>{
  await new Promise(r=>setTimeout(r,1200));await admin.revokeRefreshTokens(account.localId);assert.equal(await app.firebaseIdentity(request('/api/state',{cookie:sessionCookie})),null);
 });
}
await writeFile(path.join(runtime,'results.json'),JSON.stringify({ranAt:new Date().toISOString(),source:'Current source bundled without auth/store mocks',project,scope:'Local Firebase Auth HTTP and Firestore emulators only; no CALL-E calls. Emulator JWT signatures are intentionally unsigned; production cryptographic verification and browser Google popup are not established by this suite.',results},null,2));
console.log(`${results.filter(r=>r.status==='passed').length} passed; ${results.filter(r=>r.status==='failed').length} failed; ${results.filter(r=>r.status==='skipped').length} skipped`);
process.exitCode=results.some(r=>r.status==='failed')?1:0;
