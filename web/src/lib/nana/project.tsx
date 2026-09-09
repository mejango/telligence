"use client";

import {
  CashOutTaxRate,
  getJBContractAddress,
  getProjectMetadata,
  jbControllerAbi,
  JBCoreContracts,
  jbDirectoryAbi,
  jbMultiTerminalAbi,
  jbOmnichainDeployerAbi,
  JBOmnichainDeployerContracts,
  jbTokensAbi,
  ReservedPercent,
  RulesetWeight,
  WeightCutPercent,
  type Contract,
  type JBChainId,
  type JBProjectMetadata,
} from "@bananapus/nana-sdk-core";
import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, type PropsWithChildren } from "react";
import {
  erc20Abi,
  formatUnits,
  isAddressEqual,
  zeroAddress,
  type Address,
  type Chain,
  type ContractFunctionReturnType,
  type PublicClient,
} from "viem";
import { useChainId, useChains, usePublicClient, useReadContract } from "wagmi";
import { resolveV6DataHookAddress } from "./state";
import type {
  AsyncData,
  InitialProjectData,
  JBTokenContextData,
  ProjectTokenData,
  SuckerPair,
} from "./types";

const VERSION = 6 as const;
type V6Contract = Parameters<typeof getJBContractAddress<6>>[0];

type ContractState = {
  primaryNativeTerminal: AsyncData<Address>;
  controller: AsyncData<Address>;
  fundAccessLimits: AsyncData<Address>;
  rulesets: AsyncData<Address>;
  tokens: AsyncData<Address>;
  splits: AsyncData<Address>;
};

export type JBContractContextData = {
  projectId: bigint;
  version: typeof VERSION;
  contracts: ContractState;
  contractAddress: (contract: Contract, chainId?: JBChainId) => Address;
};

type RulesetTuple = ContractFunctionReturnType<typeof jbControllerAbi, "view", "currentRulesetOf">;

type RulesetData = Omit<RulesetTuple[0], "weight" | "weightCutPercent"> & {
  weight: RulesetWeight;
  weightCutPercent: WeightCutPercent;
};

type RulesetMetadata = Omit<RulesetTuple[1], "cashOutTaxRate" | "reservedPercent"> & {
  cashOutTaxRate: CashOutTaxRate;
  reservedPercent: ReservedPercent;
};

export type JBRulesetContextData = {
  ruleset: AsyncData<RulesetData>;
  rulesetMetadata: AsyncData<RulesetMetadata>;
};

export type JBProjectMetadataContextData = {
  metadata: AsyncData<JBProjectMetadata>;
};

type ProjectContextData = {
  chainId: JBChainId;
  projectId: bigint;
  initialSuckers: readonly SuckerPair[];
  /** Optional product boundary for selectable deployments; omission keeps all chains. */
  allowedChainIds?: readonly JBChainId[];
};

const empty = <T,>(): AsyncData<T> => ({ data: undefined, isLoading: false });

const JBChainContext = createContext<JBChainId | undefined>(undefined);
const JBContractContext = createContext<JBContractContextData | undefined>(undefined);
const JBRulesetContext = createContext<JBRulesetContextData | undefined>(undefined);
const JBProjectMetadataContext = createContext<JBProjectMetadataContextData | undefined>(undefined);
const JBTokenContext = createContext<JBTokenContextData | undefined>(undefined);
const JBProjectContext = createContext<ProjectContextData | undefined>(undefined);

function requireContext<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`${name} must be used within ProjectProvider`);
  }
  return value;
}

export function useJBChainId(): JBChainId | undefined {
  return useContext(JBChainContext);
}

export function useJBContractContext(): JBContractContextData {
  return requireContext(useContext(JBContractContext), "useJBContractContext");
}

export function useJBRulesetContext(): JBRulesetContextData {
  return requireContext(useContext(JBRulesetContext), "useJBRulesetContext");
}

export function useJBProjectMetadataContext(): JBProjectMetadataContextData {
  return requireContext(useContext(JBProjectMetadataContext), "useJBProjectMetadataContext");
}

export function useJBTokenContext(): JBTokenContextData {
  return requireContext(useContext(JBTokenContext), "useJBTokenContext");
}

export function useJBProject(): ProjectContextData | undefined {
  return useContext(JBProjectContext);
}

export function useChain(): Chain | undefined {
  const activeChainId = useChainId();
  const chains = useChains();
  return chains.find((chain) => chain.id === activeChainId);
}

