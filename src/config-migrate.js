import {validateConfig,names} from './config.js';
import {SearchError} from './errors.js';
// Pure migration: preserve every existing value and missing old-provider key.
export function addMissingEngine(raw,name){
 validateConfig(raw);
 if(!names.includes(name))throw new SearchError('INVALID_CONFIG','Unknown engine migration target');
 const config=structuredClone(raw);let changed=false;
 if(!Object.hasOwn(config,'engines')){config.engines={};changed=true;}
 if(!Object.hasOwn(config.engines,name)){config.engines[name]={};changed=true;}
 for(const [key,value]of Object.entries({enabled:true,key:'',priority:50,...(name==='yuanbao'?{secretId:'',secretKey:''}:{})})){
  if(!Object.hasOwn(config.engines[name],key)){config.engines[name][key]=value;changed=true;}
 }
 validateConfig(config);return {config,changed};
}
export const addMissingAnysearch=raw=>addMissingEngine(raw,'anysearch');
export const addMissingYuanbao=raw=>addMissingEngine(raw,'yuanbao');
