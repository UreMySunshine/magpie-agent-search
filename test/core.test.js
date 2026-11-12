import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validateConfig,loadConfig,stateKey,saveState,readState} from '../src/config.js';
import {publicIP,parsePublicURL,resolvePublic,preflight,jsonRequest} from '../src/http.js';
import {adapters} from '../src/adapters/index.js';
import {bounded,rows} from '../src/normalize.js';
import {run,candidates} from '../src/router.js';
import {SearchError,retryAt,safeError} from '../src/errors.js';
import {parse} from '../scripts/request.js';
const p={operation:'search',input:'public web search',taskType:'general',limit:3,maxChars:500};
const config=()=>validateConfig();
const ok=d=>({status:200,headers:{},text:JSON.stringify(d)});
const hits={results:[{title:'Example',url:'https://example.com/',content:'hello',raw_content:'hello'}]};
const result={results:[{title:'Example',url:'https://example.com/',content:'hello'}],content:''};
for(const engine of ['firecrawl','tavily','keenable','exa','parallel','you','anysearch'])for(const key of ['', 'test-secret'])for(const operation of ['search','fetch'])test(`${engine} ${key?'key':'anonymous'} ${operation} HTTP protocol`,async()=>{
  const calls=[];
  const ctx={key,parallelSessionId:'mock-stable-session',transport:async(url,o)=>{calls.push({url,...o});
    if(engine==='you'&&!key&&operation==='fetch')return {status:200,headers:{'content-type':'text/html'},text:'<title>Example</title><main>Hello world</main>'};
    if(!key&&['exa','parallel'].includes(engine)){
      if(o.body.method==='notifications/initialized')return {status:202,headers:{},text:''};
      return ok({jsonrpc:'2.0',id:o.body.id,result:o.body.method==='initialize'?{protocolVersion:'2025-03-26'}:{content:[{type:'text',text:JSON.stringify(hits)}]}});
    }
    return ok(engine==='anysearch'?{code:0,data:operation==='search'?{results:hits.results}:hits.results[0]}:engine==='firecrawl'?{success:true,data:operation==='search'?{web:hits.results}:{markdown:'hello',metadata:{sourceURL:'https://example.com'}}}:engine==='keenable'&&operation==='fetch'?hits.results[0]:engine==='you'?(operation==='search'?{results:{web:hits.results}}:hits.results):hits);
  }};

  const d=await adapters[engine]({...p,operation,input:operation==='fetch'?'https://example.com/':p.input},ctx);
  assert.equal(d.results[0].url,'https://example.com/');assert.equal(calls.length,!key&&['exa','parallel'].includes(engine)?3:1);
  if(key)assert.ok(!calls[0].url.includes('/mcp'));assert.ok(!JSON.stringify(calls[0].body??{}).includes('test-secret'));
  if(key)assert.ok(Object.values(calls[0].headers).some(v=>String(v).includes(key)));
  else assert.ok(!Object.keys(calls[0].headers).some(k=>/authorization|api-key/i.test(k)));
  if(engine==='tavily')assert.equal(calls[0].headers['X-Tavily-Access-Mode'],key?undefined:'keyless');
  if(engine==='keenable'){assert.equal(new URL(calls[0].url).pathname,`/v1/${operation==='search'?'search':'fetch'}${key?'':'/public'}`);if(operation==='fetch'){assert.equal(calls[0].method,'GET');assert.equal(new URL(calls[0].url).searchParams.get('live'),'true');}}
  if(engine==='you'&&!key&&operation==='search'){assert.equal(calls[0].method,'GET');assert.equal(new URL(calls[0].url).pathname,'/v1/agents/search');}
  if(engine==='parallel'&&key){assert.equal(new URL(calls[0].url).pathname,operation==='search'?'/v1/search':'/v1/extract');if(operation==='fetch'){assert.equal(calls[0].body.advanced_settings.full_content,true);assert.equal('full_content' in calls[0].body,false);}}
});
test('routing considers task, explicit priority and capabilities',()=>{
  assert.equal(candidates(p,config(),{}).eligible[0],'tavily');const keyed=config();keyed.engines.exa.key='test-secret';assert.equal(candidates({...p,taskType:'code'},keyed,{}).eligible[0],'exa');
  const c=config();c.engines.you.priority=1;c.engines.you.key='test-secret';assert.equal(candidates(p,c,{}).eligible[0],'you');c.engines.you.key='';assert.equal(candidates({...p,operation:'fetch',engine:'you'},c,{}).routing.candidates[0].mode,'anonymous-direct-http');
});
test('sequential fallback stops on success and saves cooldown',async()=>{
  const calls=[],state={};const implementations={tavily:async()=>{calls.push('tavily');throw new SearchError('RATE_LIMIT','Limited',{retryAt:9000});},firecrawl:async()=>{calls.push('firecrawl');return result;}};
  const r=await run(p,config(),{implementations,state,now:()=>1000});assert.equal(r.engine,'firecrawl');assert.deepEqual(calls,['tavily','firecrawl']);assert.equal(state['tavily:anonymous'],9000);
});
test('explicit engine never falls back or removes configured key',async()=>{
  const c=config();c.engines.tavily.key='test-secret';let calls=0;
  const r=await run({...p,engine:'tavily'},c,{implementations:{tavily:async(_p,ctx)=>{calls++;assert.equal(ctx.key,'test-secret');throw new SearchError('AUTH_ERROR','Denied',{status:401});}}});assert.equal(calls,1);assert.equal(r.ok,false);assert.equal(r.attempts[0].authMode,'key');
});
test('full Retry-After respected',()=>{
  assert.equal(candidates(p,config(),{'tavily:anonymous':Date.now()+3600_000}).eligible.includes('tavily'),false);assert.equal(retryAt('3600',1000),3601000);assert.equal(retryAt('Wed, 01 Jan 2031 00:00:00 GMT',0),Date.parse('2031-01-01'));
});
test('bounded attempts, redacted errors and successful empty search',async()=>{
  const c=config();c.maxAttempts=2;let count=0;const implementations=Object.fromEntries(Object.keys(adapters).map(n=>[n,async()=>{count++;throw Error('secret upstream body');}]));
  const r=await run(p,c,{implementations});assert.equal(count,2);assert.equal(r.error.code,'ALL_ATTEMPTS_FAILED');assert.ok(!JSON.stringify(r).includes('secret'));assert.equal((await run(p,c,{implementations:{tavily:async()=>({results:[],content:''})}})).ok,true);
});
test('timeout aborts engine',async()=>{
  const c=config();c.timeoutMs=100;c.maxAttempts=1;const r=await run(p,c,{implementations:{tavily:async(_p,ctx)=>new Promise((_,reject)=>ctx.signal.addEventListener('abort',()=>reject(Error('aborted'))))}});assert.equal(r.attempts[0].error.code,'TIMEOUT');
});
for(const value of ['http://127.0.0.1','http://2130706433','http://0x7f000001','http://[::1]','http://[::ffff:127.0.0.1]','http://169.254.169.254','file:///etc/passwd','http://user:secret@example.com','http://localhost','http://foo.local','http://10.1.2.3','https://example.com:8443'])test(`reject ${value}`,()=>assert.throws(()=>parsePublicURL(value)));
test('mixed DNS and reserved IPv6 rejected',async()=>{
  await assert.rejects(resolvePublic('example.com',async()=>[{address:'1.1.1.1',family:4},{address:'10.0.0.1',family:4}]),{code:'UNSAFE_URL'});assert.equal(publicIP('8.8.8.8'),true);assert.equal(publicIP('2606:4700:4700::1111'),true);assert.equal(publicIP('2001:db8::1'),false);
});
test('private redirects and loops rejected',async()=>{
  let count=0;await assert.rejects(preflight('https://example.com',{transport:async()=>{count++;return {status:302,headers:{location:'http://10.0.0.1'},text:''};}}),{code:'UNSAFE_URL'});assert.equal(count,1);
  count=0;await assert.rejects(preflight('https://example.com',{transport:async()=>{count++;return {status:302,headers:{location:'/loop'},text:''};}}),{code:'TOO_MANY_REDIRECTS'});assert.equal(count,6);
});
test('HTTP status and Retry-After retained without raw body',async()=>{
  await assert.rejects(jsonRequest('https://example.com',{},async()=>({status:429,headers:{'retry-after':'3600'},text:'super-secret'})),e=>e.code==='RATE_LIMIT'&&!e.message.includes('super-secret')&&e.retryAt>Date.now()+3590_000);assert.deepEqual(safeError(Error('key')),{code:'NETWORK_ERROR',message:'Network or transport failure'});
});
test('limits, redaction, source filtering',()=>{
  const r=bounded({results:[{title:'secret',url:'https://example.com',content:'x'.repeat(1000)}],content:'more'},1,100,['secret']);assert.equal(r.results[0].title,'[REDACTED]');assert.equal(r.truncated,true);assert.ok(r.results[0].content.length<100);assert.equal(rows([{url:'javascript:alert(1)'},{url:'http://10.0.0.1'}]).results.length,0);
});
test('config rejects invalid values without reflecting keys',()=>{
  for(const raw of [{engines:{oops:{}}},{engines:{exa:{key:123}}},{maxAttempts:0},{timeoutMs:1},{engines:{exa:{key:'secret\r\nfoo'}}},{engines:[]}])assert.throws(()=>validateConfig(raw),e=>e.code==='INVALID_CONFIG'&&!e.message.includes('secret'));
});
test('explicit missing config errors; cache stores no secrets',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'agent-search-test-'));await assert.rejects(loadConfig(join(dir,'missing'),true),{code:'CONFIG_READ_ERROR'});const key=stateKey('exa','super-secret'),path=join(dir,'state.json');await saveState(path,{[key]:123});assert.equal((await readState(path))[key],123);assert.ok(!(await readFile(path,'utf8')).includes('super-secret'));
});
test('script input validation and stdout JSON/stderr diagnostics',()=>{
  assert.equal(parse(['search','hello world']).taskType,'general');assert.throws(()=>parse(['search','hello','--budget','2']),{code:'USAGE'});const r=spawnSync(process.execPath,['scripts/request.js','fetch','http://127.0.0.1','--config','config.example.json'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).error.code,'UNSAFE_URL');assert.match(r.stderr,/request failed/);
});

