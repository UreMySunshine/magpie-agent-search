import {SearchError} from './errors.js';
import {parsePublicURL} from './http.js';
const str=v=>typeof v==='string'?v:'';
export function sourceURL(v) {if(typeof v!=='string'||v.length>4000)return null;try{return parsePublicURL(v).href;}catch{return null;}}
export function rows(items) {
  if(!Array.isArray(items)) throw new SearchError('INVALID_RESPONSE','Missing result array');
  return {results:items.map(r=>({title:str(r.title),url:sourceURL(r.url),...(typeof (r.publishedDate??r.published_date)==='string'?{publishedDate:r.publishedDate??r.published_date}:{}),content:str(r.markdown||r.full_content||r.raw_content||r.text||r.content||r.snippet||r.description)||[...(r.snippets??[]),...(r.excerpts??[]),...(r.highlights??[])].join('\n')})).filter(r=>r.url),content:''};
}
export function summaryRows(items, project) {
  if (!Array.isArray(items)) throw new SearchError('INVALID_RESPONSE', 'Missing search result array');
  const normalized = rows(items.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map(project));
  if (items.length && !normalized.results.length) {
    throw new SearchError('INVALID_RESPONSE', 'Search provider returned no usable result pages');
  }
  return { ...normalized, contentKind: 'search-summary', ...(normalized.results.length < items.length ? { partial: true } : {}) };
}
export function bounded(data,limit,maxChars,secrets=[]) {
  const redact=v=>{let s=String(v??'');for(const k of secrets.filter(Boolean))s=s.split(k).join('[REDACTED]');return s;};
  let budget=maxChars,truncated=Boolean(data.truncated);
  const clip=v=>{const s=redact(v);const t=s.slice(0,budget);budget-=t.length;if(t.length<s.length)truncated=true;return t;};
  const chosen=data.results.slice(0,limit);
  if(chosen.length<data.results.length)truncated=true;
  const results=chosen.map(r=>({title:clip(r.title),url:redact(r.url),content:clip(r.content),...(r.publishedDate?{publishedDate:redact(r.publishedDate)}:{})}));
  const content=clip(data.content);
  return {results,content,...(data.filters?{filters:data.filters}:{}),...(data.contentKind?{contentKind:data.contentKind}:{}),...(data.partial?{partial:true}:{}),sources:[...new Set(results.map(r=>r.url).filter(Boolean))],truncated};
}

export function fromMCP(result) {
  const structured=result.structuredContent;
  if(Array.isArray(structured?.results))return rows(structured.results);
  const blocks=result.content.filter(b=>b.type==='text'&&typeof b.text==='string').map(b=>b.text);
  for(const block of blocks){try{const parsed=JSON.parse(block);if(Array.isArray(parsed.results))return rows(parsed.results);}catch{}}
  const text=blocks.join('\n');
  const labeled=text.split(/\n(?=Title:)/).map(block=>({title:block.match(/^Title:\s*(.*)$/m)?.[1]??'',url:block.match(/^URL:\s*(\S+)/m)?.[1],content:block.split(/^(?:Highlights|Text|Content):\s*$/m).slice(1).join('\n')||block})).filter(r=>r.url);
  if(labeled.length)return rows(labeled);
  if(!text.trim())throw new SearchError('INVALID_RESPONSE','MCP returned no usable text');
  // Preserve unfamiliar provider text rather than inventing per-result titles or snippets.
  return {results:[],content:text};
}

export function mcpPayload(result){
 if(result.structuredContent&&typeof result.structuredContent==='object')return result.structuredContent;
 for(const b of result.content??[])if(b.type==='text'&&typeof b.text==='string'){try{const p=JSON.parse(b.text);if(p&&typeof p==='object')return p;}catch{}}
 return null;
}
// Fetch accepts only page text fields, even when the response includes excerpts.
export function fromPagePayload(payload,{provider}={}){
 let entries=Array.isArray(payload?.results)?payload.results:null;
 if(!entries&&payload?.url)entries=[payload];
 if(!entries)return null;
 const usable=entries.filter(r=>r&&typeof r==='object').map(r=>({title:str(r.title),url:sourceURL(r.url),content:str(r.full_content||r.markdown||r.text||r.content)})).filter(r=>r.url&&r.content.trim());
 if(!usable.length)throw new SearchError('EMPTY_CONTENT',`${provider??'Provider'} returned no full page content`);
 const errors=(Array.isArray(payload.errors)?payload.errors.length:0)+(usable.length<entries.length?1:0)+(Array.isArray(payload.statuses)?payload.statuses.filter(s=>s.status&&s.status!=='success').length:0);
 return {results:usable,content:'',contentKind:'page-text',truncated:Boolean(payload.truncated)||entries.some(r=>r?.truncated===true),...(errors?{partial:true,warnings:['Provider reported partial fetch errors; returned pages may be incomplete.']}:{})};
}

export function fromMCPFetch(result,input,{provider}={}){
 const pages=fromPagePayload(mcpPayload(result),{provider});
 if(pages)return pages;
 const blocks=(result.content??[]).filter(b=>b.type==='text'&&typeof b.text==='string').map(b=>b.text);
 const text=blocks.join('\n').replace(/\r\n?/g,'\n');
 // Exa's documented full-content tool may return labeled Markdown rather than JSON.
 const section=text.match(/^(?:Text|Content|Markdown|Full Content):[ \t]*\n([\s\S]*)/im);
 if(section&&section[1].trim())return {results:[{title:text.match(/^Title:\s*(.*)$/m)?.[1]??'',url:sourceURL(text.match(/^URL:\s*(\S+)/m)?.[1]??input),content:section[1]}].filter(r=>r.url),content:'',contentKind:'page-text'};
 // Current web_fetch_exa returns '# Title\nURL: ...\n\n<page Markdown>'.
 const markdown=text.match(/^#{1,6}\s+([^\n]+)\nURL:\s*(\S+)\n\s*\n([\s\S]+)$/);
 if(markdown&&sourceURL(markdown[2])&&markdown[3].trim())return {results:[{title:markdown[1],url:sourceURL(markdown[2]),content:markdown[3]}],content:'',contentKind:'page-text'};
 throw new SearchError('INVALID_RESPONSE',`${provider??'MCP'} fetch did not return recognizable page content`);
}
