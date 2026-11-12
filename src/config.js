import {readFile,mkdir,rename,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {SearchError} from './errors.js';
import {yuanbaoCredentialMode} from './yuanbao-auth.js';
import {maxResultCount} from './result-count.js';
export const names = ['firecrawl','exa','tavily','parallel','keenable','you','anysearch','yuanbao','tinyfish','querit'];
export const defaultConfigPath = ()=>join(homedir(),'.config/agent-search/config.json');
export const defaultStatePath = ()=>join(homedir(),'.cache/agent-search/state.json');
export function validateConfig(raw={}) {
  const fail=()=>{throw new SearchError('INVALID_CONFIG','Invalid config; see config.example.json and README');};
  if (!raw || typeof raw!=='object' || Array.isArray(raw) || Object.keys(raw).some(k=>!['engines','timeoutMs','maxAttempts'].includes(k))) fail();
  if (raw.engines!==undefined && (!raw.engines || typeof raw.engines!=='object' || Array.isArray(raw.engines))) fail();
  const engines={};
  if(Object.keys(raw.engines??{}).some(n=>!names.includes(n))) fail();
  for(const n of names) {
    const e=raw.engines&&Object.hasOwn(raw.engines,n)?raw.engines[n]:{};
    const fields = ['enabled','key','priority','resultLimit',...(n==='yuanbao'?['secretId','secretKey']:[])];
    if (!e || typeof e!=='object' || Array.isArray(e) || Object.keys(e).some(k=>!fields.includes(k))) fail();
    if(e.enabled!==undefined&&typeof e.enabled!=='boolean' || e.key!==undefined&&typeof e.key!=='string' || e.priority!==undefined&&(!Number.isFinite(e.priority)||e.priority<0||e.priority>1000)) fail();
    if(e.key && /[\r\n]/.test(e.key)) fail();
    if(e.resultLimit!==undefined&&(!Number.isInteger(e.resultLimit)||e.resultLimit<1||e.resultLimit>maxResultCount)) fail();
    if(n==='yuanbao')for(const f of ['secretId','secretKey'])if(e[f]!==undefined&&(typeof e[f]!=='string'||/[\r\n]/.test(e[f])))fail();
    engines[n]={enabled:e.enabled??true,key:e.key?.trim()??'',priority:e.priority??50,
      ...(e.resultLimit===undefined?{}:{resultLimit:e.resultLimit}),
      ...(n==='yuanbao'?{secretId:e.secretId?.trim()??'',secretKey:e.secretKey?.trim()??''}:{})};
  }
  const timeoutMs=raw.timeoutMs??20_000,maxAttempts=raw.maxAttempts??3;
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60_000||!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>names.length) fail();
  return {engines,timeoutMs,maxAttempts};
}
export async function loadConfig(path=defaultConfigPath(),explicit=false) {
  let raw;
  try { raw=await readFile(path,'utf8'); }
  catch(e) { if(e.code==='ENOENT'&&!explicit) return validateConfig(); throw new SearchError('CONFIG_READ_ERROR','Cannot read configuration'); }
  if(Buffer.byteLength(raw)>64_000) throw new SearchError('INVALID_CONFIG','Configuration exceeds size limit');
  try { return validateConfig(JSON.parse(raw)); } catch(e) { if(e instanceof SearchError) throw e; throw new SearchError('INVALID_CONFIG','Configuration is not valid JSON'); }
}
export function stateKey(name,credential) {
 const object=credential&&typeof credential==='object'?credential:null;
 if(name==='yuanbao'&&object){
  const mode=yuanbaoCredentialMode(object);
  const material=mode==='tc3'?[object.secretId,object.secretKey]:mode==='bearer'?[object.key]:[];
  return `yuanbao:${mode}:${createHash('sha256').update(JSON.stringify(material)).digest('hex').slice(0,16)}`;
 }
 const key=object?object.key:credential;
 return `${name}:${key?createHash('sha256').update(key).digest('hex').slice(0,16):'anonymous'}`;
}
export async function readState(path) {
  try {const s=await readFile(path,'utf8'); if(s.length>64_000)return {}; const v=JSON.parse(s); return v&&typeof v==='object'&&!Array.isArray(v)?v:{};} catch{return {};}
}
export async function saveState(path,state) {
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const tmp=`${path}.${randomUUID()}.tmp`;
  await writeFile(tmp,JSON.stringify(state),{mode:0o600,flag:'wx'}); await rename(tmp,path);
}
