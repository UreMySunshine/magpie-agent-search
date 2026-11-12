import assert from 'node:assert/strict';
import test from 'node:test';
import { adapters } from '../src/adapters/index.js';
import { names, validateConfig } from '../src/config.js';
import { candidates, run } from '../src/router.js';
import { parse } from '../scripts/request.js';

const request = { operation: 'search', input: 'IANA example domains', taskType: 'general', limit: 20, maxChars: 20_000 };
const page = (index) => ({ title: `Example ${index}`, url: `https://example.com/${index}`, snippet: 'A result' });
const pages = Array.from({ length: 20 }, (_, index) => page(index));
const reply = (value, status = 200, headers = {}) => ({ status, headers, text: JSON.stringify(value) });

function config(engines) {
  return validateConfig({ engines: Object.fromEntries(names.map((name) => [name, engines[name] ?? { enabled: false }])) });
}

for (const format of ['JSON', 'SSE']) {
  test(`TinyFish anonymous ${format} uses one tool call and applies the user limit locally`, async () => {
    let requests = 0;
    const result = await run({ ...request, taskType: 'news', engine: 'tinyfish' }, config({ tinyfish: { resultLimit: 3 } }), {
      transport: async (url, { method, headers, body, stopWhen }) => {
        requests++;
        assert.equal(url, 'https://agent.tinyfish.ai/mcp');
        assert.equal(method, 'POST');
        assert.equal(headers['X-TinyFish-Access-Mode'], 'keyless');
        assert.equal(headers.Authorization, undefined);
        assert.equal(headers['Mcp-Session-Id'], undefined);
        assert.deepEqual(body.params, { name: 'search', arguments: { query: request.input, domain_type: 'news' } });
        assert.equal(body.method, 'tools/call');
        const payload = { results: [null, { url: 'http://127.0.0.1/' }, ...pages] };
        const result = format === 'JSON' ? { content: [], structuredContent: payload } :
          { content: [{ type: 'text', text: JSON.stringify(payload) }] };
        const response = reply({ jsonrpc: '2.0', id: body.id, result });
        if (format === 'SSE') response.text = `event: message\ndata: ${response.text}\n\n`;
        assert.equal(stopWhen(response.text), true);
        return response;
      },
    });
    assert.equal(requests, 1);
    assert.equal(result.ok, true);
    assert.equal(result.transport, 'anonymous-mcp-http');
    assert.equal(result.data.results.length, 3);
    assert.equal(result.data.results[0].url, page(0).url);
    assert.equal(result.data.partial, true);
    assert.equal(result.data.truncated, true);
  });
}

test('TinyFish keyed search uses only the keyed REST endpoint', async () => {
  let requests = 0;
  const result = await run({ ...request, engine: 'tinyfish' }, config({ tinyfish: { key: 'mock-tinyfish' } }), {
    transport: async (url, { method, headers, body }) => {
      requests++;
      const target = new URL(url);
      assert.equal(target.origin, 'https://api.search.tinyfish.ai');
      assert.equal(target.searchParams.get('query'), request.input);
      assert.equal(target.searchParams.get('domain_type'), 'web');
      assert.equal(target.searchParams.has('count'), false);
      assert.equal(method, 'GET');
      assert.equal(body, undefined);
      assert.equal(headers['X-API-Key'], 'mock-tinyfish');
      return reply({}, 403);
    },
  });
  assert.equal(requests, 1);
  assert.equal(result.attempts[0].error.code, 'AUTH_ERROR');
});

