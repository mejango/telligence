import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keccak256 } from 'viem';
import { buildDeploymentManifest, parseManifestArguments, writeManifestExclusive } from '../create-manifest.mjs';
import { validateManifest, BaseChain, VVV, STAKING, DIEM } from '../chain.mjs';

const FACTORY = `0x${'11'.repeat(20)}`;
const REV = `0x${'22'.repeat(20)}`;
const ADAPTER = `0x${'33'.repeat(20)}`;
const TERMINAL = `0x${'44'.repeat(20)}`;
const CONTROLLER = `0x${'55'.repeat(20)}`;
const PROJECTS = `0x${'66'.repeat(20)}`;
const IMPLEMENTATION = '0xe37A7920dbc11253ac6d031C29f592f71B348DCA';
const OWNER = `0x${'77'.repeat(20)}`;
const BLOCK_HASH = `0x${'ab'.repeat(32)}`;
const ZERO = `0x${'00'.repeat(32)}`;
const SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const POLICY = { conversionCadence: '3600', minBatchTokens: '100', maxBatchTokens: '1000', minVVVPerProjectToken: '1', minDiemPerVVV: '1', maxPrincipal: '1000000', initialIssuance: '1000000000000000000' };
function artifact(name, byte = '60') {
  return {
    deployedBytecode: { object: `0x${byte.repeat(200)}`, immutableReferences: { '1': [{ start: 16, length: 32 }] }, linkReferences: {} },
    metadata: { compiler: {version:'0.8.28+commit.7893614a'}, language:'Solidity', settings: {compilationTarget:{[`src/${name}.sol`]:name}, evmVersion:'cancun', optimizer:{enabled:true,runs:200}}, sources: {[`src/${name}.sol`]:{keccak256:keccak256('0x60')}} },
  };
}
function deployed(artifact) { const bytes = artifact.deployedBytecode.object.slice(2); return `0x${bytes.slice(0,32)}${'ff'.repeat(32)}${bytes.slice(96)}`; }
function fixture() {
  const factoryArtifact = artifact('TelligenceFactory');
  const adapterArtifact = artifact('TelligenceComputeVaultDeployer','61');
  const code = new Map([FACTORY,REV,ADAPTER,TERMINAL,CONTROLLER,PROJECTS,VVV,STAKING,DIEM,IMPLEMENTATION].map(address => [address.toLowerCase(),'0x60016000']));
  code.set(FACTORY.toLowerCase(),deployed(factoryArtifact)); code.set(ADAPTER.toLowerCase(),deployed(adapterArtifact));
  const calls=[];
  const getters = new Map([
    [`${FACTORY}:REV_DEPLOYER`,REV], [`${FACTORY}:VAULT_DEPLOYER`,ADAPTER], [`${FACTORY}:POLICY_VERSION`,2n],
    [`${REV}:MULTI_TERMINAL`,TERMINAL], [`${REV}:CONTROLLER`,CONTROLLER], [`${REV}:PROJECTS`,PROJECTS],
    [`${ADAPTER}:VVV`,VVV], [`${ADAPTER}:STAKING`,STAKING], [`${ADAPTER}:DIEM`,DIEM],
    [`${STAKING}:venice`,VVV], [`${STAKING}:diem`,DIEM], [`${STAKING}:owner`,OWNER],
    ...[VVV,STAKING,DIEM].map(address=>[`${address}:decimals`,18]),
  ].map(([key,value])=>[key.toLowerCase(),value]));
  const client = {
    getChainId: async()=>8453,
    getBlock: async args=>{calls.push(['block',args]); return {number:123n,hash:BLOCK_HASH,timestamp:1_800_000_000n};},
    readContract: async args=>{calls.push(['read',args]);const value=getters.get(`${args.address}:${args.functionName}`.toLowerCase());if(value===undefined)throw new Error(`UNEXPECTED_READ_${args.functionName}`);return value;},
    getCode: async args=>{calls.push(['code',args]);return code.get(args.address.toLowerCase());},
    getStorageAt: async args=>{calls.push(['storage',args]);return args.address.toLowerCase()===STAKING.toLowerCase()?`0x${'00'.repeat(12)}${IMPLEMENTATION.slice(2)}`:ZERO;},
    sendTransaction: async()=>{throw new Error('MUST_NOT_SEND');}, signTransaction: async()=>{throw new Error('MUST_NOT_SIGN');},
  };
  return {client,calls,getters,code,factoryArtifact,adapterArtifact,options:{client,factoryAddress:FACTORY,expectedRevnetDeployer:REV,launchPolicy:POLICY,factoryArtifactText:JSON.stringify(factoryArtifact),vaultDeployerArtifactText:JSON.stringify(adapterArtifact)}};
}

