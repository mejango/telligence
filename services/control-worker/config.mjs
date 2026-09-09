export function configFromEnv(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (env.KEEPER_EXECUTION_ENABLED && !['true', 'false'].includes(env.KEEPER_EXECUTION_ENABLED)) throw new Error('KEEPER_EXECUTION_ENABLED must be true or false');
  const executionEnabled = env.KEEPER_EXECUTION_ENABLED === 'true';
  if (executionEnabled && !/^0x[0-9a-fA-F]{64}$/.test(env.KEEPER_PRIVATE_KEY ?? '')) throw new Error('Enabled keeper requires KEEPER_PRIVATE_KEY');
  if (executionEnabled && (!env.BASE_RPC_URL || !env.TELLIGENCE_MANIFEST_PATH)) throw new Error('Enabled keeper requires pinned manifest and Base RPC');
  const port = Number(env.PORT ?? 8082);
  const confirmations = Number(env.KEEPER_CONFIRMATIONS ?? 20);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || !Number.isSafeInteger(confirmations) || confirmations < 20) throw new Error('Invalid worker port or confirmation depth');
  for (const key of ['KEEPER_MAX_GAS', 'KEEPER_MAX_FEE_PER_GAS_WEI']) {
    if (env[key] && !/^[1-9][0-9]{0,17}$/.test(env[key])) throw new Error(`Invalid ${key}`);
  }
  return { databaseUrl: env.DATABASE_URL, rpcUrl: env.BASE_RPC_URL, manifestPath: env.TELLIGENCE_MANIFEST_PATH,
    signerUrl: env.AUTH_SIGNER_URL, signerSecret: env.AUTH_SIGNER_SERVICE_SECRET, executionEnabled,
    keeperPrivateKey: executionEnabled ? env.KEEPER_PRIVATE_KEY : undefined,
    maxGas: BigInt(env.KEEPER_MAX_GAS ?? '3000000'), maxFeePerGas: BigInt(env.KEEPER_MAX_FEE_PER_GAS_WEI ?? '5000000000'),
    port, confirmations };
}
