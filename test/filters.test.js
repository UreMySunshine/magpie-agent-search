import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parse} from '../scripts/request.js';
import {domains,dateBoundary,applyFilters} from '../src/filters.js';
import {candidates,run} from '../src/router.js';
import {validateConfig} from '../src/config.js';
import {exa} from '../src/adapters/exa.js';
import {tavily} from '../src/adapters/tavily.js';
const p=parse(['search','public query','--after','2024-02-29','--before','2024-03-02','--include-domains','example.com','--exclude-domains','ads.example.com']);
for(const d of ['2023-02-29','2024-02-30','2024-13-01','2024-01-00','2024-01-01T00:00:00Z','2024-1-01'])test('reject invalid UTC date '+d,()=>assert.throws(()=>dateBoundary(d),{code:'USAGE'}));
test('date ranges and operation options validated',()=>{assert.equal(dateBoundary('2024-02-29'),'2024-02-29');assert.throws(()=>parse(['search','q','--after','2024-01-01','--before','2024-01-01']));assert.throws(()=>parse(['fetch','https://example.com','--include-domains','example.com']));});
for(const d of ['example.com/path','https://example.com','example.com:80','*.example.com','127.0.0.1','example.com@evil.org','foo.local','example.com,','-a.com','a..com'])test('reject invalid domain '+d,()=>assert.throws(()=>domains(d),{code:'USAGE'}));
test('domains normalized and IDNA supported',()=>{assert.deepEqual(domains(' EXAMPLE.COM,example.com '),['example.com']);assert.equal(domains('例子.测试')[0],'xn--fsqu00a.xn--0zwm56d');});
test('strict local date, subdomain boundary, exclusions, spoofed URL and unknown dates',()=>{
 const item=(url,publishedDate='2024-03-01T23:59:59Z')=>({url,publishedDate,title:'x',content:'x'});
 const data={results:[item('https://example.com/a','2024-02-29T00:00:00Z'),item('https://docs.example.com/a'),item('https://ads.example.com/a'),item('https://example.com.evil.org'),item('https://example.com@evil.org'),item('https://example.com/old','2024-02-28T23:59:59Z'),item('https://example.com/end','2024-03-02T00:00:00Z'),item('https://example.com/unknown',''),item('https://example.com/offset','2024-03-02T00:30:00+01:00')],content:'unfiltered unknown raw text'};
 const d=applyFilters(data,p,'tavily');assert.equal(d.results.length,3);assert.equal(d.content,'');assert.equal(d.filters.removed,6);
});
test('date routing excludes unsupported modes before any network; key changes Exa capability',async()=>{
 const c=validateConfig();assert.deepEqual(candidates(p,c,{}).eligible,['tavily']);c.engines.exa.key='mock';assert.deepEqual(candidates(p,c,{}).eligible,['tavily','exa']);
 let calls=0;const r=await run({...p,engine:'parallel'},c,{implementations:{parallel:()=>{calls++;}}});assert.equal(calls,0);assert.equal(r.error.code,'UNSUPPORTED_DATE_FILTER');
});
for(const key of ['','mock'])test('Tavily date/domain fields and dates normalized '+Boolean(key),async()=>{
 const d=await tavily(p,{key,transport:async(_url,o)=>{assert.equal(o.body.start_date,'2024-02-29');assert.equal(o.body.filter_by_published_date,true);assert.equal(o.body.include_domains_mode,'restrict');assert.deepEqual(o.body.exclude_domains,['ads.example.com']);return {status:200,headers:{},text:JSON.stringify({results:[{url:'https://example.com',published_date:'Fri, 01 Mar 2024 12:00:00 GMT'}]})};}});assert.ok(d.results[0].publishedDate);
});
test('Exa REST fields differ from MCP and retain publishedDate',async()=>{
 const d=await exa(p,{key:'mock',transport:async(_url,o)=>{assert.equal(o.body.startPublishedDate,'2024-02-29T00:00:00.000Z');assert.deepEqual(o.body.includeDomains,['example.com']);return {status:200,headers:{},text:JSON.stringify({results:[{url:'https://example.com',publishedDate:'2024-03-01'}]})};}});assert.equal(d.results[0].publishedDate,'2024-03-01');
});
test('local-only domain filters preserve routing and do not refill empty output',async()=>{
 const q=parse(['search','q','--include-domains','example.com']);const c=validateConfig();assert.deepEqual(candidates(q,c,{}).eligible,candidates({...q,filters:undefined},c,{}).eligible);let calls=0;
 const r=await run(q,c,{implementations:{tavily:async()=>{calls++;return {results:[{url:'https://evil.org',title:'x',content:'x'}],content:''};}}});assert.equal(calls,1);assert.equal(r.ok,true);assert.deepEqual(r.data.results,[]);assert.equal(r.data.filters.removed,1);
});

test('trailing-dot URL cannot bypass excluded domain; empty date is invalid',()=>{
 const q=parse(['search','q','--exclude-domains','example.com']);
 assert.deepEqual(applyFilters({results:[{url:'https://example.com./x'}],content:''},q,'anysearch').results,[]);
 assert.throws(()=>parse(['search','q','--after','']),{code:'USAGE'});
});

test('anonymous Exa reports local-only domain filtering; keyed REST reports server mapping',()=>{
 const q=parse(['search','q','--include-domains','example.com']);
 const data={results:[],content:''};
 assert.equal(applyFilters(data,q,'exa').filters.domainMode,'local-recalled-results-only');
 assert.equal(applyFilters(data,q,'exa',{key:'mock'}).filters.domainMode,'server-and-local');
});
