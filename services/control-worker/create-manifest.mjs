import { createHash } from 'node:crypto';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, getAddress, http, keccak256, parseAbi, zeroAddress } from 'viem';
import { base } from 'viem/chains';
import { validateManifest, VVV, STAKING, DIEM } from './chain.mjs';
import { factoryAbi, factoryPolicyVersion } from '../contracts.mjs';

const IMPLEMENTATION = '0xe37A7920dbc11253ac6d031C29f592f71B348DCA';
const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const hashShape = value => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
const same = (left, right) => typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
const digest = text => createHash('sha256').update(text).digest('hex');
const gettersAbi = parseAbi([
  'function REV_DEPLOYER() view returns(address)', 'function VAULT_DEPLOYER() view returns(address)',
  'function MULTI_TERMINAL() view returns(address)', 'function CONTROLLER() view returns(address)', 'function PROJECTS() view returns(address)',
  'function VVV() view returns(address)', 'function STAKING() view returns(address)', 'function DIEM() view returns(address)',
  'function venice() view returns(address)', 'function diem() view returns(address)', 'function owner() view returns(address)',
  'function decimals() view returns(uint8)',
]);
const policyFields = { conversionCadence: 48, minBatchTokens: 128, maxBatchTokens: 128, minVVVPerProjectToken: 128,
  minDiemPerVVV: 128, maxPrincipal: 128, initialIssuance: 112 };

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function address(value, code = 'INVALID_ADDRESS') {
  try { const parsed = getAddress(value); if (same(parsed, zeroAddress)) fail(code); return parsed; }
  catch { fail(code); }
}
function policyFor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_POLICY');
  const policy = {};
  for (const [key, bits] of Object.entries(policyFields)) {
    if (typeof value[key] !== 'string' || !/^[1-9][0-9]{0,40}$/.test(value[key]) || BigInt(value[key]) >= 2n ** BigInt(bits)) fail('INVALID_POLICY');
    policy[key] = value[key];
  }
  if (BigInt(policy.conversionCadence) < 3600n || BigInt(policy.conversionCadence) > 2592000n
    || BigInt(policy.minBatchTokens) > BigInt(policy.maxBatchTokens)) fail('INVALID_POLICY');
  return policy;
}

/** Compare actual deployed runtime with the reviewed build, masking only compiler-reported immutable words. */
function matchArtifact(raw, runtime, contractName) {
  let artifact;
  try { artifact = JSON.parse(raw); } catch { fail('INVALID_ARTIFACT_JSON'); }
  const metadata = artifact.metadata;
  const bytecode = artifact.deployedBytecode;
  if (!metadata || metadata.language !== 'Solidity' || metadata.compiler?.version !== '0.8.28+commit.7893614a'
    || metadata.settings?.compilationTarget?.[`src/${contractName}.sol`] !== contractName
    || Object.keys(metadata.settings.compilationTarget).length !== 1
    || !/^0x(?:[0-9a-fA-F]{2})+$/.test(bytecode?.object ?? '')
    || Object.keys(bytecode.linkReferences ?? {}).length !== 0) fail('INVALID_ARTIFACT');
  const expected = Buffer.from(bytecode.object.slice(2), 'hex');
  const observed = Buffer.from(runtime.slice(2), 'hex');
  if (expected.length !== observed.length) fail('ARTIFACT_RUNTIME_MISMATCH');
  const refs = bytecode.immutableReferences ?? {};
  if (!refs || typeof refs !== 'object' || Array.isArray(refs)) fail('INVALID_ARTIFACT_IMMUTABLES');
  const ranges = Object.values(refs).flat();
  for (const range of ranges) {
    if (!range || !Number.isSafeInteger(range.start) || range.start < 0 || range.length !== 32
      || range.start + range.length > expected.length) fail('INVALID_ARTIFACT_IMMUTABLES');
  }
  ranges.sort((left, right) => left.start - right.start);
  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index];
    if (index && ranges[index - 1].start + ranges[index - 1].length > range.start) fail('INVALID_ARTIFACT_IMMUTABLES');
    expected.fill(0, range.start, range.start + range.length);
    observed.fill(0, range.start, range.start + range.length);
  }
  if (!expected.equals(observed)) fail('ARTIFACT_RUNTIME_MISMATCH');
  const sourceKeccak256 = {};
  for (const [path, source] of Object.entries(metadata.sources ?? {})) {
    if (!hashShape(source.keccak256)) fail('INVALID_ARTIFACT_SOURCE');
    sourceKeccak256[path] = source.keccak256;
  }
  if (!Object.keys(sourceKeccak256).length) fail('INVALID_ARTIFACT_SOURCE');
  return { method: 'artifact-runtime-match-masking-immutables', contractName, artifactSha256: digest(raw),
    compiler: metadata.compiler, settings: metadata.settings, sourceKeccak256,
    maskedImmutableWords: ranges.length, normalizedRuntimeHash: keccak256(`0x${expected.toString('hex')}`) };
}

