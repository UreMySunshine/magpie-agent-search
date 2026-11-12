import {test} from 'node:test';
import assert from 'node:assert/strict';
import {yuanbao} from '../src/adapters/yuanbao.js';
import {validateConfig} from '../src/config.js';
import {addMissingYuanbao} from '../src/config-migrate.js';
import {run,candidates} from '../src/router.js';
import {safeError} from '../src/errors.js';
const p={operation:'search',input:'public query',taskType:'general',limit:1,maxChars:1000};
const reply=(body,status=200,headers={})=>({status,headers,text:JSON.stringify(body)});
const page=(n=0)=>JSON.stringify({title:`Title ${n}`,url:`https://example.com/${n}`,passage:'Standard summary',content:'Dynamic <strong>summary</strong>'});
test('Yuanbao without key is filtered before any network activity, explicit invocation explains requires_key',async()=>{
 const config=validateConfig();let calls=0;const plan=candidates(p,config,{});assert.equal(plan.eligible.includes('yuanbao'),false);assert.deepEqual(plan.skipped.find(s=>s.engine==='yuanbao'),{engine:'yuanbao',reason:'requires_key'});
 const out=await run({...p,engine:'yuanbao'},config,{transport:async()=>{calls++;throw Error('must not call');}});assert.equal(calls,0);assert.equal(out.error.code,'REQUIRES_KEY');assert.equal(out.attempts.length,0);
 await assert.rejects(yuanbao(p,{key:'',transport:async()=>{calls++;}}),{code:'REQUIRES_KEY'});assert.equal(calls,0);
});
test('disabled Yuanbao and Yuanbao fetch never send requests even with key',async()=>{
 const c=validateConfig({engines:{yuanbao:{key:'mock-secret',enabled:false}}});let calls=0;
 assert.equal((await run({...p,engine:'yuanbao'},c,{transport:async()=>{calls++;}})).ok,false);assert.equal(calls,0);
 c.engines.yuanbao.enabled=true;const r=await run({...p,engine:'yuanbao',operation:'fetch'},c,{transport:async()=>{calls++;}});assert.equal(r.error.code,'UNSUPPORTED_OPERATION');assert.equal(calls,0);
 await assert.rejects(yuanbao({...p,operation:'fetch'},{key:'mock-secret',transport:async()=>{calls++;}}),{code:'UNSUPPORTED_OPERATION'});assert.equal(calls,0);
});
test('Bearer service-key request goes once to the official HTTPS endpoint without TC3 headers',async()=>{
 const calls=[];const d=await yuanbao(p,{key:'mock-secret',transport:async(url,o)=>{calls.push({url,...o});return reply({Response:{Pages:[page()]}});}});
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.wsa.cloud.tencent.com/SearchPro');assert.equal(calls[0].method,'POST');assert.deepEqual(calls[0].headers,{'Content-Type':'application/json; charset=utf-8',Authorization:'Bearer mock-secret'});assert.deepEqual(calls[0].body,{Query:p.input,Cnt:10});assert.equal(d.contentKind,'search-summary');assert.equal(d.results[0].content,'Dynamic summary');assert.ok(d.warnings[0].includes('not full page'));
});
for(const [limit,Cnt]of [[1,10],[10,10],[11,20],[20,20],[21,30],[31,40],[41,50],[100,50]])test(`Yuanbao limit ${limit} maps to legal Cnt ${Cnt}`,async()=>{
 let body;await yuanbao({...p,limit},{key:'mock-secret',transport:async(_u,o)=>{body=o.body;return reply({Response:{Pages:[]}});}});assert.equal(body.Cnt,Cnt);
});
test('Yuanbao local output truncates legal server batch to caller limit',async()=>{
 const c=validateConfig({engines:{yuanbao:{key:'mock-secret'}}});const out=await run({...p,engine:'yuanbao'},c,{transport:async()=>reply({Response:{Pages:Array.from({length:10},(_,i)=>page(i))}})});
 assert.equal(out.ok,true);assert.equal(out.data.results.length,1);assert.equal(out.data.truncated,true);assert.equal(out.data.contentKind,'search-summary');
});
test('Yuanbao maps only supported news task to Industry and does not invent site/date/code filters',async()=>{
 for(const type of ['general','code','news']){let body;await yuanbao({...p,taskType:type},{key:'mock-secret',transport:async(_u,o)=>{body=o.body;return reply({Response:{Pages:[]}});}});assert.deepEqual(Object.keys(body).sort(),type==='news'?['Cnt','Industry','Query']:['Cnt','Query']);if(type==='news')assert.equal(body.Industry,'news');}
});
test('Pages strings are independently parsed; malformed entries and unsafe URLs are omitted with partial warning',async()=>{
 const d=await yuanbao(p,{key:'mock-secret',transport:async()=>reply({Response:{Pages:[page(),'broken',null,'[]',JSON.stringify({url:'http://127.0.0.1/',passage:'private'}),'{"__proto__":{"polluted":true},"url":"https://example.org/","passage":"passage"}']}})});
 assert.equal(d.results.length,2);assert.equal(d.partial,true);assert.equal({}.polluted,undefined);assert.equal(d.results[1].content,'passage');
});
test('empty search is successful; entirely malformed/missing Pages fail explicitly',async()=>{
 assert.equal((await yuanbao(p,{key:'mock-secret',transport:async()=>reply({Response:{Pages:[]}})})).results.length,0);
 for(const data of [{Response:{}},{Response:{Pages:['bad']}}])await assert.rejects(yuanbao(p,{key:'mock-secret',transport:async()=>reply(data)}),{code:'INVALID_RESPONSE'});
});
for(const [providerCode,code]of [['UnauthorizedOperation','AUTH_ERROR'],['AuthFailure.SecretIdNotFound','AUTH_ERROR'],['RequestLimitExceeded','RATE_LIMIT'],['ResourceUnavailable','QUOTA_EXHAUSTED'],['LimitExceeded','QUOTA_EXHAUSTED'],['ResourceNotFound','SERVICE_NOT_ENABLED'],['InvalidParameter','INVALID_PARAMETER'],['InternalError','PROVIDER_ERROR']])test(`HTTP 200 business error ${providerCode} is ${code} without raw Message`,async()=>{
 const id='11111111-2222-4333-8444-555555555555';await assert.rejects(yuanbao(p,{key:'mock-secret',transport:async()=>reply({Response:{Error:{Code:providerCode,Message:'mock-secret DO_NOT_LOG'},RequestId:id}},200,{'retry-after':'3600'})}),e=>e.code===code&&e.status===200&&e.requestId===id&&!JSON.stringify(safeError(e)).includes('mock-secret')&&!e.message.includes('DO_NOT_LOG')&&(code!=='RATE_LIMIT'||e.retryAt>Date.now()+3590000));
});
test('unknown provider error code/message and redirects do not leak key or cause replay',async()=>{
 await assert.rejects(yuanbao(p,{key:'mock-secret',transport:async()=>reply({Response:{Error:{Code:'mock-secret',Message:'mock-secret'}}})}),e=>e.providerCode==='UnknownProviderError'&&!e.message.includes('mock-secret'));
 let count=0;await assert.rejects(yuanbao(p,{key:'mock-secret',transport:async(url)=>{count++;assert.equal(new URL(url).hostname,'api.wsa.cloud.tencent.com');return reply({},302,{location:'https://untrusted.example/'});}}),{status:302});assert.equal(count,1);
});
test('Yuanbao key business auth failure cools down but never retries anonymous',async()=>{
 const c=validateConfig({engines:{yuanbao:{key:'mock-secret'}}});const state={};let count=0;const out=await run({...p,engine:'yuanbao'},c,{state,now:()=>1000,transport:async()=>{count++;return reply({Response:{Error:{Code:'UnauthorizedOperation'}}});}});
 assert.equal(count,1);assert.equal(out.attempts[0].authMode,'key');assert.ok(Object.values(state).includes(301000));
});
test('configured Yuanbao remains last and original seven relative order is unchanged',()=>{
 const c=validateConfig();for(const e of Object.values(c.engines))e.key='mock-key';
 for(const input of ['public','中文'])for(const taskType of ['general','code','news']){const all=candidates({...p,input,taskType},c,{}).eligible;c.engines.yuanbao.enabled=false;const previous=candidates({...p,input,taskType},c,{}).eligible;c.engines.yuanbao.enabled=true;assert.deepEqual(all,[...previous,'yuanbao']);}
 assert.equal(candidates({...p,operation:'fetch'},c,{}).eligible.includes('yuanbao'),false);assert.equal(validateConfig({maxAttempts:8}).maxAttempts,8);
});
test('Yuanbao migration preserves AnySearch key and removed Parallel key, does not overwrite existing Yuanbao fields',()=>{
 const raw={engines:{anysearch:{key:'mock-user-anysearch',priority:13},parallel:{enabled:true}}};const {config}=addMissingYuanbao(raw);assert.deepEqual(config.engines.anysearch,raw.engines.anysearch);assert.deepEqual(config.engines.parallel,raw.engines.parallel);assert.deepEqual(config.engines.yuanbao,{enabled:true,key:'',priority:50,secretId:'',secretKey:''});assert.equal(Object.hasOwn(config.engines.parallel,'key'),false);
 const current={engines:{yuanbao:{key:'mock-existing',priority:9,enabled:false,secretId:'',secretKey:''}}};assert.deepEqual(addMissingYuanbao(current),{config:current,changed:false});
});
