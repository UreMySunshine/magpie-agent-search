import {test} from 'node:test';
import assert from 'node:assert/strict';
import {directFetch,cleanHTML} from '../src/direct-fetch.js';
import {fromMCPFetch,bounded} from '../src/normalize.js';
import {adapters} from '../src/adapters/index.js';
import {run,candidates} from '../src/router.js';
import {validateConfig} from '../src/config.js';
import {SearchError} from '../src/errors.js';
const p={operation:'fetch',input:'https://example.com/',taskType:'general',limit:1,maxChars:1000};
const html='<title>Example &amp; Test</title><body><script>evil()</script><style>hidden{}</style><p>Readable &amp; inert.</p><p>Second paragraph.</p></body>';
const response=(text=html,headers={'content-type':'text/html; charset=utf-8'})=>({status:200,headers,text});
function mcpTransport(calls,payload,sse=false){return async(url,o)=>{
 calls.push({url,...o});if(o.body.method==='notifications/initialized')return {status:202,headers:{},text:''};
 const r={jsonrpc:'2.0',id:o.body.id,result:o.body.method==='initialize'?{protocolVersion:'2025-03-26'}:{content:[{type:'text',text:typeof payload==='string'?payload:JSON.stringify(payload)}]}};
 return {status:200,headers:{},text:sse?`event: message\ndata: ${JSON.stringify(r)}\n\n`:JSON.stringify(r)};
};}
for(const provider of ['exa','parallel'])for(const sse of [false,true])test(`${provider} anonymous full-page fetch ${sse?'SSE':'JSON'}`,async()=>{
 const calls=[];const d=await adapters[provider](p,{key:'',transport:mcpTransport(calls,{results:[{url:p.input,title:'Example',full_content:'Actual full page'}]},sse)});
 assert.equal(d.results[0].content,'Actual full page');const tool=calls.find(c=>c.body.method==='tools/call');
 assert.equal(tool.body.params.name,provider==='exa'?'web_fetch_exa':'web_fetch');assert.deepEqual(tool.body.params.arguments.urls,[p.input]);
 if(provider==='exa')assert.equal(tool.body.params.arguments.maxCharacters,1000);else {assert.equal(tool.body.params.arguments.full_content,true);assert.equal('session_id' in tool.body.params.arguments,false);}
 assert.ok(calls.every(c=>!Object.keys(c.headers).some(k=>/authorization|api-key/i.test(k))));
});
test('Exa labeled full-content response parses URL/title and actual text',()=>{
 const d=fromMCPFetch({content:[{type:'text',text:'Title: Example\nURL: https://example.com/\nText:\nComplete text here'}]},p.input,{provider:'Exa'});
 assert.equal(d.results[0].content,'Complete text here');
});
test('fetch refuses search highlights/excerpts and malformed content',()=>{
 assert.throws(()=>fromMCPFetch({content:[{type:'text',text:'{"results":[{"url":"https://example.com/","excerpts":["only excerpt"]}]}'}]},p.input),{code:'EMPTY_CONTENT'});
 assert.throws(()=>fromMCPFetch({content:[{type:'text',text:'Highlights only, no page body'}]},p.input),{code:'INVALID_RESPONSE'});
});
test('partial fetch errors are disclosed and multiple returned URLs remain bounded',()=>{
 const d=fromMCPFetch({structuredContent:{results:[{url:p.input,text:'one'},{url:'https://example.org/',text:'two'}],errors:[{url:'https://failed.example/'}]},content:[]},p.input);
 assert.equal(d.partial,true);assert.equal(d.results.length,2);assert.equal(d.warnings.length,1);const b=bounded(d,1,100);assert.equal(b.results.length,1);assert.equal(b.truncated,true);assert.equal(b.partial,true);
});
test('direct tier migrates upstream cleanup and never returns executable HTML',async()=>{
 const calls=[];const d=await directFetch(p,{transport:async(url,o)=>{calls.push({url,...o});return response();}});
 assert.equal(d.actualProvider,'direct-http');assert.equal(d.results[0].title,'Example & Test');assert.match(d.results[0].content,/Readable & inert/);assert.doesNotMatch(d.results[0].content,/evil|hidden|<script/);
 assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');assert.equal(calls[0].headers.Authorization,undefined);
 assert.ok(cleanHTML('<head><title>Title</title></head><p>Body</p>').content.includes('Body'));
});
test('direct redirects preserve final source and reject private locations',async()=>{
 let count=0;const d=await directFetch(p,{transport:async()=>++count===1?{status:302,headers:{location:'https://example.org/final'},text:''}:response()});
 assert.equal(d.results[0].url,'https://example.org/final');
 count=0;await assert.rejects(directFetch(p,{transport:async()=>{count++;return {status:302,headers:{location:'http://127.0.0.1/'},text:''};}}),{code:'UNSAFE_URL'});assert.equal(count,1);
});
for(const [headers,code]of [[{'content-type':'application/pdf'},'UNSUPPORTED_CONTENT_TYPE'],[{'content-type':'text/html; charset=gbk'},'UNSUPPORTED_ENCODING'],[{'content-type':'text/html','content-encoding':'gzip'},'UNSUPPORTED_ENCODING']])test(`direct refuses ${JSON.stringify(headers)}`,async()=>{
 await assert.rejects(directFetch(p,{transport:async()=>response('body',headers)}),{code});
});
test('You fallback transparently reports actual provider, transport and warning',async()=>{
 const out=await run({...p,engine:'you'},validateConfig(),{transport:async()=>response()});
 assert.equal(out.engine,'direct-http');assert.equal(out.requestedEngine,'you');assert.equal(out.transport,'anonymous-direct-http');assert.ok(out.warnings.some(w=>w.includes('not by You')));assert.equal(out.attempts[0].actualProvider,'direct-http');
});
test('automatic fetch tries providers first and reaches the direct tier last',async()=>{
 const calls=[],fail=n=>async()=>{calls.push(n);throw new SearchError('HTTP_ERROR','Denied',{status:403});};
 const out=await run(p,validateConfig(),{implementations:{exa:fail('exa'),firecrawl:fail('firecrawl'),parallel:fail('parallel'),'direct-http':async()=>{calls.push('direct');return {results:[{url:p.input,content:'Full content'}],content:''};}}});
 assert.deepEqual(calls,['exa','firecrawl','parallel','direct']);
 assert.equal(out.engine,'direct-http');assert.equal(out.transport,'anonymous-direct-http');assert.equal(out.attempts.length,4);
 const served=[];const hit=await run(p,validateConfig(),{implementations:{exa:async()=>{served.push('exa');return {results:[{url:p.input,content:'Full content'}],content:''};},'direct-http':async()=>{served.push('direct');return {results:[{url:p.input,content:'Full content'}],content:''};}}});
 assert.deepEqual(served,['exa']);assert.equal(hit.engine,'exa');assert.equal(hit.transport,'anonymous-mcp-http');
 const c=validateConfig();for(const e of Object.values(c.engines))e.enabled=false;assert.equal(candidates(p,c,{}).eligible.length,0);
});
test('single enabled anonymous You still permits unified direct tier without duplicate direct fallback',()=>{
 const c=validateConfig();for(const [n,e]of Object.entries(c.engines))e.enabled=n==='you';const plan=candidates(p,c,{});assert.deepEqual(plan.eligible,['direct-http']);
});
test('Parallel stores and reuses only server-returned session, never generates one',async()=>{
 const state={},calls=[];
 const transport=mcpTransport(calls,{session_id:'session_from_provider',results:[{url:p.input,full_content:'Actual full content'}]});
 await run({...p,engine:'parallel'},validateConfig(),{state,transport});assert.equal(state.__parallelSessionId,'session_from_provider');
 await run({...p,engine:'parallel'},validateConfig(),{state,transport});
 const tools=calls.filter(c=>c.body.method==='tools/call');assert.equal('session_id' in tools[0].body.params.arguments,false);assert.equal(tools[1].body.params.arguments.session_id,'session_from_provider');
});
test('Exa search includes objective required by current tool schema',async()=>{
 const calls=[];await adapters.exa({...p,operation:'search',input:'public query'},{key:'',transport:mcpTransport(calls,{results:[]})});
 assert.equal(calls.find(c=>c.body.method==='tools/call').body.params.arguments.objective,'public query');
});

