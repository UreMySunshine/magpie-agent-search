import {jsonRequest} from '../http.js';
import {rows,fromMCP,fromMCPFetch,fromPagePayload,mcpPayload} from '../normalize.js';
import {mcpCall} from '../mcp.js';
import {SearchError} from '../errors.js';
export async function parallel(p,ctx) {
  if(!ctx.key){
    const session=typeof ctx.parallelSessionId==='string'&&/^[-_a-zA-Z0-9]{1,1000}$/.test(ctx.parallelSessionId)?{session_id:ctx.parallelSessionId}:{};
    const fetch=p.operation==='fetch';
    const result=await mcpCall('https://mcp.parallel.ai/mcp',fetch?'web_fetch':'web_search',fetch?{urls:[p.input],full_content:true,allow_live_fetch:true,...session}:{objective:p.input,search_queries:[p.input],...session},ctx);
    const data=fetch?fromMCPFetch(result,p.input,{provider:'Parallel'}):fromMCP(result);
    const id=mcpPayload(result)?.session_id;
    return {...data,...(typeof id==='string'&&/^[-_a-zA-Z0-9]{1,1000}$/.test(id)?{parallelSessionId:id}:{})};
  }
  const body=p.operation==='search'?{objective:p.input,search_queries:[p.input],mode:'fast',max_chars_total:p.maxChars,advanced_settings:{max_results:p.limit}}:{urls:[p.input],advanced_settings:{full_content:true}};
  const {data:d}=await jsonRequest(`https://api.parallel.ai/v1/${p.operation==='search'?'search':'extract'}`,{headers:{'Content-Type':'application/json','x-api-key':ctx.key},body,signal:ctx.signal},ctx.transport);
  if(p.operation==='fetch') {
    const pages=fromPagePayload(d,{provider:'Parallel'});
    if(!pages)throw new SearchError('INVALID_RESPONSE','Parallel returned no extract results');
    return pages;
  }
  return rows(d.results?.map(r=>({...r,content:r.full_content??r.excerpts?.join('\n')})));
}
