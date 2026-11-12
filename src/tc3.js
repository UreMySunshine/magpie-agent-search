import {createHash,createHmac} from 'node:crypto';
import {SearchError} from './errors.js';
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const hmac=(key,message)=>createHmac('sha256',key).update(message,'utf8').digest();
// Pure signer. No network, environment lookup, logging or SDK installation.
export function signTc3({host,service,action,version,secretId,secretKey,payload,timestamp=Math.floor(Date.now()/1000)}){
 if(typeof payload!=='string'||!Number.isSafeInteger(timestamp)||timestamp<0||!secretId||!secretKey||/[\r\n]/.test(secretId)||/[\r\n]/.test(secretKey))throw new SearchError('INVALID_CREDENTIAL_CONFIG','Invalid TC3 signing inputs (values suppressed)');
 const contentType='application/json; charset=utf-8';
 const date=new Date(timestamp*1000).toISOString().slice(0,10);
 const canonicalHeaders=`content-type:${contentType}\nhost:${host.toLowerCase()}\nx-tc-action:${action.toLowerCase()}\n`;
 const signedHeaders='content-type;host;x-tc-action';
 const payloadHash=hash(payload);
 const canonicalRequest=`POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
 const canonicalHash=hash(canonicalRequest),scope=`${date}/${service}/tc3_request`;
 const stringToSign=`TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${canonicalHash}`;
 const signingKey=hmac(hmac(hmac(`TC3${secretKey}`,date),service),'tc3_request');
 const signature=hmac(signingKey,stringToSign).toString('hex');
 const headers={'Content-Type':contentType,Host:host,'X-TC-Action':action,'X-TC-Version':version,'X-TC-Timestamp':String(timestamp),Authorization:`TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`};
 return {headers,serializedBody:payload,payloadHash,canonicalRequest,canonicalHash,stringToSign,signature};
}
