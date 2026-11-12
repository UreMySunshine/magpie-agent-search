import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AgentSearchPlugin } from '../index.js';
import { names } from '../src/config.js';
import { createMagpieHooks } from '../src/magpie.js';

const tavily = 'https://api.tavily.com/search';
const exa = 'https://api.exa.ai/search';
const page = { title: 'Example Domain', url: 'https://example.com/', content: 'Example text' };
const pages = [{ title: page.title, url: page.url, text: page.content }];

function response(status, body, headers = {}) {
  return { status, headers, text: JSON.stringify(body) };
}

async function fixture(t, transport, settings = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'magpie-agent-search-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = join(directory, 'config.json');
  const statePath = join(directory, 'state.json');
  const engines = Object.fromEntries(names.map((name) => [name, { enabled: false }]));
  engines.tavily = { enabled: true, priority: 1 };
  engines.exa = { enabled: true, priority: 2, key: 'mock-exa-key' };
  await writeFile(config, JSON.stringify({ engines, ...settings }));
  const create = () => createMagpieHooks({ config, statePath, transport });
  const { search, tool } = create();
  return { create, search: search.auto, tool, statePath };
}

test('plugin registers one key-optional search source and two typed tools', async () => {
  const plugin = await AgentSearchPlugin();
  assert.deepEqual(Object.keys(plugin.search), ['auto']);
  assert.equal(plugin.search.auto.keyOptional, true);
  assert.deepEqual(Object.keys(plugin.tool), ['agent_web_search', 'agent_web_fetch']);
  assert.deepEqual(plugin.tool.agent_web_search.args.required, ['query']);
  assert.deepEqual(plugin.tool.agent_web_fetch.args.required, ['url']);
});

test('native search passes twenty to an engine that supports the full host range', async (t) => {
  const { search } = await fixture(t, async (url, { body, headers }) => {
    assert.equal(url, tavily);
    assert.equal(body.query, 'example domains');
    assert.equal(body.max_results, 20);
    assert.equal(headers['X-Tavily-Access-Mode'], 'keyless');
    return response(200, { results: Array(22).fill(page) });
  });
  assert.deepEqual(await search.execute({ query: 'example domains', count: 20 }), Array(20).fill(pages[0]));
});

test('rate limit falls back and cooldown is shared by both search entries and persists', async (t) => {
  const called = [];
  const { search, tool, create } = await fixture(t, async (url, { headers }) => {
    called.push(url);
    if (url === tavily) return response(429, {}, { 'retry-after': '60' });
    assert.equal(headers['x-api-key'], 'mock-exa-key');
    return response(200, { results: [page] });
  });
  const args = { query: 'example domains' };
  assert.deepEqual(await search.execute(args), pages);
  const result = await tool.agent_web_search.execute(args);
  assert.equal(result.engine, 'exa');
  assert.ok(result.skipped.some(({ engine, reason }) => engine === 'tavily' && reason === 'COOLDOWN'));
  assert.deepEqual(await create().search.auto.execute(args), pages);
  assert.deepEqual(called, [tavily, exa, exa, exa]);
});

test('a concurrent success preserves a cooldown set by another search', async (t) => {
  const called = [];
  const firstStarted = Promise.withResolvers();
  const firstResult = Promise.withResolvers();
  const { search, statePath } = await fixture(t, async (url) => {
    called.push(url);
    if (called.length === 1) {
      firstStarted.resolve();
      return firstResult.promise;
    }
    if (url === tavily) return response(429, {}, { 'retry-after': '60' });
    return response(200, { results: [page] });
  });
  const args = { query: 'example domains' };
  const first = search.execute(args);
  await firstStarted.promise;
  try {
    assert.deepEqual(await search.execute(args), pages);
  } finally {
    firstResult.resolve(response(200, { results: [page] }));
    await first;
  }
  assert.deepEqual(await search.execute(args), pages);
  assert.deepEqual(called, [tavily, tavily, exa, exa]);
  assert.ok(JSON.parse(await readFile(statePath, 'utf8'))['tavily:anonymous'] > Date.now());
});

test('host cancellation aborts the active request without falling back or setting a cooldown', async (t) => {
  const controller = new AbortController();
  const called = [];
  const { search, statePath } = await fixture(t, async (url, { signal }) => {
    called.push(url);
    controller.abort();
    signal.throwIfAborted();
  });
  const args = { query: 'example domains' };
  await assert.rejects(search.execute(args, { abort: controller.signal }), /search cancelled/);
  assert.deepEqual(called, [tavily]);
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), {});
  await assert.rejects(search.execute(args, { abort: controller.signal }), /search cancelled/);
  assert.deepEqual(called, [tavily]);
});

test('search-source failures contain only safe diagnostic codes', async (t) => {
  const { search } = await fixture(t, async () => response(402, { key: 'provider-generated-secret' }));
  await assert.rejects(search.execute({ query: 'private query' }), {
    message: 'Agent Search: ALL_ATTEMPTS_FAILED, tavily/QUOTA_EXHAUSTED, exa/QUOTA_EXHAUSTED',
  });
});

