import { verifyServiceCredential } from './crypto.mjs';

/** No public host or redirect may receive the private signer credential. */
export function createSignerClient({ url, secret, fetchImpl = fetch }) {
  const parsed = new URL(url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if ((!local && !parsed.hostname.endsWith('.railway.internal')) || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('Signer URL must identify a Railway private service or loopback origin');
  }
  verifyServiceCredential('', secret);
  async function request(path, body) {
    const response = await fetchImpl(`${parsed.origin}${path}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('Private signer request failed');
    if (Number(response.headers.get('content-length')) > 8192) throw new Error('Invalid private signer response');
    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 8192) throw new Error('Invalid private signer response');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  return {
    async getHeader(project, resource = 3) {
      const projectId = typeof project === 'string' ? project : project.id;
      if (!/^[0-9a-f-]{36}$/i.test(projectId) || ![0, 1, 2, 3].includes(resource)) throw new Error('Invalid signing request');
      const result = await request(`/v1/projects/${projectId}/venice-signature`, { resource });
      if (result.headerName !== 'SIGN-IN-WITH-X' || typeof result.headerValue !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(result.headerValue) || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error('Invalid private signer response');
      return { headerName: result.headerName, headerValue: result.headerValue, expiresAt: result.expiresAt };
    },
    async prepareSigner({ creatorAddress, preparationId }) {
      const result = await request('/v1/prepare-signer', { creatorAddress, preparationId });
      if (result.preparationId !== preparationId || !/^0x[0-9a-fA-F]{40}$/.test(result.inferenceSigner) || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error('Invalid private signer response');
      return { preparationId: result.preparationId, inferenceSigner: result.inferenceSigner, expiresAt: result.expiresAt };
    },
  };
}
