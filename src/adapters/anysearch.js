// Protocol adapted from dsh-free-search searchAnysearch (MIT); no invalid-key downgrade.
import {jsonRequest} from '../http.js';
import {rows} from '../normalize.js';
import {SearchError} from '../errors.js';
export async function anysearch(p,ctx){
 const fetch=p.operation==='fetch';
 const {data:d}=await jsonRequest(`https://api.anysearch.com/v1/${fetch?'extract':'search'}`,{
  headers:{'Content-Type':'application/json',...(ctx.key?{Authorization:`Bearer ${ctx.key}`}:{})},
  body:fetch?{url:p.input}:{query:p.input,max_results:p.limit},signal:ctx.signal
 },ctx.transport);
 if(d.code!==0)throw new SearchError('PROVIDER_ERROR','AnySearch returned a nonzero business code (details suppressed)');
 if(fetch){
  if(!d.data||typeof d.data.content!=='string'||!d.data.content.trim())throw new SearchError('EMPTY_CONTENT','AnySearch returned no extracted content');
  return {...rows([d.data]),contentKind:'extracted-content'};
 }
 return rows(d.data?.results);
}
