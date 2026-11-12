import {signTc3} from '../tc3.js';
import {yuanbaoCredentialMode} from '../yuanbao-auth.js';
import {request,checkStatus} from '../http.js';
import {rows} from '../normalize.js';
import {htmlToText} from '../direct-fetch.js';
import {SearchError,retryAt} from '../errors.js';
const endpoint='https://api.wsa.cloud.tencent.com/SearchPro';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const knownCodes=new Set(['UnauthorizedOperation','AuthFailure','InvalidCredential','ResourceUnavailable','ResourceInsufficient','LimitExceeded','FailedOperation','RequestLimitExceeded','ResourceNotFound','InvalidParameter','InvalidParameterValue','MissingParameter','UnsupportedOperation','InternalError']);
function providerError(error,response,requestId){
 const raw=typeof error?.Code==='string'?error.Code:'';
 const base=raw.split('.')[0],providerCode=knownCodes.has(base)?base:'UnknownProviderError';
 const status=response.status;
 const code=status===429||base==='RequestLimitExceeded'?'RATE_LIMIT':status===401||status===403||['UnauthorizedOperation','AuthFailure','InvalidCredential'].includes(base)?'AUTH_ERROR':status===402||['ResourceUnavailable','ResourceInsufficient','LimitExceeded'].includes(base)||/^(FailedOperation)\.(NoCredit|QuotaExceeded|InsufficientBalance)$/.test(raw)?'QUOTA_EXHAUSTED':base==='ResourceNotFound'?'SERVICE_NOT_ENABLED':['InvalidParameter','InvalidParameterValue','MissingParameter'].includes(base)?'INVALID_PARAMETER':'PROVIDER_ERROR';
 throw new SearchError(code,`Tencent Yuanbao reported ${providerCode} (details suppressed)`,{status,providerCode,...(typeof requestId==='string'&&uuid.test(requestId)?{requestId}:{}),...(code==='RATE_LIMIT'?{retryAt:retryAt(response.headers['retry-after'])}:{})});
}
export async function yuanbao(p,ctx){
 if(p.operation!=='search')throw new SearchError('UNSUPPORTED_OPERATION','Yuanbao supports search summaries only; use the normal fetch chain for page content');
 const mode=yuanbaoCredentialMode(ctx);
 if(mode==='incomplete')throw new SearchError('INVALID_CREDENTIAL_CONFIG','Set both yuanbao.secretId and secretKey; an incomplete pair cannot fall back to Bearer');
 if(mode==='missing')throw new SearchError('REQUIRES_KEY','Yuanbao requires a complete SecretId/SecretKey pair or a service Bearer API key');
 const limit=Number.isFinite(p.limit)?p.limit:5;
 const Cnt=[10,20,30,40,50].find(n=>n>=Math.max(1,limit))??50;
 const requestBody={Query:p.input,Cnt,...(p.taskType==='news'?{Industry:'news'}:{})};
 const signed=mode==='tc3'?signTc3({host:'wsa.tencentcloudapi.com',service:'wsa',action:'SearchPro',version:'2025-05-08',secretId:ctx.secretId,secretKey:ctx.secretKey,payload:JSON.stringify(requestBody),...(ctx.timestamp!==undefined?{timestamp:ctx.timestamp}:{})}):null;
 const response=await (ctx.transport??request)(signed?'https://wsa.tencentcloudapi.com/':endpoint,{method:'POST',headers:signed?signed.headers:{'Content-Type':'application/json; charset=utf-8',Authorization:`Bearer ${ctx.key}`},body:requestBody,...(signed?{serializedBody:signed.serializedBody}:{}),signal:ctx.signal});
 let body;try{body=JSON.parse(response.text);}catch{checkStatus(response);throw new SearchError('INVALID_RESPONSE','Yuanbao returned invalid JSON');}
 const data=body?.Response;
 if(data?.Error)providerError(data.Error,response,data.RequestId);
 checkStatus(response);
 if(!Array.isArray(data?.Pages))throw new SearchError('INVALID_RESPONSE','Yuanbao returned no Pages array');
 const parsed=[];let invalid=0;
 for(const page of data.Pages){
  if(typeof page!=='string'){invalid++;continue;}
  try{const r=JSON.parse(page);if(!r||typeof r!=='object'||Array.isArray(r)){invalid++;continue;}
   const summary=typeof r.content==='string'&&r.content.trim()?r.content:typeof r.passage==='string'?r.passage:'';
   parsed.push({title:typeof r.title==='string'?htmlToText(r.title):'',url:r.url,content:htmlToText(summary)});
  }catch{invalid++;}
 }
 const result=rows(parsed);invalid+=parsed.length-result.results.length;
 if(data.Pages.length&&!result.results.length)throw new SearchError('INVALID_RESPONSE','Yuanbao returned no valid result pages');
 return {...result,contentKind:'search-summary',...(invalid?{partial:true}:{}),warnings:['Yuanbao passage/content fields are search summaries, not full page content.',...(invalid?['Some malformed or unsafe Yuanbao Pages entries were omitted.']:[])]};
}
