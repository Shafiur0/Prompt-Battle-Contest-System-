import 'reflect-metadata';
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Pool} from 'pg';
const schema='auth_regression_'+randomUUID().replace(/-/g,'');
const url=process.env.TEST_DATABASE_URL||'postgresql://prompt_battle:local-development-only@localhost:5432/prompt_battle';
const admin=new Pool({connectionString:url});let appPool:any,Auth:any,cookieName:any,ttl:number,issuer:string,origin:string;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
before(async()=>{
 await admin.query('CREATE SCHEMA "'+schema+'"');
 await admin.query('CREATE TABLE "'+schema+'".users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),issuer text NOT NULL,subject text NOT NULL,alias text NOT NULL,is_organizer boolean NOT NULL,UNIQUE(issuer,subject))');
 await admin.query('CREATE TABLE "'+schema+'".auth_flows(token_hash text PRIMARY KEY,state text NOT NULL,nonce text NOT NULL,verifier text NOT NULL,expires_at timestamptz NOT NULL)');
 await admin.query('CREATE TABLE "'+schema+'".sessions(token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES "'+schema+'".users(id),expires_at timestamptz NOT NULL)');
 appPool=(await import('../db')).pool;Object.assign(appPool.options,{connectionString:url,options:'-c search_path='+schema});
 const auth=await import('../auth');Auth=auth.AuthService;cookieName=auth.loginCookieName;ttl=auth.LOGIN_FLOW_TTL_MS;
 const config=(await import('../config')).config;issuer=config.issuer;origin=config.origin;
});
beforeEach(async()=>{await admin.query('TRUNCATE "'+schema+'".auth_flows,"'+schema+'".sessions,"'+schema+'".users CASCADE');});
after(async()=>{if(!/^auth_regression_[a-f0-9]{32}$/.test(schema))throw Error('Unsafe cleanup');await appPool?.end();await admin.query('DROP SCHEMA "'+schema+'" CASCADE');await admin.end();});
function response(){return {cookies:[] as any[],cleared:[] as any[],location:'',cookie(name:string,value:string,options:any){this.cookies.push({name,value,options});return this;},clearCookie(name:string,options:any){this.cleared.push({name,options});return this;},redirect(url:string){this.location=url;return this;}};}
function service(claims?:any,fail=false){let calls=0;const s=new Auth(),client={authorizationUrl:(p:any)=>'http://identity.example.test/authorize?state='+encodeURIComponent(p.state),callbackParams:(req:any)=>req.query,callback:async(_uri:any,_params:any,_checks:any)=>{calls++;if(fail)throw Error('Synthetic provider failure');return {claims:()=>claims||{sub:'fixture-participant',iss:issuer,preferred_username:'participant1',realm_access:{roles:['participant']}}};}};s.clientPromise=Promise.resolve(client);return {s,calls:()=>calls};}
async function flow(expired=false){const state='state-'+randomUUID(),token='token-'+randomUUID();await admin.query('INSERT INTO "'+schema+'".auth_flows VALUES($1,$2,$3,$4,clock_timestamp()+$5::interval)',[hash(token),state,'nonce-'+randomUUID(),'verifier-'+randomUUID(),expired?'-1 minute':'30 minutes']);return {state,token};}
const request=(f:any,legacy=false)=>({query:{state:f.state,code:'fixture-code'},cookies:{[legacy?'pb_login':cookieName(f.state)]:f.token}});
async function count(table:string){assert.match(table,/^(sessions|auth_flows)$/);return Number((await admin.query('SELECT count(*) FROM "'+schema+'".'+table)).rows[0].count);}
test('each simultaneous sign-in receives a separate HttpOnly state cookie and 30-minute flow',async()=>{const {s}=service(),a=response(),b=response();await s.login(a);await s.login(b);assert.notEqual(a.cookies[0].name,b.cookies[0].name);for(const r of [a,b]){const state=new URL(r.location).searchParams.get('state');assert.equal(r.cookies[0].name,cookieName(state));assert.equal(r.cookies[0].options.path,'/api/v1/auth');assert.equal(r.cookies[0].options.httpOnly,true);assert.equal(r.cookies[0].options.sameSite,'lax');assert.equal(r.cookies[0].options.maxAge,ttl);assert.equal(ttl,1800000);}assert.equal(await count('auth_flows'),2);});
test('missing login cookie gives a friendly expired redirect without creating a session',async()=>{const {s,calls}=service(),r=response();await s.callback({query:{state:'missing-state'},cookies:{}},r);assert.equal(new URL(r.location).searchParams.get('auth'),'expired');assert.equal(await count('sessions'),0);assert.equal(calls(),0);});
test('a mismatched legacy callback cannot consume or clear another active flow',async()=>{const f=await flow(),{s,calls}=service(),r=response();await s.callback({query:{state:'different-state'},cookies:{pb_login:f.token}},r);assert.equal(new URL(r.location).searchParams.get('auth'),'expired');assert.equal(await count('auth_flows'),1);assert.equal(r.cleared.length,0);assert.equal(calls(),0);const valid=response();await s.callback(request(f,true),valid);assert.equal(valid.location,origin);assert.equal(valid.cleared[0].name,'pb_login');assert.equal(valid.cleared[0].options.path,'/');assert.equal(await count('sessions'),1);});
test('participant callback creates the correct role and clears only its own path-scoped cookie',async()=>{const f=await flow(),{s}=service(),r=response();await s.callback(request(f),r);assert.equal(r.location,origin);assert.equal(r.cleared[0].name,cookieName(f.state));assert.equal(r.cleared[0].options.path,'/api/v1/auth');const session=r.cookies.find(c=>c.name==='pb_session');assert.ok(session);const user=await s.user({cookies:{pb_session:session.value}});assert.equal(user.alias,'participant1');assert.equal(user.isOrganizer,false);assert.equal(await count('auth_flows'),0);});
test('expired and replayed callbacks cannot create additional sessions',async()=>{const expired=await flow(true),{s}=service(),a=response();await s.callback(request(expired),a);assert.equal(new URL(a.location).searchParams.get('auth'),'expired');assert.equal(await count('sessions'),0);const fresh=await flow(),ok=response();await s.callback(request(fresh),ok);const replay=response();await s.callback(request(fresh),replay);assert.equal(new URL(replay.location).searchParams.get('auth'),'expired');assert.equal(await count('sessions'),1);});
test('concurrent callbacks consume exactly one flow and create exactly one session',async()=>{const f=await flow(),{s,calls}=service(),responses=[response(),response()];await Promise.all(responses.map(r=>s.callback(request(f),r)));assert.equal(await count('sessions'),1);assert.equal(calls(),1);assert.equal(responses.filter(r=>r.location===origin).length,1);assert.equal(responses.filter(r=>new URL(r.location).searchParams.get('auth')==='expired').length,1);});
test('wrong issuer and provider failures redirect without authenticating',async()=>{for(const kind of ['issuer','provider']){const f=await flow(),{s}=service(kind==='issuer'?{sub:'fixture',iss:'http://wrong-issuer',preferred_username:'participant1'}:undefined,kind==='provider'),r=response();await s.callback(request(f),r);assert.equal(new URL(r.location).searchParams.get('auth'),'failed');assert.equal(await count('sessions'),0);}});
test('an existing organizer session does not mask a failed participant login',async()=>{const f=await flow(),{s}=service({sub:'fixture-organizer',iss:issuer,preferred_username:'organizer',realm_access:{roles:['organizer']}}),signed=response();await s.callback(request(f),signed);const session=signed.cookies.find(c=>c.name==='pb_session'),r=response();await s.callback({query:{state:'new-participant-state'},cookies:{pb_session:session.value}},r);assert.equal(new URL(r.location).searchParams.get('auth'),'expired');assert.equal(await count('sessions'),1);assert.equal((await s.user({cookies:{pb_session:session.value}})).alias,'organizer');});
test('malformed state and an unavailable identity service fail safely without raw callback JSON',async()=>{const {s}=service(),r=response();await s.callback({query:{state:['a','b']},cookies:{}},r);assert.equal(new URL(r.location).searchParams.get('auth'),'failed');assert.equal(await count('sessions'),0);const down=new Auth();down.clientPromise=Promise.reject(Error('Synthetic discovery failure'));const login=response();await down.login(login);assert.equal(new URL(login.location).searchParams.get('auth'),'failed');});

