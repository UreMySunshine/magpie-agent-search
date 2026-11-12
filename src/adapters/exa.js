import {serverFilters} from '../filters.js';
import {jsonRequest} from '../http.js';
import {rows,fromMCP,fromMCPFetch} from '../normalize.js';
import {mcpCall} from '../mcp.js';
export async function exa(p,ctx) {
  if(!ctx.key){
    if(p.operation==='fetch')return fromMCPFetch(await mcpCall('https://mcp.exa.ai/mcp','web_fetch_exa',{urls:[p.input],maxCharacters:p.maxChars},ctx),p.input,{provider:'Exa'});
    return fromMCP(await mcpCall('https://mcp.exa.ai/mcp','web_search_exa',{query:p.input,objective:p.input,numResults:p.limit},ctx));
  }
  const body=p.operation==='search'?{...serverFilters('exa',p),query:p.input,numResults:p.limit,type:'auto',contents:{text:{maxCharacters:p.maxChars}}}:{urls:[p.input],text:{maxCharacters:p.maxChars}};
  const {data:d}=await jsonRequest(`https://api.exa.ai/${p.operation==='search'?'search':'contents'}`,{headers:{'Content-Type':'application/json','x-api-key':ctx.key},body,signal:ctx.signal},ctx.transport);
  return rows(d.results);
}
