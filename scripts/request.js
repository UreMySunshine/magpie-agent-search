#!/usr/bin/env node
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {defaultStatePath} from '../src/config.js';
import {characterLimits,requestParameters} from '../src/parameters.js';
import {executeRequest} from '../src/execute.js';
import {requestFailure,SearchError} from '../src/errors.js';
export function parse(args) {
  if(args.length===0||args.includes('--help'))return {help:true};
  const operation=args.shift();
  if(!['search','fetch'].includes(operation))throw new SearchError('USAGE','Command must be search or fetch');
  const options={};let input;
  while(args.length) {
    const arg=args.shift();
    if(arg.startsWith('--')) {
      if(!['--config','--state','--engine','--task-type','--limit','--max-chars','--after','--before','--include-domains','--exclude-domains'].includes(arg)||arg in options||!args.length)throw new SearchError('USAGE','Unknown, repeated or incomplete option');
      options[arg]=args.shift();
    } else {if(input!==undefined)throw new SearchError('USAGE','Supply one quoted query or URL');input=arg;}
  }
  const request=requestParameters({operation,input,taskType:options['--task-type'],limit:Number(options['--limit']??5),maxChars:Number(options['--max-chars']??characterLimits.default),engine:options['--engine']||undefined,filterOptions:options});
  return {...request,config:options['--config'],state:options['--state']??defaultStatePath()};
}
async function main() {
  let p;
  try {
    p=parse(process.argv.slice(2));
    if(p.help){console.log('node <skill_dir>/scripts/request.js search "query" | fetch "https://example.com"\nOptions: --task-type general|code|news --engine NAME --config PATH --state PATH --limit 1..20 --max-chars 100..50000\nSearch filters: --after YYYY-MM-DD (inclusive UTC) --before YYYY-MM-DD (exclusive UTC) --include-domains a.com,b.com --exclude-domains c.com\nNode >=22. stdout: JSON results; stderr: diagnostics. See README.md for configuration and capability limits.');return;}
    const result=await executeRequest(p,{diagnostic:s=>console.error(s)});
    console.log(JSON.stringify(result));process.exitCode=result.ok?0:1;
  }catch(e){console.error('agent-search: request failed');console.log(JSON.stringify(requestFailure(e,p)));process.exitCode=2;}
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))await main();