export function ProjectProvider({
  projectId,
  chainId,
  initialProject,
  initialSuckers = [],
  allowedChainIds,
  ipfsGatewayHostname,
  children,
}: PropsWithChildren<{
  projectId: bigint;
  chainId: JBChainId;
  initialProject?: InitialProjectData;
  initialSuckers?: readonly SuckerPair[];
  allowedChainIds?: readonly JBChainId[];
  ipfsGatewayHostname?: string;
}>) {
  const project = useMemo(
    () => ({ projectId, chainId, initialSuckers, allowedChainIds }),
    [projectId, chainId, initialSuckers, allowedChainIds],
  );

  return (
    <JBProjectContext.Provider value={project}>
      <JBChainContext.Provider value={chainId}>
        <ContractProvider projectId={projectId}>
          <RulesetProvider>
            <MetadataProvider
              initialMetadata={initialProject?.metadata}
              ipfsGatewayHostname={ipfsGatewayHostname}
            >
              <TokenProvider initialToken={initialProject?.token}>{children}</TokenProvider>
            </MetadataProvider>
          </RulesetProvider>
        </ContractProvider>
      </JBChainContext.Provider>
    </JBProjectContext.Provider>
  );
}

function queryState<T>(
  query: {
    data?: T;
    isLoading: boolean;
    error?: unknown;
    refetch: () => Promise<unknown>;
  },
  fallback?: T,
): AsyncData<T> {
  return {
    data: query.data ?? fallback,
    isLoading: query.isLoading && query.data === undefined && fallback === undefined,
    error:
      query.error instanceof Error
        ? query.error
        : query.error
          ? new Error(String(query.error))
          : null,
    refetch: query.refetch,
  };
}

function ContractProvider({ projectId, children }: PropsWithChildren<{ projectId: bigint }>) {
  const chainId = useJBChainId();
  const directory = chainId
    ? getJBContractAddress(JBCoreContracts.JBDirectory, VERSION, chainId)
    : undefined;
  const multiTerminal = chainId
    ? getJBContractAddress(JBCoreContracts.JBMultiTerminal, VERSION, chainId)
    : undefined;
  const accountingContexts = useReadContract({
    address: multiTerminal,
    abi: jbMultiTerminalAbi,
    functionName: "accountingContextsOf",
    chainId,
    args: [projectId],
    query: { enabled: !!multiTerminal },
  });
  const primaryAccountingToken = accountingContexts.data?.[0]?.token;
  const primaryNativeTerminal = useReadContract({
    address: directory,
    abi: jbDirectoryAbi,
    functionName: "primaryTerminalOf",
    chainId,
    args: primaryAccountingToken ? [projectId, primaryAccountingToken] : undefined,
    query: { enabled: !!directory && !!primaryAccountingToken },
  });
  const controller = useReadContract({
    address: directory,
    abi: jbDirectoryAbi,
    functionName: "controllerOf",
    chainId,
    args: [projectId],
    query: { enabled: !!directory, staleTime: Infinity },
  });
  const controllerAddress =
    controller.data && !isAddressEqual(controller.data, zeroAddress) ? controller.data : undefined;

  const fundAccessLimits = useReadContract({
    address: controllerAddress,
    abi: jbControllerAbi,
    functionName: "FUND_ACCESS_LIMITS",
    chainId,
    query: { enabled: !!controllerAddress, staleTime: Infinity },
  });
  const rulesets = useReadContract({
    address: controllerAddress,
    abi: jbControllerAbi,
    functionName: "RULESETS",
    chainId,
    query: { enabled: !!controllerAddress, staleTime: Infinity },
  });
  const tokens = useReadContract({
    address: controllerAddress,
    abi: jbControllerAbi,
    functionName: "TOKENS",
    chainId,
    query: { enabled: !!controllerAddress, staleTime: Infinity },
  });
  const splits = useReadContract({
    address: controllerAddress,
    abi: jbControllerAbi,
    functionName: "SPLITS",
    chainId,
    query: { enabled: !!controllerAddress, staleTime: Infinity },
  });

  const contractAddress = useCallback(
    (contract: Contract, requestedChainId?: JBChainId) =>
      getJBContractAddress(contract as V6Contract, VERSION, requestedChainId ?? chainId!),
    [chainId],
  );

  const value = useMemo<JBContractContextData>(
    () => ({
      projectId,
      version: VERSION,
      contracts: {
        primaryNativeTerminal: queryState(primaryNativeTerminal),
        controller: queryState(controller),
        fundAccessLimits: queryState(fundAccessLimits),
        rulesets: queryState(rulesets),
        tokens: queryState(tokens),
        splits: queryState(splits),
      },
      contractAddress,
    }),
    [
      projectId,
      primaryNativeTerminal,
      controller,
      fundAccessLimits,
      rulesets,
      tokens,
      splits,
      contractAddress,
    ],
  );

  return <JBContractContext.Provider value={value}>{children}</JBContractContext.Provider>;
}

