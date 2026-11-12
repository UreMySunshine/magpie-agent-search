import {domainToASCII} from 'node:url';
import {isIP} from 'node:net';
import {SearchError} from './errors.js';
export function dateBoundary(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new SearchError('USAGE','Dates must be valid YYYY-MM-DD UTC dates');
 return value;
}
export function domains(value){
 if(value===undefined)return [];
 if(/[\\/:@?#%*\s]/.test(value.trim().replace(/,\s*|\s*,/g,',')))throw new SearchError('USAGE','Domains must not contain URL syntax or whitespace');
 const list=value.split(',').map(v=>domainToASCII(v.trim().toLowerCase()));
 if(!list.length||list.length>20||list.some(v=>!v||v.length>253||isIP(v)||!v.includes('.')||v.split('.').some(s=>!/^[-a-z0-9]{1,63}$/.test(s)||s.startsWith('-')||s.endsWith('-')))||list.some(v=>v==='localhost'||v.endsWith('.local')||v.endsWith('.localhost')))throw new SearchError('USAGE','Use up to 20 comma-separated public domain names, without URLs, ports, paths or wildcards');
 return [...new Set(list)];
}
export function parseFilters(options,operation){
 const after=options['--after'],before=options['--before'];
 if(after!==undefined)dateBoundary(after);if(before!==undefined)dateBoundary(before);
 if(after&&before&&after>=before)throw new SearchError('USAGE','--after must precede --before');
 const include=domains(options['--include-domains']),exclude=domains(options['--exclude-domains']);
 if(operation!=='search'&&(after||before||include.length||exclude.length))throw new SearchError('USAGE','Date and domain filters apply to search only');
 return {after,before,include,exclude};
}
export function hasFilters(p){const f=p.filters;return Boolean(f&&(f.after||f.before||f.include.length||f.exclude.length));}
// Only these verified REST contracts receive date constraints. Never guess MCP arguments.
export function filterReason(name,p,credential){return p.filters&&(p.filters.after||p.filters.before)&&!(name==='tavily'||name==='exa'&&credential.key)?'UNSUPPORTED_DATE_FILTER':null;}
export function serverFilters(name,p){
 const f=p.filters;if(!f)return {};
 if(name==='exa')return {...(f.after?{startPublishedDate:f.after+'T00:00:00.000Z'}:{}),...(f.before?{endPublishedDate:f.before+'T00:00:00.000Z'}:{}),...(f.include.length?{includeDomains:f.include}:{}),...(f.exclude.length?{excludeDomains:f.exclude}:{})};
 if(name==='tavily')return {...(f.after?{start_date:f.after}:{}),...(f.before?{end_date:f.before}:{}),...(f.after||f.before?{include_published_date:true,filter_by_published_date:true}:{}),...(f.include.length?{include_domains:f.include,include_domains_mode:'restrict'}:{}),...(f.exclude.length?{exclude_domains:f.exclude}:{})};
 return {};
}
export function applyFilters(data,p,name,credential={}){
 if(!hasFilters(p))return data;
 const f=p.filters,match=(host,d)=>host===d||host.endsWith('.'+d);
 const results=data.results.filter(r=>{
  let host;try{const u=new URL(r.url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return false;host=u.hostname.toLowerCase().replace(/\.$/,'');}catch{return false;}
  if(f.include.length&&!f.include.some(d=>match(host,d))||f.exclude.some(d=>match(host,d)))return false;
  if(f.after||f.before){const t=Date.parse(r.publishedDate);if(!Number.isFinite(t)||f.after&&t<Date.parse(f.after)||f.before&&t>=Date.parse(f.before))return false;}
  return true;
 });
 return {...data,results,content:'',filters:{...f,dateMode:f.after||f.before?'server-and-local-strict':'none',domainMode:f.include.length||f.exclude.length?(name==='tavily'||name==='exa'&&credential.key)?'server-and-local':'local-recalled-results-only':'none',removed:data.results.length-results.length},warnings:[...(data.warnings??[]),'Filters apply to returned results only; no refill requests. Missing dates are excluded when a date window is requested. Provider dates may reflect updates rather than original publication.']};
}