test('builds runtime-compatible pins from exactly one safe Base block and matches immutable-masked artifacts', async()=>{
  const f=fixture(); const manifest=await buildDeploymentManifest(f.options);
  assert.equal(validateManifest(manifest),manifest);
  assert.equal(manifest.policyVersion,'2');
  assert.equal(manifest.revnetDeployerAddress.toLowerCase(),REV.toLowerCase());
  assert.equal(manifest.vaultDeployerAddress.toLowerCase(),ADAPTER.toLowerCase());
  assert.equal(manifest.canonicalTerminal.toLowerCase(),TERMINAL.toLowerCase());
  assert.equal(manifest.controllerAddress.toLowerCase(),CONTROLLER.toLowerCase());
  assert.equal(manifest.observedAt.blockNumber,'123'); assert.equal(manifest.observedAt.blockHash,BLOCK_HASH);
  assert.equal(manifest.observedAt.blockTag,'safe'); assert.equal(manifest.observedAt.blockTimestamp,'1800000000');
  assert.deepEqual(manifest.launchPolicy,POLICY);
  for(const address of [FACTORY,REV,ADAPTER,TERMINAL,CONTROLLER,PROJECTS,VVV,STAKING,DIEM]) assert(manifest.runtimePins.some(pin=>pin.address.toLowerCase()===address.toLowerCase()));
  const pin=manifest.runtimePins.find(pin=>pin.address.toLowerCase()===STAKING.toLowerCase());
  assert.equal(pin.implementation.address.toLowerCase(),IMPLEMENTATION.toLowerCase()); assert.equal(pin.implementation.slot,SLOT);
  assert.equal(manifest.verification.factory.method,'artifact-runtime-match-masking-immutables');
  assert.match(manifest.verification.factory.artifactSha256,/^[a-f0-9]{64}$/);
  assert.equal(manifest.verification.factory.compiler.version,'0.8.28+commit.7893614a');
  assert.equal(manifest.administrators.stakingOwner.toLowerCase(),OWNER.toLowerCase());
  assert.deepEqual(f.calls.filter(([kind])=>kind==='block').map(([,args])=>args),[{blockTag:'safe'},{blockNumber:123n}]);
  for(const [kind,args] of f.calls) if(kind!=='block') assert.equal(args.blockNumber,123n);
  await new BaseChain({manifest,publicClient:f.client}).verifyPins(123n);
});

