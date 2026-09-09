"use client";

import { useCompleteParticipants } from "@/hooks/useCompleteBendystrawLists";
import { useTotalOutstandingTokens } from "@/hooks/useTotalOutstandingTokens";
import { ProjectOperation, SuckerGroupOperation, useBendystrawQuery } from "@/lib/bendystraw";
import { useJBChainId, useJBContractContext, useJBTokenContext } from "@/lib/nana/project";
import { prettyNumber } from "@/lib/number";
import { getTokenConfigForChain, getTokenSymbolFromAddress } from "@/lib/tokenUtils";
import { formatTokenSymbol } from "@/lib/utils";
import { formatUnits } from "@bananapus/nana-sdk-core";
import { ParticipantsPieChart } from "../../../../owners/components/ParticipantsPieChart";
import { ParticipantsTable } from "../../../../owners/components/ParticipantsTable";
import { aggregateParticipants, participantVolumeIsComparable } from "./participantsAggregate";

/**
 * "All" card (website/ parity: renderOwnersAll): the holder distribution pie +
 * table, aggregated per account across every chain in the sucker group.
 */
export function V6AllCard() {
  const chainId = useJBChainId();
  const { projectId } = useJBContractContext();
  const { token } = useJBTokenContext();
  const totalOutstandingTokens = useTotalOutstandingTokens();

  const project = useBendystrawQuery(ProjectOperation, {
    projectId: Number(projectId),
    chainId: Number(chainId),
    version: 6,
  });
  const suckerGroupId = project.data?.project?.suckerGroupId;

  const { data: suckerGroupData } = useBendystrawQuery(
    SuckerGroupOperation,
    { id: suckerGroupId ?? "" },
    { enabled: !!suckerGroupId, pollInterval: 10000, chainId: Number(chainId) },
  );

  // Null while the sucker-group data loads — volume amounts can't be labeled
  // yet (never default to ETH/18).
  const chainTokenConfig = getTokenConfigForChain(suckerGroupData, Number(chainId));
  const baseTokenSymbol = chainTokenConfig
    ? (chainTokenConfig.symbol ?? getTokenSymbolFromAddress(chainTokenConfig.token))
    : undefined;
  const baseTokenDecimals = chainTokenConfig?.decimals;
  // `participant.volume` is denominated in each chain's OWN accounting token, so a group mixing
  // ETH and USDC cannot be summed into one figure under one symbol.
  const volumeComparable = participantVolumeIsComparable(
    suckerGroupData?.suckerGroup?.projects?.items ?? [],
  );

  const participantsQuery = useCompleteParticipants(
    {
      suckerGroupId,
      balance_gt: "0",
    },
    Number(chainId),
    !!suckerGroupId,
  );

  // Aggregate each account's balance/volume across the chains it holds on.
  const participants = aggregateParticipants(participantsQuery.data);
  const totalLabel = token?.data
    ? `${prettyNumber(
        formatUnits(totalOutstandingTokens, token.data.decimals, { fractionDigits: 1 }),
      )} ${formatTokenSymbol(token.data.symbol)}`
    : null;

  return (
    <div className="@container">
      <p className="text-md text-black font-light italic mb-2">
        {formatTokenSymbol(token)} owners are accounts who either paid in, received splits, received
        auto issuance, or traded for them on the market.
      </p>
      {participantsQuery.isError ? (
        <p className="mb-3 text-sm text-red-600">Owner balances are temporarily unavailable.</p>
      ) : null}
      <div className="grid items-start gap-8 @4xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
        <div className="min-w-0">
          <ParticipantsPieChart
            participants={participants}
            totalSupply={totalOutstandingTokens}
            token={token?.data}
            showOwnerCount
          />
          {totalLabel ? (
            <p className="-mt-4 text-center text-sm text-melon-700">Total: {totalLabel}</p>
          ) : null}
        </div>
        <div className="w-full min-w-0 overflow-auto">
          {chainTokenConfig ? (
            <ParticipantsTable
              participants={participants}
              token={token?.data}
              totalSupply={totalOutstandingTokens}
              baseTokenSymbol={baseTokenSymbol}
              baseTokenDecimals={baseTokenDecimals}
              volumeComparable={volumeComparable}
              condensed
            />
          ) : null}
        </div>
      </div>
      {participants.length > 0 ? (
        <p className="mt-4 text-sm text-melon-700">
          {participants.length} holder{participants.length === 1 ? "" : "s"} — ranked by balance, as
          shares of the balances tracked here
        </p>
      ) : null}
    </div>
  );
}
