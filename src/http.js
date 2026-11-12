import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns/promises';
import net from 'node:net';
import {SearchError, retryAt} from './errors.js';

export function publicIP(ip) {
  if (net.isIP(ip) === 4) {
    const [a,b,c] = ip.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===100 && b>=64 && b<=127) ||
      (a===169 && b===254) || (a===172 && b>=16 && b<=31) || (a===192 && (b===168 || b===0 || (b===2))) ||
      (a===198 && (b===18 || b===19 || (b===51 && c===100))) || (a===203 && b===0 && c===113));
  }
  // Conservative global IPv6 allowlist. Reject mapped IPv4, local, documentation and transition ranges.
  if(net.isIP(ip)!==6)return false;
  const global=new net.BlockList(); global.addSubnet('2000::',3,'ipv6');
  const excluded=new net.BlockList();
  for(const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]])excluded.addSubnet(address,prefix,'ipv6');
  return global.check(ip,'ipv6')&&!excluded.check(ip,'ipv6');
}
export function parsePublicURL(value) {
  let u; try { u = new URL(value); } catch { throw new SearchError('INVALID_URL','A valid HTTP(S) URL is required'); }
  const host = u.hostname.replace(/^\[|\]$/g,'');
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password ||
      (u.port && !['80','443'].includes(u.port)) || host==='localhost' || host.endsWith('.localhost') ||
      host.endsWith('.local') || !host.includes('.') && !net.isIP(host) || net.isIP(host) && !publicIP(host)) {
    throw new SearchError('UNSAFE_URL','Only public HTTP(S) URLs on standard ports are accepted');
  }
  u.hash = ''; return u;
}
export async function resolvePublic(host, lookup = dns.lookup) {
  const name = host.replace(/^\[|\]$/g,'');
  const ips = net.isIP(name) ? [{address:name,family:net.isIP(name)}] : await lookup(name,{all:true});
  if (!ips.length || ips.some(x=>!publicIP(x.address))) throw new SearchError('UNSAFE_URL','Hostname resolves to a non-public address');
  return ips[0];
}
export async function request(url, {method='POST',headers={},body,signal,maxBytes=2_000_000,stopWhen,serializedBody} = {}) {
  const u = parsePublicURL(url);
  if(signal?.aborted)throw new SearchError('TIMEOUT','Request deadline exceeded');
  let onAbort;
  const cancelled = new Promise((_,reject)=>{onAbort=()=>reject(new SearchError('TIMEOUT','Request deadline exceeded'));signal?.addEventListener('abort',onAbort,{once:true});});
  let address;
  try {address=await Promise.race([resolvePublic(u.hostname),cancelled]);} finally {signal?.removeEventListener('abort',onAbort);}
  if (signal?.aborted) throw new SearchError('TIMEOUT','Request deadline exceeded');
  return await new Promise((resolve,reject)=>{
    const req = (u.protocol==='https:'?https:http).request(u, {
      method, headers, signal,
      // Pin the checked DNS address to the socket, including redirects handled by the caller.
      lookup: (_h, options, cb) => cb(null, ...(options.all ? [[address]] : [address.address,address.family]))
    }, res=>{
      let size=0; const chunks=[];
      res.on('data',chunk=>{ size+=chunk.length; if(size>maxBytes) {req.destroy(); reject(new SearchError('RESPONSE_TOO_LARGE','Provider response exceeded byte limit'));} else {chunks.push(chunk);if(stopWhen?.(Buffer.concat(chunks).toString('utf8'))){resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString('utf8')});res.destroy();}} });
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString('utf8')}));
      res.on('error',reject);
    });
    req.on('error',reject);
    req.setTimeout(15_000,()=>req.destroy(new SearchError('TIMEOUT','Socket timeout')));
    req.end(serializedBody??(body===undefined?undefined:JSON.stringify(body)));
  });
}
export function checkStatus(r) {
  if (r.status<200 || r.status>=300) {
    const status = r.status;
    let requestId;
    try{const id=JSON.parse(r.text).request_id;if(typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))requestId=id;}catch{}
    throw new SearchError(status===429?'RATE_LIMIT':status===401||status===403?'AUTH_ERROR':status===402?'QUOTA_EXHAUSTED':'HTTP_ERROR',
      `Provider returned HTTP ${status}`, {status,...(requestId?{requestId}:{}),...([429,503].includes(status)?{retryAt:retryAt(r.headers['retry-after'])}:{})});
  }
}
export async function jsonRequest(url, options, transport=request) {
  const r=await transport(url,options);
  checkStatus(r);
  try { return {data:JSON.parse(r.text),headers:r.headers}; }
  catch { throw new SearchError('INVALID_RESPONSE','Provider returned invalid JSON'); }
}
export async function preflight(value, {signal,transport=request}={}) {
  let u = parsePublicURL(value);
  for (let i=0;i<6;i++) {
    const r = await transport(u.href,{method:'HEAD',signal,maxBytes:16_384});
    if (r.status>=300 && r.status<400) {
      if (!r.headers.location) throw new SearchError('INVALID_RESPONSE','Redirect has no location');
      u = parsePublicURL(new URL(r.headers.location,u).href); continue;
    }
    // HEAD 405/403 is common; the provider may still read the public URL.
    return u.href;
  }
  throw new SearchError('TOO_MANY_REDIRECTS','Target exceeded redirect limit');
}
