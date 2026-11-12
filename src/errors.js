export class SearchError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}
export function safeError(e) {
  // Never print upstream bodies, request URLs, stack traces, or arbitrary transport messages.
  const known = e instanceof SearchError;
  return { code: known ? e.code : 'NETWORK_ERROR', message: known ? e.message : 'Network or transport failure',
    ...(!known && ['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ENETUNREACH','ETIMEDOUT','EPERM','EACCES'].includes(e?.code) ? {transportCode:e.code} : {}),
    ...(known && e.providerCode ? {providerCode:e.providerCode} : {}),
    ...(known && e.requestId ? {requestId:e.requestId} : {}),
    ...(e?.status ? {status: e.status} : {}), ...(e?.retryAt ? {retryAt: e.retryAt} : {}) };
}

export function requestFailure(error, { operation = null, taskType = null } = {}) {
  return {
    schemaVersion: 1, ok: false, operation, taskType, engine: null, authMode: null,
    attempts: [], skipped: [], warnings: [], error: safeError(error),
  };
}
export function retryAt(value, now = Date.now()) {
  if (!value) return now + 60_000;
  const n = Number(value);
  const at = Number.isFinite(n) ? now + Math.max(0, n) * 1000 : Date.parse(value);
  return Number.isFinite(at) ? Math.max(now, at) : now + 60_000;
}
