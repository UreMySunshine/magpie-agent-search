// Explicit manual smoke test: no credentials, no home configuration/cache access.
import {validateConfig} from '../src/config.js';
import {run} from '../src/router.js';
import {preflight} from '../src/http.js';
import {safeError} from '../src/errors.js';
import {writeFile} from 'node:fs/promises';
const checks=[];
for (const engine of ['firecrawl','tavily','keenable'])for(const operation of ['search','fetch']) {
  const p={operation,input:operation==='search'?'example domain IANA':'https://example.com/',engine,taskType:'general',limit:1,maxChars:1000};
  const started=Date.now();
  try {
    if(operation==='fetch')p.input=await preflight(p.input,{signal:AbortSignal.timeout(10000)});
    const r=await run(p,validateConfig({timeoutMs:15000}),{diagnostic:s=>console.error(s)});
    const check={engine,operation,ok:r.ok,elapsedMs:Date.now()-started,attempts:r.attempts,...(r.ok?{sourceCount:r.data.sources.length,sources:r.data.sources,contentChars:r.data.results.reduce((n,x)=>n+x.content.length,0)}:{error:r.error})};
    checks.push(check);console.error(JSON.stringify(check));
  }catch(e){const check={engine,operation,ok:false,stage:'target-preflight',error:safeError(e)};checks.push(check);console.error(JSON.stringify(check));}
}
const report={checkedAt:new Date().toISOString(),credentialMode:'anonymous only; explicit in-memory defaults; no home configuration read',checks};
await writeFile(new URL('../docs/smoke.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
