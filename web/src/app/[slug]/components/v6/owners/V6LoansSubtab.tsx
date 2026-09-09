"use client";

import { ChainLogo } from "@/components/ChainLogo";
import { EthereumAddress } from "@/components/EthereumAddress";
import { TableSkeleton } from "@/components/loading/LoadingSkeletons";
import { ConceptTerm } from "@/components/ui/ConceptTerm";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WalletConnectButton } from "@/components/WalletButton";
import { useCompleteLoans } from "@/hooks/useCompleteBendystrawLists";
import { useViewedAccount } from "@/hooks/useViewedAccount";
import { currentOutstandingLoanFee } from "@/lib/loanFees";
import { useJBContractContext, useJBTokenContext } from "@/lib/nana/project";
import { commaNumber } from "@/lib/number";
import { PROTOCOL_CONCEPTS } from "@/lib/protocolConcepts";
import { accountingDecimalsOf, getTokenSymbolFromAddress } from "@/lib/tokenUtils";
import { formatTokenSymbol } from "@/lib/utils";
import { JBChainId } from "@bananapus/nana-sdk-core";
import { useState } from "react";
import { formatUnits } from "viem";
import type { SelectedLoan } from "../../Value/hooks/useBorrowDialog";
import { LoanDetailsTable } from "../../Value/LoansDetailsTable";
import { ReallocateDialog } from "../../Value/ReallocateDialog";
import { RepayDialog } from "../../Value/RepayDialog";
import { ProjectItem } from "../shared";

function AllLoansCard({ projects, tokenSymbol }: { projects: ProjectItem[]; tokenSymbol: string }) {
  const { data, isLoading, isError } = useCompleteLoans(
    projects.map((project) => ({
      chainId: project.chainId,
      projectId: project.projectId,
      version: 6,
    })),
    projects.length > 0,
  );
  const rows = data ?? [];
  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="mb-8 w-full min-w-0">
      <h3 className="mb-2 text-base font-semibold text-zinc-700">Active loans</h3>
      {isLoading ? (
        <TableSkeleton rows={4} columns={7} />
      ) : isError ? (
        <div className="text-red-600">Active loans are unavailable.</div>
      ) : rows.length === 0 ? (
        <div className="text-zinc-500">No active loans indexed.</div>
      ) : (
        <div className="mb-4 max-h-96 w-full max-w-full min-w-0 overflow-auto">
          <div className="flex min-w-0 flex-col">
            <Table className="min-w-max">
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Chain</TableHead>
                  <TableHead className="whitespace-nowrap">Borrower</TableHead>
                  <TableHead className="whitespace-nowrap">Borrowed</TableHead>
                  <TableHead className="whitespace-nowrap">Collateral</TableHead>
                  <TableHead className="whitespace-nowrap">
                    <ConceptTerm note={PROTOCOL_CONCEPTS.prepaidFee}>Prepaid fee</ConceptTerm>
                  </TableHead>
                  <TableHead className="whitespace-nowrap">Current fee outstanding</TableHead>
                  <TableHead className="whitespace-nowrap">Opened</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((loan) => {
                  const project = projects.find(
                    (candidate) =>
                      candidate.chainId === loan.chainId && candidate.projectId === loan.projectId,
                  );
                  const knownSymbol = getTokenSymbolFromAddress(loan.token);
                  const sourceSymbol =
                    knownSymbol === "TOKEN" ? project?.tokenSymbol || "TOKEN" : knownSymbol;
                  const sourceDecimals = accountingDecimalsOf({
                    token: loan.token,
                    decimals: project?.decimals,
                  });
                  const fee = currentOutstandingLoanFee({
                    amount: BigInt(loan.borrowAmount),
                    prepaidFeePercent: loan.prepaidFeePercent,
                    prepaidDuration: loan.prepaidDuration,
                    createdAt: loan.createdAt,
                    now,
                  });

                  return (
                    <TableRow key={`${loan.chainId}:${loan.id}`}>
                      <TableCell className="whitespace-nowrap">
                        <ChainLogo chainId={loan.chainId as JBChainId} standalone />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <EthereumAddress address={loan.owner as `0x${string}`} short withEnsName />
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {commaNumber(formatUnits(BigInt(loan.borrowAmount), sourceDecimals))}{" "}
                        {sourceSymbol}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {commaNumber(formatUnits(BigInt(loan.collateral), 18))} {tokenSymbol}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {loan.prepaidFeePercent / 10}%
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {fee === null
                          ? "Expired"
                          : `${commaNumber(formatUnits(fee, sourceDecimals))} ${sourceSymbol}`}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {new Date(loan.createdAt * 1000).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Loans subtab (website/ parity: renderLoansTable): every active REVLoan on the
 * project (indexed), plus the connected wallet's loans with per-loan Repay and
 * Refinance (reallocate collateral) entry points. The "Get a loan" flow lives on
 * the Accounts subtab's You card.
 */
export function V6LoansSubtab({ projects }: { projects: ProjectItem[] }) {
  const { projectId } = useJBContractContext();
  const { token } = useJBTokenContext();
  const tokenSymbol = formatTokenSymbol(token);
  const { address } = useViewedAccount();

  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);
  const [selectedChainId, setSelectedChainId] = useState<JBChainId | null>(null);
  const [selectedLoanProjectId, setSelectedLoanProjectId] = useState<number | null>(null);
  const [showRepayDialog, setShowRepayDialog] = useState(false);
  const [reallocateLoan, setReallocateLoan] = useState<SelectedLoan | null>(null);
  const [showReallocateDialog, setShowReallocateDialog] = useState(false);

  if (!address) {
    return (
      <div className="flex w-full min-w-0 flex-col items-start gap-3">
        <AllLoansCard projects={projects} tokenSymbol={tokenSymbol} />
        <p className="text-md text-black font-light italic">
          Connect a wallet to see and manage your loans against {tokenSymbol} collateral.
        </p>
        <WalletConnectButton />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      <AllLoansCard projects={projects} tokenSymbol={tokenSymbol} />

      <p className="text-md text-black font-light italic mb-2">
        Loans borrow against your {tokenSymbol} as collateral through the revnet itself. Repay to
        reclaim collateral, or refinance to borrow against appreciated collateral.
      </p>

      <LoanDetailsTable
        title="Your loans"
        revnetId={projectId}
        address={address}
        tokenSymbol={tokenSymbol}
        projects={projects}
        onSelectLoan={(loanId, chainId, loanProjectId) => {
          setSelectedLoanId(loanId);
          setSelectedChainId(chainId as JBChainId);
          setSelectedLoanProjectId(loanProjectId);
          setShowRepayDialog(true);
        }}
        onReallocateLoan={(loan) => {
          setReallocateLoan(loan);
          setShowReallocateDialog(true);
        }}
      />

      {selectedLoanId && selectedChainId && selectedLoanProjectId !== null && (
        <RepayDialog
          loanId={selectedLoanId}
          chainId={selectedChainId}
          projectId={projectId}
          loanProjectId={BigInt(selectedLoanProjectId)}
          open={showRepayDialog}
          onOpenChange={setShowRepayDialog}
        />
      )}

      {reallocateLoan && (
        <ReallocateDialog
          projectId={BigInt(projectId)}
          tokenSymbol={tokenSymbol}
          selectedLoan={reallocateLoan}
          open={showReallocateDialog}
          onOpenChange={(open) => {
            setShowReallocateDialog(open);
            if (!open) setReallocateLoan(null);
          }}
        >
          <div style={{ display: "none" }} />
        </ReallocateDialog>
      )}
    </div>
  );
}
