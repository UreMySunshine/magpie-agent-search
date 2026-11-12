// Minimal Streamable HTTP client; no server, package install, OAuth or credential discovery.
import {request,checkStatus} from './http.js';
import {SearchError} from './errors.js';

export function rpcMessages(text) {
  const source=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim();
  if(!source)throw new SearchError('INVALID_RESPONSE','Empty MCP response');
  try {const value=JSON.parse(source);return Array.isArray(value)?value:[value];} catch {}
  const messages=[];
  for(const frame of source.split('\n\n')) {
    const lines=frame.split('\n');
    const event=lines.find(l=>l.startsWith('event:'))?.slice(6).trim()??'message';
    if(event!=='message')continue;
    const data=lines.filter(l=>l.startsWith('data:')).map(l=>l.slice(5).replace(/^ /,'')).join('\n');
    if(!data)continue;
    try{messages.push(JSON.parse(data));}catch{throw new SearchError('INVALID_RESPONSE','Malformed MCP SSE data');}
  }
  return messages;
}
export function rpcResponse(text,id) {
  const matching=rpcMessages(text).filter(m=>m&&m.jsonrpc==='2.0'&&m.id===id);
  if(matching.length!==1)throw new SearchError('MCP_PROTOCOL','Expected one matching MCP response');
  const message=matching[0];
  if(message.error)throw new SearchError('MCP_ERROR','MCP request rejected (details suppressed)');
  if(!('result' in message))throw new SearchError('MCP_PROTOCOL','Missing MCP result');
  return message.result;
}
function toolFailure(result) {
  const text=(result.content??[]).filter(c=>c.type==='text').map(c=>c.text).join(' ');
  const code=/\b429\b|rate.?limit|too many requests/i.test(text)?'RATE_LIMIT':/\b402\b|quota|credits|payment required/i.test(text)?'QUOTA_EXHAUSTED':/\b40[13]\b|unauthori[sz]ed|invalid api.?key/i.test(text)?'AUTH_ERROR':'MCP_TOOL_ERROR';
  throw new SearchError(code,'MCP tool reported failure (details suppressed)',code==='RATE_LIMIT'?{retryAt:Date.now()+60000}:{});
}
async function rpcPost(url,body,{transport=request,signal,headers={}}={}) {
  const {id}=body;
  const response=await transport(url,{method:'POST',signal,
    headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...headers},
    body,
    // End a streaming response once its matching reply arrives.
    ...(id===undefined?{}:{stopWhen:text=>{try{rpcResponse(text,id);return true;}catch(e){return e.code==='MCP_ERROR';}}})});
  checkStatus(response);
  return response;
}
async function mcpExchange(url,method,params,{transport=request,signal}={}) {
  let session,protocol='2025-03-26',nextId=0;
  async function send(method,params,notification=false) {
    const id=notification?undefined:++nextId;
    const response=await rpcPost(url,{jsonrpc:'2.0',...(notification?{}:{id}),method,...(params?{params}:{})},
      {transport,signal,headers:{...(method==='initialize'?{}:{'MCP-Protocol-Version':protocol}),...(session?{'Mcp-Session-Id':session}:{})}});
    const assigned=response.headers['mcp-session-id'];
    if(assigned!==undefined){if(typeof assigned!=='string'||!/^[\x21-\x7e]{1,512}$/.test(assigned))throw new SearchError('MCP_PROTOCOL','Invalid MCP session header');session=assigned;}
    if(notification)return;
    return rpcResponse(response.text,id);
  }
  const init=await send('initialize',{protocolVersion:protocol,capabilities:{},clientInfo:{name:'agent-search',version:'0.7.0'}});
  if(!['2025-03-26','2025-06-18','2025-11-25'].includes(init?.protocolVersion))throw new SearchError('MCP_PROTOCOL','Unsupported MCP protocol version');
  protocol=init.protocolVersion;
  await send('notifications/initialized',undefined,true);
  return send(method,params);
}
export async function mcpListTools(url,options) {
  const result=await mcpExchange(url,'tools/list',undefined,options);
  if(!Array.isArray(result?.tools))throw new SearchError('INVALID_RESPONSE','Missing MCP tool list');
  return result.tools;
}
export async function mcpCall(url,name,args,options) {
  return checkedToolResult(await mcpExchange(url,'tools/call',{name,arguments:args},options));
}
export async function mcpCallStateless(url,name,args,options) {
  const id=1;
  const response=await rpcPost(url,{jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}},options);
  return checkedToolResult(rpcResponse(response.text,id));
}
function checkedToolResult(result) {
  if(!result||!Array.isArray(result.content))throw new SearchError('INVALID_RESPONSE','Missing MCP tool content');
  if(result.isError)toolFailure(result);
  return result;
}
