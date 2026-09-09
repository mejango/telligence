"use client";

import { ChainLogo } from "@/components/ChainLogo";
import { EthereumAddress } from "@/components/EthereumAddress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { JBChainId, ProjectTokenData } from "@/lib/nana/types";
import { exactNumber, prettyNumber } from "@/lib/number";
import { formatPortion, formatTokenSymbol } from "@/lib/utils";
import { formatUnits } from "@bananapus/nana-sdk-core";
import { useRef, useState, type ReactNode } from "react";
import { Address } from "viem";

export const PARTICIPANTS_PAGE_SIZE = 30;

/** The fields the holder-distribution surfaces actually consume. */
export type ParticipantRow = {
  address: string;
  balance: string | number | bigint;
  volume: string | number | bigint;
  chains: number[];
};

export function ParticipantsTable({
  participants,
  token,
  totalSupply,
  baseTokenSymbol = "ETH",
  baseTokenDecimals = 18,
  volumeComparable = true,
  condensed = false,
  pageSize = PARTICIPANTS_PAGE_SIZE,
}: {
  participants: ParticipantRow[];
  token: ProjectTokenData | null | undefined;
  totalSupply: bigint;
  baseTokenSymbol?: string;
  baseTokenDecimals?: number;
  /** False when the group's chains use different accounting tokens — see
   *  participantVolumeIsComparable. The column is suppressed rather than summed. */
  volumeComparable?: boolean;
  condensed?: boolean;
  pageSize?: number;
}) {
  const [requestedPage, setRequestedPage] = useState(0);
  const paginationRef = useRef<HTMLElement>(null);
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(participants.length / safePageSize));
  const page = Math.min(requestedPage, pageCount - 1);
  const pageStart = page * safePageSize;
  const visibleParticipants = participants.slice(pageStart, pageStart + safePageSize);

  if (participants.length === 0) {
    return (
      <div className="text-center text-zinc-500">
        No token holders yet. Pay in to receive tokens.
      </div>
    );
  }

  const goToPage = (nextPage: number) => {
    setRequestedPage(Math.max(0, Math.min(pageCount - 1, nextPage)));
    paginationRef.current?.scrollIntoView?.({ block: "nearest" });
  };

  return (
    <>
      <Table className={condensed ? "min-w-[720px]" : undefined}>
        <TableHeader>
          <TableRow>
            <TableHead className="w-auto md:w-1/2">Account</TableHead>
            <TableHead>{condensed ? "Share" : "Balance"}</TableHead>
            <TableHead>Chains</TableHead>
            {volumeComparable ? <TableHead>Paid</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleParticipants.map((participant) => (
            <TableRow key={participant?.address}>
              <TableCell>
                <div className="flex flex-col sm:flex-row items-center">
                  <div className="hidden sm:flex">
                    <EthereumAddress
                      address={participant?.address as Address}
                      short
                      withEnsAvatar
                      withEnsName
                    />
                  </div>
                  <div className="flex sm:hidden">
                    <EthereumAddress
                      address={participant?.address as Address}
                      short
                      withEnsAvatar
                      withEnsName
                    />
                  </div>
                </div>
              </TableCell>
              {token && condensed ? (
                <TableCell className="whitespace-nowrap tabular-nums">
                  <span className="font-semibold">
                    {participant.balance
                      ? formatPortion(BigInt(participant.balance), totalSupply)
                      : 0}
                    %
                  </span>
                </TableCell>
              ) : token ? (
                <TableCell
                  className="whitespace-nowrap pr-14"
                  // Abbreviated for the table; the exact balance is one hover away.
                  title={`${exactNumber(
                    formatUnits(BigInt(participant.balance), token.decimals),
                  )} ${formatTokenSymbol(token.symbol)}`}
                >
                  {prettyNumber(
                    formatUnits(BigInt(participant.balance), token.decimals, {
                      fractionDigits: 3,
                    }),
                  )}{" "}
                  {formatTokenSymbol(token.symbol)} {" | "}
                  <span className="font-bold">
                    {participant.balance
                      ? formatPortion(BigInt(participant.balance), totalSupply)
                      : 0}
                    %
                  </span>
                </TableCell>
              ) : null}
              <TableCell className="whitespace-nowrap pr-20">
                <div className="flex items-center gap-1">
                  {participant.chains.map((chain) => (
                    <ChainLogo
                      chainId={chain as JBChainId}
                      key={chain}
                      width={14}
                      height={14}
                      standalone
                    />
                  ))}
                </div>
              </TableCell>
              {volumeComparable ? (
                <TableCell className="whitespace-nowrap">
                  {formatUnits(BigInt(participant.volume), baseTokenDecimals, {
                    fractionDigits: 3,
                  })}{" "}
                  {baseTokenSymbol}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {pageCount > 1 ? (
        <nav
          ref={paginationRef}
          aria-label="Owners table pages"
          className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5"
        >
          <PageButton disabled={page === 0} onClick={() => goToPage(0)}>
            « First
          </PageButton>
          <PageButton disabled={page === 0} onClick={() => goToPage(page - 1)}>
            ‹ Prev
          </PageButton>
          <span aria-live="polite" className="px-1 text-xs text-zinc-500">
            {page + 1} / {pageCount}
          </span>
          <PageButton disabled={page === pageCount - 1} onClick={() => goToPage(page + 1)}>
            Next ›
          </PageButton>
          <PageButton disabled={page === pageCount - 1} onClick={() => goToPage(pageCount - 1)}>
            Last »
          </PageButton>
        </nav>
      ) : null}
    </>
  );
}

function PageButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="px-2 py-1 text-xs text-zinc-500 transition-colors hover:text-melon-700 disabled:cursor-default disabled:opacity-35"
    >
      {children}
    </button>
  );
}