test('all anonymous search engines eligible and fetch falls back to direct last',()=>{
 assert.equal(candidates(p,config(),{}).eligible.length,8);
 const plan=candidates({...p,operation:'fetch'},config(),{});
 assert.equal(plan.eligible.at(-1),'direct-http');
 assert.equal(plan.routing.selection,'configured-provider-chain-then-direct-fallback');
});
test('empty fetch fails and allows sequential fallback',async()=>{
  const c=config();c.maxAttempts=1;
  const r=await run({...p,operation:'fetch',engine:'firecrawl'},c,{implementations:{firecrawl:async()=>({results:[],content:''})}});
  assert.equal(r.ok,false);assert.equal(r.attempts[0].error.code,'EMPTY_CONTENT');
});
test('IPv6 transition ranges rejected in compressed and expanded form',()=>{
  for(const ip of ['2001::1','2001:0000:0000:0000:0000:0000:0000:0001','2002:7f00:1::','3fff::1'])assert.equal(publicIP(ip),false);
});

test('all-key configuration selects task preference without live network',()=>{
 const c=config();for(const e of Object.values(c.engines))e.key='mock-routing-key';
 assert.equal(candidates(p,c,{}).eligible[0],'tavily');
 assert.equal(candidates({...p,taskType:'code'},c,{}).eligible[0],'exa');
 assert.equal(candidates({...p,taskType:'news'},c,{}).eligible[0],'tavily');
 assert.equal(candidates({...p,operation:'fetch'},c,{}).eligible.at(-1),'direct-http');
});
test('keyed quota failure routes sequentially and retains keyed mode',async()=>{
 const c=config();for(const e of Object.values(c.engines))e.key='mock-routing-key';
 c.engines.parallel.priority=1;const calls=[],state={};
 const r=await run(p,c,{state,now:()=>1000,implementations:{
  parallel:async(_p,ctx)=>{calls.push(['parallel',ctx.key]);throw new SearchError('QUOTA_EXHAUSTED','Provider returned HTTP 402',{status:402});},
  tavily:async(_p,ctx)=>{calls.push(['tavily',ctx.key]);return result;}
 }});
 assert.equal(r.ok,true);assert.equal(r.engine,'tavily');
 assert.deepEqual(calls,[['parallel','mock-routing-key'],['tavily','mock-routing-key']]);
 assert.equal(r.attempts[0].error.status,402);assert.equal(r.attempts[0].authMode,'key');
 assert.equal(state[stateKey('parallel','mock-routing-key')],301000);
});
test('entry point runs when the script is invoked through a symlink',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'web-search-entry-')),link=join(dir,'request.js');
 await symlink(fileURLToPath(new URL('../scripts/request.js',import.meta.url)),link);
 const r=spawnSync(process.execPath,[link,'--help'],{encoding:'utf8'});
 assert.equal(r.status,0);assert.match(r.stdout,/Options:/);
});
