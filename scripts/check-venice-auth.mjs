// Read-only discovery. No keys, signatures, payment headers, or paid inference.
const endpoint = 'https://api.venice.ai/api/v1/chat/completions'
const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'test' }] }),
  signal: AbortSignal.timeout(15000),
})
if (response.status !== 402) throw new Error(`Expected unauthenticated 402; got ${response.status}`)
const body = await response.json()
const challenge = body.extensions?.['sign-in-with-x'] ?? body.siwxChallenge
if (!challenge) throw new Error('No SIWX challenge found')
if (challenge.info?.domain !== 'api.venice.ai') throw new Error('Unexpected authentication domain')
if (challenge.info?.uri !== endpoint) throw new Error('Unexpected authentication URI')
const supported = challenge.supportedChains?.some(x => x.chainId === 'eip155:8453' && x.type === 'eip1271')
if (!supported) throw new Error('Base EIP-1271 is not advertised')
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  endpoint,
  status: response.status,
  baseContractWalletAuthAdvertised: supported,
  canonicalHeader: body.authOptions?.x402Wallet?.header ?? null,
  scope: 'Capability discovery only; funded DIEM activation is not tested.',
}, null, 2))