test('Querit requires a configured key and both new engines are skipped for fetch and strict dates', async () => {
  const c = config({ tinyfish: {}, querit: {} });
  assert.deepEqual(candidates(request, c, {}).eligible, ['tinyfish']);
  const transport = async () => assert.fail('an ineligible engine must not be requested');
  const result = await run({ ...request, engine: 'querit' }, c, { transport });
  assert.equal(result.error.code, 'REQUIRES_KEY');
  assert.match(result.error.message, /engines\.querit\.key/);
  for (const engine of ['tinyfish', 'querit']) {
    const fetched = await run({ ...request, engine, operation: 'fetch' }, c, { transport });
    assert.equal(fetched.error.code, 'UNSUPPORTED_OPERATION');
  }
  c.engines.querit.key = 'mock-querit';
  for (const engine of ['tinyfish', 'querit']) {
    const dated = await run({ ...request, engine, filters: { after: '2026-10-01', include: [], exclude: [] } }, c, { transport });
    assert.equal(dated.error.code, 'UNSUPPORTED_DATE_FILTER');
  }
});

test('fallback recomputes the limit from the original count for each engine', async () => {
  const c = config({ anysearch: { priority: 1, resultLimit: 18 }, querit: { priority: 2, resultLimit: 12, key: 'mock-querit' } });
  const attempted = [];
  const result = await run(request, c, { transport: async (url, { headers, body }) => {
    if (url === 'https://api.anysearch.com/v1/search') {
      attempted.push(['anysearch', body.max_results]);
      return reply({}, 429, { 'retry-after': '60' });
    }
    assert.equal(url, 'https://api.querit.ai/v1/search');
    assert.equal(headers.Authorization, 'Bearer mock-querit');
    attempted.push(['querit', body.count]);
    return reply({ error_code: 200, results: { result: [{ ...page(0), snippet: '', sentence: ['Sentence 1', 'Sentence 2'] }, ...pages.slice(1)] } });
  } });
  assert.deepEqual(attempted, [['anysearch', 10], ['querit', 12]]);
  assert.equal(result.ok, true);
  assert.equal(result.engine, 'querit');
  assert.equal(result.data.results.length, 12);
  assert.equal(result.data.results[0].content, 'Sentence 1 Sentence 2');
});

test('Querit sends the requested count when smaller than its configured limit and redacts business errors', async () => {
  const result = await run({ ...request, engine: 'querit', limit: 4 }, config({ querit: { key: 'mock-querit', resultLimit: 12 } }), {
    transport: async (_url, { body }) => {
      assert.equal(body.count, 4);
      return reply({ error_code: 500, error_msg: 'unsafe secret details', search_id: 'private-id' });
    },
  });
  assert.equal(result.attempts[0].error.code, 'PROVIDER_ERROR');
  assert.doesNotMatch(JSON.stringify(result), /unsafe secret details|private-id|mock-querit/);
});

test('count policy trims oversized provider output without refilling', async () => {
  let calls = 0;
  const result = await run({ ...request, engine: 'anysearch' }, config({ anysearch: { resultLimit: 16 } }), {
    transport: async (_url, { body }) => {
      calls++;
      assert.equal(body.max_results, 10);
      return reply({ code: 0, data: { results: pages } });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.data.results.length, 10);
  assert.equal(result.data.truncated, true);
});

test('missing result count caps preserve older config and invalid caps are rejected', () => {
  assert.equal(validateConfig({ engines: { exa: { key: 'old-key', priority: 6 } } }).engines.exa.resultLimit, undefined);
  for (const resultLimit of [0, 21, '12', 1.5, null]) {
    assert.throws(() => validateConfig({ engines: { tinyfish: { resultLimit } } }), { code: 'INVALID_CONFIG' });
  }
  assert.equal(validateConfig({ maxAttempts: 10 }).maxAttempts, 10);
  assert.equal(parse(['search', 'query', '--limit', '20']).limit, 20);
  assert.throws(() => parse(['search', 'query', '--limit', '21']), { code: 'USAGE' });
});

test('a malformed Querit result array is distinct from a successful empty response', async () => {
  const context = (result) => ({ key: 'mock-querit', transport: async () => reply({ results: { result } }) });
  assert.deepEqual((await adapters.querit(request, context([]))).results, []);
  await assert.rejects(adapters.querit(request, context([null, { url: 'file:///private.txt' }])), { code: 'INVALID_RESPONSE' });
});
