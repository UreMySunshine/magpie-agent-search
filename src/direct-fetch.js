// Explicit local fallback for providers without an anonymous full-content API.
// Returns inert plain text; never executes scripts or downloads page subresources.
import {request,parsePublicURL,checkStatus} from './http.js';
import {SearchError} from './errors.js';
// Adapted from dsh-free-search/lib/fetch_upstream.js htmlToText (MIT).
// Keep plain text output and add line breaks before cleanup for readable paragraphs.
export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}
export function cleanHTML(html){
  const title=htmlToText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]??'');
  const content=htmlToText(html.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi,'').replace(/<(?:br|hr)\b[^>]*\/?\s*>|<\/(?:p|div|section|article|main|h[1-6]|li|tr)\s*>/gi,'\n')).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');
  return {title,content};
}
export async function directFetch(p,{transport=request,signal}={}){
 let url=parsePublicURL(p.input);
 for(let hop=0;hop<6;hop++){
  const response=await transport(url.href,{method:'GET',headers:{Accept:'text/html, text/plain, text/markdown, application/xhtml+xml','Accept-Encoding':'identity'},signal,maxBytes:2_000_000});
  if(response.status>=300&&response.status<400){
   if(!response.headers.location)throw new SearchError('INVALID_RESPONSE','Redirect has no location');
   url=parsePublicURL(new URL(response.headers.location,url).href);continue;
  }
  checkStatus(response);
  const mime=String(response.headers['content-type']??'').toLowerCase();
  if(!/^(text\/(html|plain|markdown)|application\/xhtml\+xml)(;|$)/.test(mime))throw new SearchError('UNSUPPORTED_CONTENT_TYPE','Direct fallback accepts HTML, Markdown or plain text only');
  const charset=mime.match(/charset\s*=\s*["']?([^;"'\s]+)/)?.[1];
  if(charset&&!['utf-8','utf8','us-ascii'].includes(charset))throw new SearchError('UNSUPPORTED_ENCODING','Direct fallback requires UTF-8 text');
  if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity')throw new SearchError('UNSUPPORTED_ENCODING','Direct fallback does not decode compressed responses');
  const body=mime.includes('html')?cleanHTML(response.text):{title:'',content:response.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'')};
  if(!body.content.trim())throw new SearchError('EMPTY_CONTENT','Direct fallback returned no usable page text');
  return {results:[{...body,url:url.href}],content:'',actualProvider:'direct-http',transport:'anonymous-direct-http',contentKind:'page-text',warnings:[...(p.engine==='you'?['You has no documented anonymous contents API; this response was fetched directly from the public URL, not by You.']:[]),'Direct fallback does not render JavaScript or guarantee article-only extraction.']};
 }
 throw new SearchError('TOO_MANY_REDIRECTS','Target exceeded redirect limit');
}