test('explicit search forwards task and filters and returns the actual source and attempts', async (t) => {
  const { tool } = await fixture(t, async (url, { body }) => {
    assert.equal(url, tavily);
    assert.equal(body.topic, 'news');
    assert.equal(body.start_date, '2024-02-29');
    assert.equal(body.end_date, '2024-03-02');
    assert.deepEqual(body.include_domains, ['example.com']);
    assert.deepEqual(body.exclude_domains, ['ads.example.com']);
    return response(200, { results: [
      { ...page, url: 'https://docs.example.com/', published_date: '2024-02-29T00:00:00Z' },
      { ...page, url: 'https://ads.example.com/', published_date: '2024-03-01' },
      { ...page, url: 'https://example.com/end', published_date: '2024-03-02T00:00:00Z' },
      { ...page, url: 'https://example.com/unknown' },
    ] });
  });
  const result = await tool.agent_web_search.execute({
    query: 'example news', task_type: 'news', engine: 'tavily', after: '2024-02-29',
    before: '2024-03-02', include_domains: ['EXAMPLE.COM'], exclude_domains: ['ads.example.com'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.engine, 'tavily');
  assert.equal(result.routing.selection, 'explicit-engine');
  assert.deepEqual(result.attempts.map(({ engine }) => engine), ['tavily']);
  assert.deepEqual(result.data.sources, ['https://docs.example.com/']);
  assert.equal(result.data.filters.removed, 3);
  assert.equal(result.data.filters.dateMode, 'server-and-local-strict');
});

test('invalid tool arguments and unsupported requests make no network calls', async (t) => {
  let calls = 0;
  const { tool } = await fixture(t, async () => { calls++; });
  for (const args of [
    { query: '' }, { query: 'example', count: '3' }, { query: 'example', count: 21 }, { query: 'example', after: ['2024-02-29'] },
    { query: 'example', include_domains: 'example.com' }, { query: 'example', include_domains: ['a.com,b.com'] },
    { query: 'example', config: '/example-config' },
  ]) {
    assert.equal((await tool.agent_web_search.execute(args)).error.code, 'USAGE');
  }
  assert.equal((await tool.agent_web_fetch.execute({ url: 'http://127.0.0.1/' })).error.code, 'UNSAFE_URL');
  assert.equal((await tool.agent_web_fetch.execute({ url: page.url, max_chars: 99 })).error.code, 'USAGE');
  assert.equal(calls, 0);
});

test('explicit fetch falls back to static page text, preserves the final URL and reports truncation', async (t) => {
  const calls = [];
  const { tool } = await fixture(t, async (url, { method = 'POST' }) => {
    calls.push([method, url]);
    if (method === 'HEAD') return response(405, {});
    if (method === 'POST') return response(503, {});
    if (url === page.url) return response(302, {}, { location: '/final' });
    return { status: 200, headers: { 'content-type': 'text/html' }, text: `<p>${'Page text '.repeat(40)}</p>` };
  });
  const result = await tool.agent_web_fetch.execute({ url: page.url, max_chars: 100 });
  assert.equal(result.ok, true);
  assert.equal(result.engine, 'direct-http');
  assert.equal(result.data.contentKind, 'page-text');
  assert.equal(result.data.results[0].content.length, 100);
  assert.equal(result.data.truncated, true);
  assert.deepEqual(result.data.sources, ['https://example.com/final']);
  assert.deepEqual(calls, [
    ['HEAD', page.url], ['POST', 'https://api.tavily.com/extract'], ['POST', 'https://api.exa.ai/contents'],
    ['GET', page.url], ['GET', 'https://example.com/final'],
  ]);
});

test('explicit fetch respects cancellation during URL preflight', async (t) => {
  const controller = new AbortController();
  const methods = [];
  const { tool } = await fixture(t, async (_url, { method, signal }) => {
    methods.push(method);
    controller.abort();
    signal.throwIfAborted();
  });
  const result = await tool.agent_web_fetch.execute({ url: page.url }, { abort: controller.signal });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CANCELLED');
  assert.deepEqual(methods, ['HEAD']);
});

test('explicit fetch reuses the Parallel session from native search', async (t) => {
  const calls = [];
  const engines = Object.fromEntries(names.map((name) => [name, { enabled: name === 'parallel' }]));
  const { search, tool } = await fixture(t, async (_url, { body, method }) => {
    if (method === 'HEAD') return response(200, {});
    if (body.method === 'notifications/initialized') return response(202, {});
    let result = { protocolVersion: '2025-03-26' };
    if (body.method === 'tools/call') {
      calls.push(body.params);
      result = { content: [], structuredContent: { session_id: 'shared-fixture-session', results: [{ ...page, full_content: page.content }] } };
    }
    return response(200, { jsonrpc: '2.0', id: body.id, result });
  }, { engines });
  assert.deepEqual(await search.execute({ query: 'example' }), pages);
  const result = await tool.agent_web_fetch.execute({ url: page.url });
  assert.equal(result.ok, true);
  assert.equal(result.engine, 'parallel');
  assert.deepEqual(calls.map(({ name, arguments: { session_id } }) => [name, session_id]), [
    ['web_search', undefined], ['web_fetch', 'shared-fixture-session'],
  ]);
});