function RulesetProvider({ children }: PropsWithChildren) {
  const chainId = useJBChainId();
  const { projectId, contracts } = useJBContractContext();
  const current = useReadContract({
    chainId,
    abi: jbControllerAbi,
    functionName: "currentRulesetOf",
    address: contracts.controller.data ?? undefined,
    args: [projectId],
    query: {
      enabled: !!contracts.controller.data,
      select([ruleset, metadata]) {
        return {
          ruleset: {
            ...ruleset,
            weight: new RulesetWeight(ruleset.weight),
            weightCutPercent: new WeightCutPercent(ruleset.weightCutPercent),
          },
          metadata: {
            ...metadata,
            cashOutTaxRate: new CashOutTaxRate(metadata.cashOutTaxRate),
            reservedPercent: new ReservedPercent(metadata.reservedPercent),
          },
        };
      },
    },
  });

  const dataHook = current.data?.metadata.dataHook;
  const deployer = chainId
    ? getJBContractAddress(JBOmnichainDeployerContracts.JBOmnichainDeployer, VERSION, chainId)
    : undefined;
  const isOmnichainDeployer = Boolean(dataHook && deployer && isAddressEqual(dataHook, deployer));
  const rulesetId = BigInt(current.data?.ruleset.id ?? 0);

  const tiered721Hook = useReadContract({
    abi: jbOmnichainDeployerAbi,
    functionName: "tiered721HookOf",
    address: deployer,
    chainId,
    args: [projectId, rulesetId],
    query: {
      enabled: isOmnichainDeployer && rulesetId > 0n,
    },
  });
  const extraDataHook = useReadContract({
    abi: jbOmnichainDeployerAbi,
    functionName: "extraDataHookOf",
    address: deployer,
    chainId,
    args: [projectId, rulesetId],
    query: {
      enabled: isOmnichainDeployer && rulesetId > 0n,
    },
  });

  const resolvedDataHook = resolveV6DataHookAddress({
    dataHook,
    omnichainDeployer: deployer,
    tiered721Hook: tiered721Hook.data?.[0],
    extraDataHook: extraDataHook.data?.dataHook,
  });

  const error = current.error ?? tiered721Hook.error ?? extraDataHook.error;
  const isLoading =
    current.isLoading ||
    (isOmnichainDeployer && (tiered721Hook.isLoading || extraDataHook.isLoading));
  const refetch = useCallback(
    () => Promise.all([current.refetch(), tiered721Hook.refetch(), extraDataHook.refetch()]),
    [current, tiered721Hook, extraDataHook],
  );

  const value = useMemo<JBRulesetContextData>(
    () => ({
      ruleset: {
        data: current.data?.ruleset,
        isLoading,
        error: error instanceof Error ? error : error ? new Error(String(error)) : null,
        refetch,
      },
      rulesetMetadata: {
        data: current.data?.metadata
          ? { ...current.data.metadata, dataHook: resolvedDataHook }
          : undefined,
        isLoading,
        error: error instanceof Error ? error : error ? new Error(String(error)) : null,
        refetch,
      },
    }),
    [current.data, error, isLoading, refetch, resolvedDataHook],
  );

  return <JBRulesetContext.Provider value={value}>{children}</JBRulesetContext.Provider>;
}

