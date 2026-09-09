import { validatePrices } from './policy.mjs';

const MODELS_URL = 'https://api.venice.ai/api/v1/models?type=text';
const MAX_BYTES = 1024 * 1024;
const LIFETIME_MS = 300000;

/** The operator approves models and ceilings; provider observations cannot expand either. */
export function validateModelPolicy(value) {
  const copy = structuredClone(value);
  if (!copy || Object.keys(copy).some(key => key !== 'models')) throw new Error('Invalid model policy.');
  validatePrices({ ...copy, validUntil: new Date(Date.now() + LIFETIME_MS).toISOString() });
  if (Object.keys(copy.models).length > 128) throw new Error('Model policy is too large.');
  for (const price of Object.values(copy.models)) Object.freeze(price);
  Object.freeze(copy.models);
  return Object.freeze(copy);
}

function microCeiling(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const decimal = String(value);
  if (!/^(0|[1-9]\d{0,3})(?:\.\d{1,9})?$/.test(decimal)) return null;
  const [whole, fraction = ''] = decimal.split('.');
  const nanos = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'));
  return (nanos + 999n) / 1000n;
}

/** No API key, arbitrary URL, paid request, or redirect is used to read model metadata. */
export class ModelCatalog {
  constructor({ policy, fetchImpl = fetch, now = Date.now }) {
    this.policy = validateModelPolicy(policy);
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.snapshot = null;
    this.pending = null;
  }
  current() {
    return this.snapshot && Date.parse(this.snapshot.validUntil) > this.now() ? this.snapshot : null;
  }
  refresh() {
    if (this.pending) return this.pending;
    this.pending = this.load().finally(() => { this.pending = null; });
    return this.pending;
  }
  async load() {
    const signal = AbortSignal.timeout(5000);
    const response = await this.fetchImpl(MODELS_URL, { redirect: 'error', signal, headers: { accept: 'application/json' } });
    if (!response.ok || !response.body) throw new Error('Model catalog is unavailable.');
    // Once a provider supplies a new representation, malformed/changed data cannot
    // keep an older model observation enabled. Network failures simply age it out.
    this.snapshot = null;
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) {
      await response.body.cancel(); throw new Error('Model catalog exceeds its bound.');
    }
    const reader = response.body.getReader();
    const chunks = []; let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_BYTES) throw new Error('Model catalog exceeds its bound.');
        chunks.push(Buffer.from(part.value));
      }
    } catch (error) { void reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!Array.isArray(payload?.data) || payload.data.length > 1000) throw new Error('Invalid model catalog.');
    const byId = new Map();
    for (const model of payload.data) {
      if (!model || typeof model.id !== 'string' || byId.has(model.id)) throw new Error('Ambiguous model identity.');
      byId.set(model.id, model);
    }
    const models = {};
    for (const [id, policy] of Object.entries(this.policy.models)) {
      const model = byId.get(id), spec = model?.model_spec;
      const input = microCeiling(spec?.pricing?.input?.diem), output = microCeiling(spec?.pricing?.output?.diem);
      if (model?.type !== 'text' || spec?.offline !== false || spec?.capabilities?.supportsReasoning !== false || input === null || output === null || input > BigInt(policy.inputMicroUsdPerMillion) || output > BigInt(policy.outputMicroUsdPerMillion) || !Number.isSafeInteger(spec.availableContextTokens) || spec.availableContextTokens < policy.maxContextTokens || !Number.isSafeInteger(spec.maxCompletionTokens) || spec.maxCompletionTokens < policy.maxOutputTokens) continue;
      // Keep charging against the approved upper bound even if current prices fall.
      models[id] = policy;
    }
    if (Object.keys(models).length) this.snapshot = Object.freeze({ validUntil: new Date(this.now() + LIFETIME_MS).toISOString(), models: Object.freeze(models) });
    return this.current();
  }
}

/** Refreshes in the background; every request still checks observation expiry. */
export function startCatalogRefresh(catalog, onError = () => {}) {
  let stopped = false;
  const refresh = () => { if (!stopped) void catalog.refresh().catch(() => onError()); };
  refresh();
  const timer = setInterval(refresh, 60000); timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
