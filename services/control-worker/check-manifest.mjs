import { readFile } from 'node:fs/promises';
import { BaseChain } from './chain.mjs';
import { safeErrorCode } from './errors.mjs';

try {
  if (!process.env.TELLIGENCE_MANIFEST_PATH || !process.env.BASE_RPC_URL) throw new Error('Manifest and RPC required');
  const manifest = JSON.parse(await readFile(process.env.TELLIGENCE_MANIFEST_PATH, 'utf8'));
  const chain = new BaseChain({ manifest, rpcUrl: process.env.BASE_RPC_URL });
  const block = await chain.client.getBlock({ blockTag: 'latest' });
  await chain.verifyPins(block.number);
  process.stdout.write(`${JSON.stringify({ chainId: 8453, blockNumber: block.number.toString(), blockHash: block.hash, runtimePinsVerified: manifest.runtimePins.length })}\n`);
} catch (error) { process.stderr.write(`Manifest verification failed: ${safeErrorCode(error)}\n`); process.exitCode = 1; }
