import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mcpCall,rpcMessages,rpcResponse} from '../src/mcp.js';
import {fromMCP} from '../src/normalize.js';
import {adapters} from '../src/adapters/index.js';
import {run,candidates,queryLanguage} from '../src/router.js';
import {validateConfig} from '../src/config.js';
const payload={content:[{type:'text',text:'Title: Example\nURL: https://example.com/\nHighlights:\nUseful content'}]};
function fixture(calls,{toolResult=payload,error,httpStatus=200,version='2025-03-26',sse=true}={}){
 return async(url,o)=>{
  calls.push({url,...o});const {method,id}=o.body;
  if(method==='notifications/initialized')return {status:202,headers:{},text:''};
  if(httpStatus!==200)return {status:httpStatus,headers:{'retry-after':'3600'},text:'secret body not for logs'};
  const result=method==='initialize'?{protocolVersion:version}:toolResult;
  const response={jsonrpc:'2.0',id,...(method==='tools/call'&&error?{error}:{result})};
  return {status:200,headers:{'mcp-session-id':'mock-transport-session'},text:sse?`event: ping\ndata: heartbeat\n\nevent: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: ${JSON.stringify(response)}\n\n`:JSON.stringify(response)};
 };
}
test('JSON/SSE parser handles BOM, CRLF, comments, notifications and multiline data',()=>{
 const text='\ufeff: keepalive\r\nevent: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0","id":7,\r\ndata: "result":{"value":1}}\r\n\r\n';
 assert.equal(rpcMessages(text).length,2);assert.deepEqual(rpcResponse(text,7),{value:1});
 assert.deepEqual(rpcResponse('{"jsonrpc":"2.0","id":7,"result":{}}',7),{});
 assert.throws(()=>rpcResponse(text,8),{code:'MCP_PROTOCOL'});
 assert.throws(()=>rpcResponse('data: broken\n\n',7),{code:'INVALID_RESPONSE'});
 assert.throws(()=>rpcResponse('[{"jsonrpc":"2.0","id":7,"result":{}},{"jsonrpc":"2.0","id":7,"result":{}}]',7),{code:'MCP_PROTOCOL'});
});
for(const sse of [false,true])test(`MCP lifecycle, negotiation, bounded request count and session (${sse?'SSE':'JSON'})`,async()=>{
 const calls=[];const out=await mcpCall('https://mcp.exa.ai/mcp','web_search_exa',{query:'example',numResults:1},{transport:fixture(calls,{sse,version:'2025-06-18'})});
 assert.deepEqual(out,payload);assert.deepEqual(calls.map(c=>c.body.method),['initialize','notifications/initialized','tools/call']);
 assert.equal(calls[1].body.id,undefined);assert.equal(calls[2].headers['Mcp-Session-Id'],'mock-transport-session');
 assert.equal(calls[2].headers['MCP-Protocol-Version'],'2025-06-18');
 assert.equal(calls[2].stopWhen('data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n'),false);
 assert.equal(calls[2].stopWhen('data: {"jsonrpc":"2.0","id":2,"result":{}}\n\n'),true);
});
test('MCP protocol/errors do not leak upstream text or replay tool calls',async()=>{
 const calls=[];await assert.rejects(mcpCall('https://mcp.exa.ai/mcp','web_search_exa',{}, {transport:fixture(calls,{error:{code:-32602,message:'secret server details'}})}),e=>e.code==='MCP_ERROR'&&!e.message.includes('secret'));
 assert.equal(calls.filter(c=>c.body.method==='tools/call').length,1);
 await assert.rejects(mcpCall('https://mcp.exa.ai/mcp','x',{}, {transport:fixture([],{version:'unexpected'})}),{code:'MCP_PROTOCOL'});
 await assert.rejects(mcpCall('https://mcp.exa.ai/mcp','x',{}, {transport:fixture([],{httpStatus:429})}),e=>e.code==='RATE_LIMIT'&&e.status===429&&e.retryAt>Date.now()+3590000);
 await assert.rejects(mcpCall('https://mcp.exa.ai/mcp','x',{}, {transport:fixture([],{toolResult:{isError:true,content:[{type:'text',text:'429 rate limited secret'}]}})}),e=>e.code==='RATE_LIMIT'&&!e.message.includes('secret'));
});
test('MCP results preserve labeled sources, structured JSON and opaque evidence',()=>{
 assert.equal(fromMCP(payload).results[0].content.trim(),'Useful content');
 assert.equal(fromMCP({content:[],structuredContent:{results:[{url:'https://example.com/',text:'content'}]}}).results[0].content,'content');
 assert.equal(fromMCP({content:[{type:'text',text:'{"results":[]}'}]}).results.length,0);
 const opaque=fromMCP({content:[{type:'text',text:'Unknown future result format'}]});assert.deepEqual(opaque,{results:[],content:'Unknown future result format'});
});
test('Parallel anonymous session ID is supplied unchanged across calls',async()=>{
 const calls=[],p={operation:'search',input:'example search',limit:1};
 const transport=fixture(calls,{toolResult:{content:[{type:'text',text:'{"results":[]}'}]}});
 await adapters.parallel(p,{key:'',parallelSessionId:'stable-review-session',transport});
 await adapters.parallel(p,{key:'',parallelSessionId:'stable-review-session',transport});
 assert.deepEqual(calls.filter(c=>c.body.method==='tools/call').map(c=>c.body.params.arguments.session_id),['stable-review-session','stable-review-session']);
});
test('configured Exa and Parallel keys never call MCP after REST rejection',async()=>{
 for(const name of ['exa','parallel']){
  const calls=[];await assert.rejects(adapters[name]({operation:'search',input:'query',limit:1,maxChars:1000},{key:'mock-secret',transport:async(url,o)=>{calls.push(url);return {status:401,headers:{},text:'details'};}}),{code:'AUTH_ERROR'});
  assert.equal(calls.length,1);assert.equal(calls[0].includes('/mcp'),false);
 }
});
test('language, task and config priority explain deterministic routing',()=>{
 const c=validateConfig();const p={operation:'search',input:'中文资料',taskType:'general',limit:1,maxChars:1000};
 assert.equal(queryLanguage('日本語'),'cjk');assert.equal(queryLanguage('한국어'),'cjk');assert.equal(queryLanguage('English'),'non-cjk');
 const plan=candidates(p,c,{});assert.equal(plan.eligible[0],'keenable');assert.equal(plan.routing.queryLanguage,'cjk');
 assert.equal(candidates({...p,taskType:'code'},c,{}).eligible[0],'exa');
 c.engines.you.priority=1;assert.equal(candidates(p,c,{}).eligible[0],'you');
 assert.equal(candidates({...p,engine:'tavily'},c,{}).routing.selection,'explicit-engine');
});
test('MCP transport failure obeys routing deadline with one attempted engine',async()=>{
 const c=validateConfig({timeoutMs:100,maxAttempts:1});const p={operation:'search',input:'query',taskType:'code',limit:1,maxChars:1000};
 const out=await run(p,c,{transport:async(_url,o)=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(Error('abort'))))});
 assert.equal(out.attempts.length,1);assert.equal(out.attempts[0].error.code,'TIMEOUT');assert.equal(out.attempts[0].mode,'anonymous-mcp-http');
});