test('a public tunnel issuer preserves the existing account and still rejects a wrong token issuer',async()=>{
 const config=(await import('../config')).config,oldIssuer=config.issuer,oldIdentityIssuer=config.identityIssuer;
 const stableIssuer='http://localhost:8080/realms/prompt-battle',publicIssuer='https://account-regression.trycloudflare.com/realms/prompt-battle',subject='existing-tunnel-participant';
 config.issuer=publicIssuer;config.identityIssuer=stableIssuer;
 try{
  const existing=(await admin.query('INSERT INTO "'+schema+'".users(issuer,subject,alias,is_organizer) VALUES($1,$2,$3,false) RETURNING id',[stableIssuer,subject,'participant1'])).rows[0];
  const accepted=await flow(),{s}=service({sub:subject,iss:publicIssuer,preferred_username:'participant1',realm_access:{roles:['participant']}}),signed=response();
  await s.callback(request(accepted),signed);
  const session=signed.cookies.find(c=>c.name==='pb_session');assert.ok(session);
  assert.equal((await s.user({cookies:{pb_session:session.value}})).id,existing.id);
  assert.equal(Number((await admin.query('SELECT count(*) FROM "'+schema+'".users')).rows[0].count),1);
  const rejected=await flow(),wrong=service({sub:subject,iss:stableIssuer,preferred_username:'participant1'}),failed=response();
  await wrong.s.callback(request(rejected),failed);
  assert.equal(new URL(failed.location).searchParams.get('auth'),'failed');
  assert.equal(await count('sessions'),1);
 }finally{config.issuer=oldIssuer;config.identityIssuer=oldIdentityIssuer;}
});
