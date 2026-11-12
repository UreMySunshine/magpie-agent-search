import {serverFilters} from '../filters.js';
import {jsonRequest} from '../http.js';
import {rows} from '../normalize.js';
import {SearchError} from '../errors.js';
export async function tavily(p,ctx) {
  const headers={'Content-Type':'application/json',...(ctx.key?{Authorization:`Bearer ${ctx.key}`}:{'X-Tavily-Access-Mode':'keyless'})};
  const body=p.operation==='search'?{...serverFilters('tavily',p),query:p.input,max_results:p.limit,search_depth:'basic',...(p.taskType==='news'?{topic:'news'}:{})}:{urls:[p.input]};
  const {data:d}=await jsonRequest(`https://api.tavily.com/${p.operation==='search'?'search':'extract'}`,{headers,body,signal:ctx.signal},ctx.transport);
  if(p.operation==='fetch'&&!d.results?.length)throw new SearchError('PROVIDER_ERROR','Tavily could not extract the URL');
  return rows(d.results);
}
