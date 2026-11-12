import {jsonRequest} from '../http.js';
import {rows} from '../normalize.js';
export async function keenable(p,ctx) {
  const headers={'Content-Type':'application/json',...(ctx.key?{'X-API-Key':ctx.key}:{'X-Keenable-Title':'agent-search'})};
  const endpoint=`https://api.keenable.ai/v1/${p.operation==='search'?'search':'fetch'}${ctx.key?'':'/public'}`;
  const url=new URL(endpoint);
  if(p.operation==='fetch') {url.searchParams.set('url',p.input);url.searchParams.set('live','true');url.searchParams.set('max_chars',String(p.maxChars));}
  const {data:d}=await jsonRequest(url.href,{method:p.operation==='fetch'?'GET':'POST',headers,signal:ctx.signal,...(p.operation==='search'?{body:{query:p.input,max_results:p.limit,mode:'realtime'}}:{})},ctx.transport);
  return rows(p.operation==='search'?d.results:[d]);
}
