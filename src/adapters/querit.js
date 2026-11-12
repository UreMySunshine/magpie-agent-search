import { SearchError } from '../errors.js';
import { jsonRequest } from '../http.js';
import { summaryRows } from '../normalize.js';

export async function querit(parameters, { key, transport, signal }) {
  if (!key) throw new SearchError('REQUIRES_KEY', 'Querit requires an API key');
  const { data } = await jsonRequest('https://api.querit.ai/v1/search', {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: { query: parameters.input.trim(), count: parameters.limit }, signal,
  }, transport);
  if (data?.error_code !== undefined && data.error_code !== 200 && data.error_code !== '200') {
    throw new SearchError('PROVIDER_ERROR', 'Querit reported a search error');
  }

  return summaryRows(data?.results?.result, ({ title, url, snippet, sentence }) => ({
    title, url, snippet: typeof snippet === 'string' && snippet.trim() ? snippet :
      Array.isArray(sentence) ? sentence.filter((part) => typeof part === 'string').join(' ') : '',
  }));
}
