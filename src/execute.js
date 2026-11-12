import { defaultStatePath, loadConfig, readState, saveState } from './config.js';
import { candidates, run } from './router.js';
import { preflight } from './http.js';

export function createStateStore(path = defaultStatePath()) {
  let loaded;
  let pendingSave = Promise.resolve();
  return {
    read() {
      loaded ??= readState(path);
      return loaded;
    },
    save(state) {
      const saved = pendingSave.then(() => saveState(path, state));
      pendingSave = saved.catch(() => {});
      return saved;
    },
  };
}

export async function executeRequest(parameters, {
  stateStore = createStateStore(parameters.state),
  signal,
  diagnostic,
  transport,
} = {}) {
  signal?.throwIfAborted();
  const config = await loadConfig(parameters.config, Boolean(parameters.config));
  const state = await stateStore.read();
  signal?.throwIfAborted();

  const now = Date.now();
  for (const [key, value] of Object.entries(state)) {
    if (key !== '__parallelSessionId' && (!Number.isFinite(value) || value <= now)) {
      delete state[key];
    }
  }

  let request = parameters;
  if (request.operation === 'fetch' && candidates(request, config, state).eligible.length) {
    const timeout = AbortSignal.timeout(config.timeoutMs);
    const input = await preflight(request.input, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      transport,
    });
    request = { ...request, input };
  }

  let result;
  try {
    result = await run(request, config, { state, signal, diagnostic, transport });
    return result;
  } finally {
    try {
      await stateStore.save(state);
    } catch {
      result?.warnings.push('Could not persist cooldown state');
    }
  }
}