test('rejects an RPC on another chain before any state reads',async()=>{const f=fixture();f.client.getChainId=async()=>1;await assert.rejects(buildDeploymentManifest(f.options),/CHAIN/);assert.equal(f.calls.length,0);});
test('requires an identified safe block and refuses latest fallback',async()=>{for(const block of [{number:null,hash:BLOCK_HASH,timestamp:1n},{number:123n,hash:null,timestamp:1n}]){const f=fixture();f.client.getBlock=async()=>block;await assert.rejects(buildDeploymentManifest(f.options),/BLOCK/);}});
test('detects a reorg while pinning instead of mixing two block states',async()=>{const f=fixture();let calls=0;f.client.getBlock=async()=>({number:123n,hash:calls++===0?BLOCK_HASH:ZERO,timestamp:1_800_000_000n});await assert.rejects(buildDeploymentManifest(f.options),/BLOCK_CHANGED/);});
test('rejects a factory pointing at a different explicitly reviewed Revnet deployer',async()=>{const f=fixture();f.getters.set(`${FACTORY}:REV_DEPLOYER`.toLowerCase(),OWNER);await assert.rejects(buildDeploymentManifest(f.options),/REVNET_DEPLOYER/);});
test('rejects substituted VVV staking and DIEM identities',async()=>{for(const name of ['VVV','STAKING','DIEM']){const f=fixture();f.getters.set(`${ADAPTER}:${name}`.toLowerCase(),OWNER);await assert.rejects(buildDeploymentManifest(f.options),/PROVIDER/);}});
test('checks staking assets and all token decimal contexts',async()=>{for(const key of [`${STAKING}:venice`,`${STAKING}:diem`,`${VVV}:decimals`,`${STAKING}:decimals`,`${DIEM}:decimals`]){const f=fixture();f.getters.set(key.toLowerCase(),key.endsWith('decimals')?6:OWNER);await assert.rejects(buildDeploymentManifest(f.options),/PROVIDER/);}});
test('rejects missing bytecode for every pinned component',async()=>{for(const address of [FACTORY,REV,ADAPTER,TERMINAL,CONTROLLER,PROJECTS,VVV,STAKING,DIEM,IMPLEMENTATION]){const f=fixture();f.code.set(address.toLowerCase(),'0x');await assert.rejects(buildDeploymentManifest(f.options),/CODE/);}});
test('rejects an unexpected implementation even when staking proxy bytecode is unchanged',async()=>{const f=fixture();f.client.getStorageAt=async()=>`0x${'00'.repeat(12)}${OWNER.slice(2)}`;await assert.rejects(buildDeploymentManifest(f.options),/IMPLEMENTATION/);});
test('rejects unrelated deployed factory and adapter bytecode',async()=>{for(const address of [FACTORY,ADAPTER]){const f=fixture();const code=f.code.get(address.toLowerCase());f.code.set(address.toLowerCase(),`0x00${code.slice(4)}`);await assert.rejects(buildDeploymentManifest(f.options),/ARTIFACT_RUNTIME/);}});
test('rejects bad artifact targets links and unsafe immutable ranges',async()=>{for(const mutate of [a=>a.metadata.settings.compilationTarget={'src/Fake.sol':'Fake'},a=>a.deployedBytecode.immutableReferences={'1':[{start:199,length:32}]},a=>a.deployedBytecode.immutableReferences={'1':[{start:16,length:32},{start:20,length:32}]},a=>a.deployedBytecode.linkReferences={'lib.sol':{Lib:[{start:0,length:20}]}},a=>a.metadata.compiler.version='0.8.29']){const f=fixture();mutate(f.factoryArtifact);f.options.factoryArtifactText=JSON.stringify(f.factoryArtifact);await assert.rejects(buildDeploymentManifest(f.options),/ARTIFACT/);}});
test('requires reviewed policy bounds and emits no unknown fields from its JSON input',async()=>{for(const policy of [null,{...POLICY,conversionCadence:'1'},{...POLICY,conversionCadence:'2592001'},{...POLICY,maxBatchTokens:'1'},{...POLICY,minDiemPerVVV:0},{...POLICY,maxPrincipal:(2n**128n).toString()}]){const f=fixture();await assert.rejects(buildDeploymentManifest({...f.options,launchPolicy:policy}),/POLICY/);}const f=fixture();const m=await buildDeploymentManifest({...f.options,launchPolicy:{...POLICY,privateKey:'must-not-be-written'}});assert.equal(JSON.stringify(m).includes('must-not-be-written'),false);});
test('requires explicit addresses policy and output and rejects duplicate unknown or signing flags',()=>{const args=['--factory',FACTORY,'--revnet-deployer',REV,'--launch-policy','policy.json','--output','manifest.json'];const parsed=parseManifestArguments(args);assert.equal(parsed.factory,FACTORY);assert.equal(parsed.revnetDeployer,REV);assert.equal(parsed.launchPolicy,'policy.json');assert.equal(parsed.output,'manifest.json');for(const invalid of [[],args.slice(0,-2),[...args,'--factory',OWNER],[...args,'--broadcast'],[...args,'--private-key','secret'],['--factory','--output']])assert.throws(()=>parseManifestArguments(invalid),/ARGUMENT/);});
test('writes the reviewed manifest exclusively and never overwrites an existing release',async()=>{const dir=await mkdtemp(join(tmpdir(),'telligence-manifest-'));try{const path=join(dir,'manifest.json');await writeManifestExclusive(path,{chainId:8453});const original=await readFile(path,'utf8');await assert.rejects(writeManifestExclusive(path,{chainId:1}),error=>error.code==='EEXIST');assert.equal(await readFile(path,'utf8'),original);}finally{await rm(dir,{recursive:true,force:true});}});


test('manifest records only a supported observed factory version and runtime checks enforce it', async()=>{
  for(const version of [undefined,0n,3n,2,'2',1n<<256n]) {
    const f=fixture(); f.getters.set(`${FACTORY}:POLICY_VERSION`.toLowerCase(),version);
    await assert.rejects(buildDeploymentManifest(f.options));
  }
  const f=fixture(); const manifest=await buildDeploymentManifest(f.options);
  f.getters.set(`${FACTORY}:POLICY_VERSION`.toLowerCase(),1n);
  await assert.rejects(new BaseChain({manifest,publicClient:f.client}).verifyPins(123n),error=>error.code==='MANIFEST_MISMATCH');
  assert.throws(()=>validateManifest({...manifest,policyVersion:'3'}),error=>error.code==='INVALID_MANIFEST');
});
