import {yuanbaoCredentialMode} from '../yuanbao-auth.js';
export const searchOnlyEngines = new Set(['yuanbao','tinyfish','querit']);
export function capabilityReason(name,operation,credential){
 if(operation!=='search'&&searchOnlyEngines.has(name))return 'UNSUPPORTED_OPERATION';
 if(name==='querit')return (typeof credential==='object'?credential?.key:credential)?null:'requires_key';
 if(name!=='yuanbao')return null;
 const mode=yuanbaoCredentialMode(typeof credential==='object'?credential:{key:credential});
 return mode==='incomplete'?'incomplete_credentials':mode==='missing'?'requires_key':null;
}
export function providerMode(name,credential,operation='search') {
 const key=credential&&typeof credential==='object'?credential.key:credential;
 if(name==='yuanbao'){
  const mode=yuanbaoCredentialMode(typeof credential==='object'?credential:{key:credential});
  return mode==='tc3'?'tc3-rest':mode==='bearer'?'key-rest':mode==='incomplete'?'invalid-credentials':'requires-key';
 }
 if(name==='direct-http'||!key&&name==='you'&&operation==='fetch')return 'anonymous-direct-http';
 if(name==='querit'&&!key)return 'requires-key';
 return key?'key-rest':['exa','parallel','tinyfish'].includes(name)?'anonymous-mcp-http':'anonymous-rest';
}
