import {jsonRequest} from '../http.js';
import {rows} from '../normalize.js';
import {SearchError} from '../errors.js';
export async function firecrawl(p,ctx) {
  const headers={'Content-Type':'application/json',...(ctx.key?{Authorization:`Bearer ${ctx.key}`}:{})};
  const body=p.operation==='search'?{query:p.input,limit:p.limit,...(p.taskType==='code'?{categories:[{type:'developer'}]}:{}),...(p.taskType==='news'?{sources:[{type:'news'}]}:{})}:{url:p.input,formats:['markdown'],onlyMainContent:true};
  const {data:d}=await jsonRequest(`https://api.firecrawl.dev/v2/${p.operation==='search'?'search':'scrape'}`,{headers,body,signal:ctx.signal},ctx.transport);
  if(d.success===false)throw new SearchError('PROVIDER_ERROR','Firecrawl reported failure');
  if(p.operation==='fetch') {if(!d.data?.markdown)throw new SearchError('INVALID_RESPONSE','Firecrawl returned no page content');return rows([{...d.data,url:d.data.metadata?.sourceURL??p.input,title:d.data.metadata?.title}]);}
  return rows(Array.isArray(d.data)?d.data:d.data?.[p.taskType==='news'?'news':'web']);
}