test('Exa captured Markdown-heading fetch format is parsed without a search fallback',()=>{
 const d=fromMCPFetch({content:[{type:'text',text:'# Example Domain\nURL: https://example.com/\n\nExample Domain\n\nThis domain is for use in documentation examples.'}]},p.input,{provider:'Exa'});
 assert.equal(d.results[0].title,'Example Domain');assert.equal(d.results[0].url,p.input);assert.match(d.results[0].content,/documentation examples/);
});
test('provider truncation and dropped fetch results are explicitly marked',()=>{
 const d=fromMCPFetch({content:[],structuredContent:{results:[{url:p.input,full_content:'body',truncated:true},{url:'https://example.org/',excerpts:['not full']}]}},p.input);
 assert.equal(d.partial,true);assert.equal(bounded(d,1,1000).truncated,true);
});
test('keyed Parallel fetch requires page content and reports partial errors',async()=>{
 const context=data=>({key:'mock',transport:async(url,{body})=>{
  assert.equal(url,'https://api.parallel.ai/v1/extract');assert.equal(body.advanced_settings.full_content,true);
  return {status:200,headers:{},text:JSON.stringify(data)};
 }});
 await assert.rejects(adapters.parallel(p,context({results:[{url:p.input,excerpts:['summary only']}]})),{code:'EMPTY_CONTENT'});
 const result=await adapters.parallel(p,context({results:[{url:p.input,full_content:'Full page'}],errors:[{url:'https://example.org/'}]}));
 assert.equal(result.results[0].content,'Full page');assert.equal(result.partial,true);
});
