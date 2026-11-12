import { SearchError } from '../errors.js';
import { jsonRequest } from '../http.js';
import { mcpCallStateless } from '../mcp.js';
import { mcpPayload, summaryRows } from '../normalize.js';

const searchEndpoint = 'https://api.search.tinyfish.ai/';
const mcpEndpoint = 'https://agent.tinyfish.ai/mcp';

export async function tinyfish(parameters, { key, transport, signal }) {
  const query = parameters.input.trim();
  if (!query || [...query].length > 2_000) {
    throw new SearchError('INVALID_PARAMETER', 'TinyFish requires a query of 1–2000 characters');
  }
  const args = { query, domain_type: parameters.taskType === 'news' ? 'news' : 'web' };
  let payload;
  if (key) {
    const endpoint = new URL(searchEndpoint);
    endpoint.search = new URLSearchParams(args).toString();
    ({ data: payload } = await jsonRequest(endpoint.href, {
      method: 'GET', headers: { 'X-API-Key': key, Accept: 'application/json' }, signal,
    }, transport));
  } else {
    const result = await mcpCallStateless(mcpEndpoint, 'search', args, {
      headers: { 'X-TinyFish-Access-Mode': 'keyless' }, transport, signal,
    });
    payload = mcpPayload(result);
  }

  return summaryRows(payload?.results, ({ title, url, snippet, date }) => ({
    title, url, snippet, publishedDate: date,
  }));
}
