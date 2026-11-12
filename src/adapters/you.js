import {jsonRequest} from '../http.js';
import {rows} from '../normalize.js';
import {directFetch} from '../direct-fetch.js';
export async function you(p,ctx) {
  if(!ctx.key){
    if(p.operation==='fetch')return directFetch({...p,engine:'you'},ctx);
    const url=new URL('https://api.you.com/v1/agents/search');url.searchParams.set('query',p.input);url.searchParams.set('count',String(p.limit));
    const {data:d}=await jsonRequest(url.href,{method:'GET',headers:{Accept:'application/json'},signal:ctx.signal},ctx.transport);
    return rows(d.results?.[p.taskType==='news'?'news':'web']);
  }
  const body=p.operation==='search'?{query:p.input,count:p.limit}:{urls:[p.input],formats:['markdown']};
  const {data:d}=await jsonRequest(`https://ydc-index.io/v1/${p.operation==='search'?'search':'contents'}`,{headers:{'Content-Type':'application/json','X-API-Key':ctx.key},body,signal:ctx.signal},ctx.transport);
  return rows(p.operation==='search'?d.results?.[p.taskType==='news'?'news':'web']:d);
}
