import {test} from 'node:test';
import assert from 'node:assert/strict';
import {signTc3} from '../src/tc3.js';
import {yuanbaoCredentialMode} from '../src/yuanbao-auth.js';
import {validateConfig,stateKey} from '../src/config.js';
import {addMissingYuanbao} from '../src/config-migrate.js';
import {yuanbao} from '../src/adapters/yuanbao.js';
import {candidates,run} from '../src/router.js';
const p={operation:'search',input:'中文 Node.js',taskType:'general',limit:1,maxChars:1000};
const creds={key:'ignored-bearer',secretId:'AKID_TEST_ID',secretKey:'TEST_SECRET_KEY'};
const reply=body=>({status:200,headers:{},text:JSON.stringify(body)});
test('official public 2019-02-25 TC3 vector matches payload hash, canonical hash and final signature',()=>{
 // These 32-star values are public placeholders in Tencent's documentation, not user credentials.
 const signed=signTc3({host:'cvm.tencentcloudapi.com',service:'cvm',action:'DescribeInstances',version:'2017-03-12',secretId:'AKID'+'*'.repeat(32),secretKey:'*'.repeat(32),timestamp:1551113065,payload:String.raw`{"Limit": 1, "Filters": [{"Values": ["\u672a\u547d\u540d"], "Name": "instance-name"}]}`});
 assert.equal(signed.payloadHash,'35e9c5b0e3ae67532d3c9f17ead6c90222632e5b1ff7f6e89887f1398934f064');
 assert.equal(signed.canonicalHash,'7019a55be8395899b900fb5564e4200d984910f34794a27cb3fb7d10ff6a1e84');
 assert.equal(signed.signature,'10b1a37a7301a02ca19a647ad722d5e43b4b3cff309d421d85b46093f6ab6c4f');
 assert.equal(signed.stringToSign,'TC3-HMAC-SHA256\n1551113065\n2019-02-25/cvm/tc3_request\n7019a55be8395899b900fb5564e4200d984910f34794a27cb3fb7d10ff6a1e84');
});
test('fixed WSA UTF-8 payload matches independent Python HMAC golden signature',async()=>{
 const calls=[];await yuanbao(p,{...creds,timestamp:1704067200,transport:async(url,o)=>{calls.push({url,...o});return reply({Response:{Pages:[]}});}});
 const req=calls[0];assert.equal(calls.length,1);assert.equal(req.url,'https://wsa.tencentcloudapi.com/');
 assert.equal(req.headers.Host,'wsa.tencentcloudapi.com');assert.equal(req.headers['X-TC-Action'],'SearchPro');assert.equal(req.headers['X-TC-Version'],'2025-05-08');assert.equal(req.headers['X-TC-Timestamp'],'1704067200');assert.equal('X-TC-Region' in req.headers,false);assert.equal('X-TC-Token' in req.headers,false);
 assert.equal(req.serializedBody,JSON.stringify(req.body));assert.equal(req.serializedBody,'{"Query":"中文 Node.js","Cnt":10}');
 assert.equal(req.headers.Authorization,'TC3-HMAC-SHA256 Credential=AKID_TEST_ID/2024-01-01/wsa/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=0285f8af1dca35a73a834faa8001db75a695f85fdbb3a08896d5aa5e4e18d19f');
 assert.ok(!JSON.stringify(req).includes(creds.secretKey));assert.ok(!JSON.stringify(req).includes(creds.key));
});
test('TC3 date uses UTC across timezone/day boundary and body changes alter signature',()=>{
 const args={host:'wsa.tencentcloudapi.com',service:'wsa',action:'SearchPro',version:'2025-05-08',...creds,payload:'{"Query":"a"}',timestamp:1551113065};
 const a=signTc3(args),b=signTc3({...args,payload:'{"Query":"b"}'});assert.match(a.headers.Authorization,/\/2019-02-25\/wsa\/tc3_request/);assert.notEqual(a.signature,b.signature);
});
test('credential selection prefers complete pair, accepts Bearer only when both pair fields empty',()=>{
 assert.equal(yuanbaoCredentialMode(creds),'tc3');assert.equal(yuanbaoCredentialMode({key:'bearer',secretId:'',secretKey:''}),'bearer');assert.equal(yuanbaoCredentialMode({}),'missing');
 assert.equal(yuanbaoCredentialMode({key:'bearer',secretId:'one'}),'incomplete');assert.equal(yuanbaoCredentialMode({key:'bearer',secretKey:'one'}),'incomplete');
});
for(const half of [{secretId:'mock-id'},{secretKey:'mock-secret'}])test(`incomplete pair ${Object.keys(half)[0]} skips routing and never falls back to configured Bearer`,async()=>{
 const c=validateConfig({engines:{yuanbao:{key:'mock-bearer',...half}}});let count=0;
 assert.equal(candidates(p,c,{}).skipped.find(s=>s.engine==='yuanbao').reason,'incomplete_credentials');
 const r=await run({...p,engine:'yuanbao'},c,{transport:async()=>{count++;}});assert.equal(r.error.code,'INVALID_CREDENTIAL_CONFIG');assert.equal(count,0);
 await assert.rejects(yuanbao(p,{key:'mock-bearer',...half,transport:async()=>{count++;}}),{code:'INVALID_CREDENTIAL_CONFIG'});assert.equal(count,0);
});
test('TC3 error never retries Bearer and routing redacts SecretId/SecretKey in successful content',async()=>{
 const c=validateConfig({engines:{yuanbao:creds}});let count=0;const state={};
 const failed=await run({...p,engine:'yuanbao'},c,{state,now:()=>1000,transport:async(url)=>{count++;assert.equal(new URL(url).hostname,'wsa.tencentcloudapi.com');return reply({Response:{Error:{Code:'AuthFailure.SignatureFailure',Message:'TEST_SECRET_KEY'}}});}});
 assert.equal(count,1);assert.equal(failed.attempts[0].authMode,'tc3');assert.equal(failed.attempts[0].mode,'tc3-rest');assert.ok(!JSON.stringify(failed).includes(creds.secretKey));
 const success=await run({...p,engine:'yuanbao'},c,{transport:async()=>reply({Response:{Pages:[JSON.stringify({url:'https://example.com/',content:`${creds.secretId} ${creds.secretKey} ${creds.key}`})]}})});
 assert.equal(success.authMode,'tc3');assert.ok(!JSON.stringify(success).includes(creds.secretId));assert.ok(!JSON.stringify(success).includes(creds.secretKey));
});
test('cooldown fingerprint isolates TC3, Bearer, either pair field rotation and no plaintext secrets',()=>{
 const tc=stateKey('yuanbao',creds),bearer=stateKey('yuanbao',{key:creds.secretKey,secretId:'',secretKey:''});assert.match(tc,/^yuanbao:tc3:[0-9a-f]{16}$/);assert.match(bearer,/^yuanbao:bearer:[0-9a-f]{16}$/);assert.notEqual(tc,bearer);
 assert.notEqual(tc,stateKey('yuanbao',{...creds,secretId:'NEW_ID'}));assert.notEqual(tc,stateKey('yuanbao',{...creds,secretKey:'NEW_SECRET'}));assert.equal(tc,stateKey('yuanbao',{...creds,key:'unused-other-bearer'}));assert.ok(!tc.includes(creds.secretId)&&!tc.includes(creds.secretKey));
 assert.equal(stateKey('exa',{key:'mock-key'}),stateKey('exa','mock-key'));
});
test('TC3 credentials are not forwarded to the next provider after a failed Yuanbao attempt',async()=>{
 const c=validateConfig({engines:{yuanbao:{...creds,priority:1}}});const calls=[];
 const r=await run(p,c,{implementations:{yuanbao:async(_p,ctx)=>{calls.push(ctx.secretId);throw Error('network');},tavily:async(_p,ctx)=>{assert.equal(ctx.secretId,undefined);assert.equal(ctx.secretKey,undefined);return {results:[],content:''};}}});assert.equal(r.ok,true);assert.equal(r.engine,'tavily');assert.equal(calls.length,1);
});
test('config accepts only Yuanbao pair fields, rejects unsafe types/newlines, and migration never moves secrets',()=>{
 const c=validateConfig({engines:{yuanbao:{secretId:' id ',secretKey:' secret ',key:'old'}}});assert.equal(c.engines.yuanbao.secretId,'id');assert.equal(c.engines.yuanbao.secretKey,'secret');
 for(const raw of [{engines:{yuanbao:{secretId:123}}},{engines:{yuanbao:{secretKey:'DO_NOT_PRINT\n'}}},{engines:{exa:{secretId:'id'}}}])assert.throws(()=>validateConfig(raw),e=>e.code==='INVALID_CONFIG'&&!e.message.includes('DO_NOT_PRINT'));
 const raw={engines:{yuanbao:{key:'old-contents-unchanged'},anysearch:{key:'mock-other'}}};const m=addMissingYuanbao(raw);assert.equal(m.config.engines.yuanbao.key,raw.engines.yuanbao.key);assert.equal(m.config.engines.yuanbao.secretId,'');assert.equal(m.config.engines.yuanbao.secretKey,'');assert.deepEqual(m.config.engines.anysearch,raw.engines.anysearch);
});