/** Read only. The client never receives transaction, simulation, signing, or wallet requests. */
export async function buildDeploymentManifest({ client, factoryAddress, expectedRevnetDeployer, launchPolicy,
  factoryArtifactText, vaultDeployerArtifactText }) {
  const factory = address(factoryAddress);
  const reviewedRevnet = address(expectedRevnetDeployer);
  const reviewedPolicy = policyFor(launchPolicy);
  if (await client.getChainId() !== 8453) fail('WRONG_CHAIN');
  const block = await client.getBlock({ blockTag: 'safe' });
  if (typeof block?.number !== 'bigint' || block.number <= 0n || !hashShape(block.hash)
    || typeof block.timestamp !== 'bigint' || block.timestamp <= 0n) fail('INVALID_SAFE_BLOCK');
  const blockNumber = block.number;
  const read = (target, functionName) => client.readContract({ address: target, abi: gettersAbi, functionName, blockNumber });
  const [revnetValue, adapterValue, rawPolicyVersion] = await Promise.all(['REV_DEPLOYER', 'VAULT_DEPLOYER', 'POLICY_VERSION'].map(functionName => client.readContract({ address: factory, abi: factoryAbi, functionName, blockNumber })));
  const policyVersion = factoryPolicyVersion(rawPolicyVersion);
  const revnet = address(revnetValue, 'INVALID_REVNET_DEPLOYER');
  if (!same(revnet, reviewedRevnet)) fail('REVNET_DEPLOYER_MISMATCH');
  const adapter = address(adapterValue);
  const [terminalValue, controllerValue, projectsValue, vvvValue, stakingValue, diemValue] = await Promise.all([
    read(revnet, 'MULTI_TERMINAL'), read(revnet, 'CONTROLLER'), read(revnet, 'PROJECTS'),
    read(adapter, 'VVV'), read(adapter, 'STAKING'), read(adapter, 'DIEM'),
  ]);
  if (!same(vvvValue, VVV) || !same(stakingValue, STAKING) || !same(diemValue, DIEM)) fail('PROVIDER_IDENTITY_MISMATCH');
  const terminal = address(terminalValue); const controller = address(controllerValue); const projects = address(projectsValue);
  const [underlying, mintedAsset, vvvDecimals, stakingDecimals, diemDecimals, stakingOwner] = await Promise.all([
    read(STAKING, 'venice'), read(STAKING, 'diem'), read(VVV, 'decimals'), read(STAKING, 'decimals'), read(DIEM, 'decimals'), read(STAKING, 'owner'),
  ]);
  if (!same(underlying, VVV) || !same(mintedAsset, DIEM) || [vvvDecimals, stakingDecimals, diemDecimals].some(value => value !== 18)) fail('PROVIDER_CONTEXT_MISMATCH');
  let observedOwner;
  try { observedOwner = getAddress(stakingOwner); } catch { fail('INVALID_ADMINISTRATOR'); }
  const components = new Map();
  for (const [role, value] of Object.entries({ factory, revnetDeployer: revnet, vaultDeployer: adapter, terminal, controller,
    projects, vvv: VVV, staking: STAKING, diem: DIEM })) {
    const key = value.toLowerCase();
    if (components.has(key)) components.get(key).roles.push(role);
    else components.set(key, { address: getAddress(value), roles: [role] });
  }
  const codeAt = async value => {
    const code = await client.getCode({ address: value, blockNumber });
    if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(code ?? '')) fail('MISSING_RUNTIME_CODE');
    return code;
  };
  const runtimes = new Map();
  const runtimePins = await Promise.all([...components.values()].map(async component => {
    const [code, storage] = await Promise.all([codeAt(component.address), client.getStorageAt({ address: component.address, slot: IMPLEMENTATION_SLOT, blockNumber })]);
    runtimes.set(component.address.toLowerCase(), code);
    if (!hashShape(storage)) fail('INVALID_IMPLEMENTATION_SLOT');
    const pin = { ...component, runtimeHash: keccak256(code) };
    const implementationAddress = `0x${storage.slice(-40)}`;
    if (same(component.address, STAKING) && !same(implementationAddress, IMPLEMENTATION)) fail('STAKING_IMPLEMENTATION_MISMATCH');
    if (!same(implementationAddress, zeroAddress)) {
      if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(storage)) fail('INVALID_IMPLEMENTATION_SLOT');
      const implementation = address(implementationAddress, 'INVALID_IMPLEMENTATION');
      const implementationCode = await codeAt(implementation);
      pin.implementation = { address: implementation, runtimeHash: keccak256(implementationCode), slot: IMPLEMENTATION_SLOT };
    }
    return pin;
  }));
  const verification = {
    factory: matchArtifact(factoryArtifactText, runtimes.get(factory.toLowerCase()), 'TelligenceFactory'),
    vaultDeployer: matchArtifact(vaultDeployerArtifactText, runtimes.get(adapter.toLowerCase()), 'TelligenceComputeVaultDeployer'),
    upstream: { method: 'explicit-revnet-address-and-runtime-observation', expectedRevnetDeployer: reviewedRevnet,
      reviewedStakingImplementation: IMPLEMENTATION },
  };
  const after = await client.getBlock({ blockNumber });
  if (after.number !== blockNumber || !same(after.hash, block.hash) || after.timestamp !== block.timestamp) fail('BLOCK_CHANGED');
  const manifest = { chainId: 8453, policyVersion, factoryAddress: factory, factoryRuntimeHash: keccak256(runtimes.get(factory.toLowerCase())),
    revnetDeployerAddress: revnet, vaultDeployerAddress: adapter, canonicalTerminal: terminal, controllerAddress: controller,
    projectsAddress: projects, vvvAddress: VVV, stakingAddress: STAKING, diemAddress: DIEM, runtimePins,
    launchPolicy: reviewedPolicy, observedAt: { blockTag: 'safe', blockNumber: blockNumber.toString(), blockHash: block.hash,
      blockTimestamp: block.timestamp.toString() }, administrators: { stakingOwner: observedOwner }, verification };
  return validateManifest(manifest);
}

