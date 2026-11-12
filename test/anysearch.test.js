import {test} from 'node:test';
import assert from 'node:assert/strict';
import {anysearch} from '../src/adapters/anysearch.js';
import {validateConfig,names} from '../src/config.js';
import {addMissingAnysearch} from '../src/config-migrate.js';
import {candidates,run} from '../src/router.js';
const p={operation:'search',input:'public example',taskType:'general',limit:1,maxChars:1000};
const response=(data,status=200)=>({status,headers:{},text:JSON.stringify(data)});
for(const key of ['','mock-anysearch-key'])test(`AnySearch ${key?'key':'anonymous'} protocol and parsed snippet`,async()=>{
 const calls=[];const d=await anysearch(p,{key,transport:async(url,o)=>{calls.push({url,...o});return response({code:0,data:{results:[{url:'https://example.com/',title:'Example',snippet:'short'}]}});}});
 assert.equal(calls[0].url,'https://api.anysearch.com/v1/search');assert.deepEqual(calls[0].body,{query:p.input,max_results:1});assert.equal(calls[0].headers.Authorization,key?`Bearer ${key}`:undefined);assert.equal(d.results[0].content,'short');assert.equal(calls.length,1);
});
for(const status of [401,403,402,429])test(`AnySearch HTTP ${status} is surfaced without anonymous downgrade or raw body`,async()=>{
 let calls=0;await assert.rejects(anysearch(p,{key:'mock-secret',transport:async()=>{calls++;return response({message:'generated account secret credentials'},status);}}),e=>e.status===status&&!e.message.includes('credentials'));assert.equal(calls,1);
});
test('AnySearch malformed/business-error responses fail safely',async()=>{
 for(const data of [{code:-1,message:'secret credentials'},{code:0,data:{}}])await assert.rejects(anysearch(p,{key:'',transport:async()=>response(data)}),e=>['PROVIDER_ERROR','INVALID_RESPONSE'].includes(e.code)&&!e.message.includes('credentials'));
});
test('AnySearch native extract uses strict single-url schema and returns actual source',async()=>{
 const calls=[];const d=await anysearch({...p,operation:'fetch',input:'https://example.com/'},{key:'',transport:async(url,o)=>{calls.push({url,...o});return response({code:0,data:{url:'https://example.com/',title:'Example',content:'Extracted page'}});}});
 assert.equal(calls[0].url,'https://api.anysearch.com/v1/extract');assert.deepEqual(calls[0].body,{url:'https://example.com/'});assert.equal(d.results[0].content,'Extracted page');assert.equal(d.contentKind,'extracted-content');
});
test('AnySearch follows the six original engines at equal priority',()=>{
 const c=validateConfig();for(const [n,e]of Object.entries(c.engines))if(n!=='yuanbao')e.key='mock-key';
 const expected={
  'non-cjk:general':['tavily','firecrawl','parallel','keenable','you','exa'],
  'non-cjk:code':['exa','firecrawl','parallel','tavily','keenable','you'],
  'non-cjk:news':['tavily','you','firecrawl','parallel','keenable','exa'],
  'cjk:general':['keenable','tavily','firecrawl','you','exa','parallel'],
  'cjk:code':['exa','firecrawl','keenable','tavily','parallel','you'],
  'cjk:news':['tavily','you','keenable','firecrawl','parallel','exa']};
 for(const [language,input]of [['non-cjk','public'],['cjk','中文']])for(const taskType of ['general','code','news']){
  assert.deepEqual(candidates({...p,input,taskType},c,{}).eligible,[...expected[`${language}:${taskType}`],'anysearch','tinyfish','querit']);
 }
 assert.deepEqual(candidates({...p,operation:'fetch'},c,{}).eligible,['exa','firecrawl','parallel','tavily','keenable','you','anysearch','direct-http']);
 assert.equal(names.length,10);assert.equal(validateConfig({maxAttempts:7}).maxAttempts,7);
});
test('AnySearch supports explicit selection and caller priority override',async()=>{
 const c=validateConfig();c.engines.anysearch.priority=1;assert.equal(candidates(p,c,{}).eligible[0],'anysearch');
 const out=await run({...p,engine:'anysearch'},c,{transport:async()=>response({code:0,data:{results:[]}})});assert.equal(out.engine,'anysearch');assert.equal(out.ok,true);
});
test('six-provider config migration preserves removed Parallel key and every existing value',()=>{
 const raw={timeoutMs:20000,maxAttempts:3,engines:{parallel:{enabled:true,priority:23},exa:{key:'mock-existing-secret',enabled:false,priority:7}}};
 const {config,changed}=addMissingAnysearch(raw);assert.equal(changed,true);assert.deepEqual(config.engines.anysearch,{enabled:true,key:'',priority:50});assert.deepEqual(config.engines.exa,raw.engines.exa);assert.deepEqual(config.engines.parallel,raw.engines.parallel);assert.equal(Object.hasOwn(config.engines.parallel,'key'),false);assert.equal(Object.hasOwn(raw.engines,'anysearch'),false);
 assert.equal(validateConfig(raw).engines.anysearch.priority,50);
});
test('existing AnySearch values are preserved and only missing fields added',()=>{
 const raw={engines:{anysearch:{key:'mock-existing-key',priority:17}}};const migrated=addMissingAnysearch(raw);assert.deepEqual(migrated.config.engines.anysearch,{key:'mock-existing-key',priority:17,enabled:true});assert.equal(addMissingAnysearch(migrated.config).changed,false);
 assert.throws(()=>addMissingAnysearch({engines:{anysearch:null}}),{code:'INVALID_CONFIG'});
});
test('AnySearch quota-generated credentials never escape error, only safe request ID',async()=>{
 const id='11111111-2222-4333-8444-555555555555';
 await assert.rejects(anysearch(p,{key:'',transport:async()=>response({code:-1,message:'username=DO_NOT_LOG_USER password=DO_NOT_LOG_PASSWORD api_key=DO_NOT_LOG_KEY',request_id:id},402)}),e=>e.code==='QUOTA_EXHAUSTED'&&e.requestId===id&&!JSON.stringify(e).includes('DO_NOT_LOG')&&!e.message.includes('DO_NOT_LOG'));
});
