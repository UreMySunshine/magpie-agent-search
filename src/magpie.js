import { homedir } from 'node:os';
import { join } from 'node:path';
import { createStateStore, executeRequest } from './execute.js';
import { safeError } from './errors.js';
import { createTools } from './magpie-tools.js';
import { maxInputLength, requestParameters } from './parameters.js';
import { maxResultCount } from './result-count.js';

function createSearch(execute) {
  return {
    name: 'Agent Search',
    keyOptional: true,
    async execute({ query, count = 6 }, { abort: signal } = {}) {
      if (typeof query !== 'string' || !query.trim() || query.length > maxInputLength ||
          !Number.isInteger(count) || count < 1) {
        throw new Error('Agent Search: invalid query or result count');
      }

      let result;
      try {
        const request = requestParameters({ operation: 'search', input: query, limit: Math.min(count, maxResultCount) });
        result = await execute(request, signal);
      } catch (error) {
        if (signal?.aborted) throw new Error('Agent Search: search cancelled');
        throw new Error(`Agent Search: ${safeError(error).code}`);
      }

      if (!result.ok) {
        const attempts = result.attempts.map(({ engine, error }) => `${engine}/${error.code}`);
        const details = [result.error.code, ...attempts].join(', ');
        throw new Error(`Agent Search: ${details}`);
      }

      return result.data.results.map(({ title, url, content }) => ({ title, url, text: content }));
    },
  };
}

export function createMagpieHooks({
  config,
  statePath = join(homedir(), '.cache', 'agent-search', 'magpie-state.json'),
  transport,
} = {}) {
  const stateStore = createStateStore(statePath);
  const execute = (parameters, signal) => executeRequest({ ...parameters, config }, { stateStore, signal, transport });
  return {
    search: { auto: createSearch(execute) },
    tool: createTools(execute),
  };
}