export function parseManifestArguments(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const names = { '--factory': 'factory', '--revnet-deployer': 'revnetDeployer', '--launch-policy': 'launchPolicy', '--output': 'output', '--artifacts': 'artifacts' };
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = names[argv[index]]; const value = argv[index + 1];
    if (!key || Object.hasOwn(options, key) || typeof value !== 'string' || !value.trim() || value.startsWith('--')) fail('INVALID_ARGUMENTS');
    options[key] = value;
  }
  if (['factory', 'revnetDeployer', 'launchPolicy', 'output'].some(key => !options[key])) fail('MISSING_ARGUMENTS');
  address(options.factory, 'INVALID_ARGUMENT_ADDRESS'); address(options.revnetDeployer, 'INVALID_ARGUMENT_ADDRESS');
  return options;
}

/** A completed release is never truncated or replaced, even when two generators race. */
export async function writeManifestExclusive(path, manifest) {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

async function readBounded(path, maximum) {
  if ((await stat(path)).size > maximum) fail('INPUT_FILE_TOO_LARGE');
  return readFile(path, 'utf8');
}
async function main() {
  const options = parseManifestArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: BASE_RPC_URL=<Base RPC> node services/control-worker/create-manifest.mjs --factory <address> --revnet-deployer <reviewed address> --launch-policy <reviewed JSON file> --output <new manifest file> [--artifacts <contracts/out>]\nRead-only. Requires the built TelligenceFactory and TelligenceComputeVaultDeployer artifacts. Never overwrites output.\n');
    return;
  }
  if (!process.env.BASE_RPC_URL) fail('BASE_RPC_URL_REQUIRED');
  let rpc;
  try { rpc = new URL(process.env.BASE_RPC_URL); } catch { fail('INVALID_BASE_RPC_URL'); }
  if (!['http:', 'https:'].includes(rpc.protocol)) fail('INVALID_BASE_RPC_URL');
  const artifacts = options.artifacts ?? fileURLToPath(new URL('../../contracts/out/', import.meta.url));
  const [policyText, factoryArtifactText, vaultDeployerArtifactText] = await Promise.all([
    readBounded(options.launchPolicy, 65_536),
    readBounded(join(artifacts, 'TelligenceFactory.sol', 'TelligenceFactory.json'), 10_000_000),
    readBounded(join(artifacts, 'TelligenceComputeVaultDeployer.sol', 'TelligenceComputeVaultDeployer.json'), 10_000_000),
  ]);
  let launchPolicy;
  try { launchPolicy = JSON.parse(policyText); } catch { fail('INVALID_POLICY_JSON'); }
  const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL, { timeout: 10_000, retryCount: 0 }) });
  const manifest = await buildDeploymentManifest({ client, factoryAddress: options.factory, expectedRevnetDeployer: options.revnetDeployer,
    launchPolicy, factoryArtifactText, vaultDeployerArtifactText });
  manifest.verification.launchPolicyFileSha256 = digest(policyText);
  await writeManifestExclusive(resolve(options.output), manifest);
  process.stdout.write(`${JSON.stringify({ chainId: 8453, blockNumber: manifest.observedAt.blockNumber, blockHash: manifest.observedAt.blockHash, runtimePins: manifest.runtimePins.length })}\n`);
}
if (process.argv[1] && await realpath(process.argv[1]).catch(() => '') === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) {
    // RPC transport exceptions can contain authenticated URLs; emit only controlled codes.
    const code = typeof error.code === 'string' && /^[A-Z][A-Z_0-9]{0,63}$/.test(error.code) ? error.code : 'MANIFEST_GENERATION_FAILED';
    process.stderr.write(`Manifest generation failed: ${code}\n`); process.exitCode = 1;
  }
}