function MetadataProvider({
  initialMetadata,
  ipfsGatewayHostname,
  children,
}: PropsWithChildren<{
  initialMetadata?: InitialProjectData["metadata"];
  ipfsGatewayHostname?: string;
}>) {
  const chainId = useJBChainId();
  const client = usePublicClient({ chainId });
  const { projectId, contracts } = useJBContractContext();
  const controller = contracts.controller.data ?? undefined;
  const metadata = useQuery({
    queryKey: [
      "revnet",
      "projectMetadata",
      chainId,
      projectId.toString(),
      controller,
      ipfsGatewayHostname,
    ],
    enabled: !!client && !!controller,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!client || !controller) return null;
      return await getProjectMetadata(
        client as PublicClient,
        { projectId, jbControllerAddress: controller },
        { ipfsGatewayHostname },
      );
    },
  });

  const value = useMemo<JBProjectMetadataContextData>(
    () => ({
      metadata: {
        data:
          metadata.data ?? (initialMetadata ? (initialMetadata as JBProjectMetadata) : undefined),
        isLoading: metadata.isLoading && !initialMetadata,
        error:
          metadata.error instanceof Error
            ? metadata.error
            : metadata.error
              ? new Error(String(metadata.error))
              : null,
        refetch: metadata.refetch,
      },
    }),
    [metadata, initialMetadata],
  );
  return (
    <JBProjectMetadataContext.Provider value={value}>{children}</JBProjectMetadataContext.Provider>
  );
}

function TokenProvider({
  initialToken,
  children,
}: PropsWithChildren<{ initialToken?: InitialProjectData["token"] }>) {
  const chainId = useJBChainId();
  const { projectId } = useJBContractContext();
  const tokenAddress = useReadContract({
    address: chainId ? getJBContractAddress(JBCoreContracts.JBTokens, VERSION, chainId) : undefined,
    abi: jbTokensAbi,
    functionName: "tokenOf",
    chainId,
    args: [projectId],
    query: { enabled: !!chainId },
  });
  const address =
    tokenAddress.data && !isAddressEqual(tokenAddress.data, zeroAddress)
      ? tokenAddress.data
      : initialToken?.address;
  const name = useReadContract({
    address,
    abi: erc20Abi,
    functionName: "name",
    chainId,
    query: { enabled: !!address },
  });
  const symbol = useReadContract({
    address,
    abi: erc20Abi,
    functionName: "symbol",
    chainId,
    query: { enabled: !!address },
  });
  const decimals = useReadContract({
    address,
    abi: erc20Abi,
    functionName: "decimals",
    chainId,
    query: { enabled: !!address },
  });
  const erc20TotalSupply = useReadContract({
    address,
    abi: erc20Abi,
    functionName: "totalSupply",
    chainId,
    query: { enabled: !!address },
  });
  const tokenData = useMemo<ProjectTokenData | undefined>(
    () =>
      address &&
      (decimals.data !== undefined || initialToken?.decimals !== undefined) &&
      (symbol.data !== undefined || initialToken?.symbol !== undefined) &&
      (erc20TotalSupply.data !== undefined || initialToken?.totalSupply !== undefined)
        ? {
            address,
            decimals: decimals.data ?? initialToken!.decimals,
            name: name.data ?? initialToken?.name,
            symbol: symbol.data ?? initialToken?.symbol,
            totalSupply:
              erc20TotalSupply.data !== undefined
                ? {
                    value: erc20TotalSupply.data,
                    formatted: formatUnits(
                      erc20TotalSupply.data,
                      decimals.data ?? initialToken!.decimals,
                    ),
                  }
                : initialToken!.totalSupply!,
          }
        : undefined,
    [address, decimals.data, erc20TotalSupply.data, initialToken, name.data, symbol.data],
  );
  const tokenError =
    tokenAddress.error ?? name.error ?? symbol.error ?? decimals.error ?? erc20TotalSupply.error;
  const tokenLoading =
    !tokenData &&
    (tokenAddress.isLoading ||
      name.isLoading ||
      symbol.isLoading ||
      decimals.isLoading ||
      erc20TotalSupply.isLoading);
  const refetchToken = useCallback(
    () =>
      Promise.all([
        tokenAddress.refetch(),
        name.refetch(),
        symbol.refetch(),
        decimals.refetch(),
        erc20TotalSupply.refetch(),
      ]),
    [tokenAddress, name, symbol, decimals, erc20TotalSupply],
  );

  const value = useMemo<JBTokenContextData>(
    () => ({
      token: {
        data: tokenData,
        isLoading: tokenLoading,
        error:
          tokenError instanceof Error
            ? tokenError
            : tokenError
              ? new Error(String(tokenError))
              : null,
        refetch: refetchToken,
      },
      // Aggregate supply is already provided by the cross-chain index. Nana's
      // optional total-outstanding query was disabled in this app too.
      totalOutstanding: empty(),
    }),
    [tokenData, tokenLoading, tokenError, refetchToken],
  );

  return <JBTokenContext.Provider value={value}>{children}</JBTokenContext.Provider>;
}

export type { JBChainId } from "@bananapus/nana-sdk-core";
export type { JBTokenContextData } from "./types";
