"use client";

import { ChainLogo } from "@/components/ChainLogo";
import { EthereumAddress } from "@/components/EthereumAddress";
import { TableSkeleton } from "@/components/loading/LoadingSkeletons";
import { TokenAmount } from "@/components/TokenAmount";
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
import { useLoanToken } from "@/hooks/useLoanToken";
import { useViewedAccount } from "@/hooks/useViewedAccount";
import { currentOutstandingLoanFee } from "@/lib/loanFees";
import { useJBContractContext, useJBTokenContext } from "@/lib/nana/project";
import { PROTOCOL_CONCEPTS } from "@/lib/protocolConcepts";
import { formatTokenSymbol } from "@/lib/utils";
import { JBChainId } from "@bananapus/nana-sdk-core";
import { useState } from "react";
import type { SelectedLoan } from "../../Value/hooks/useBorrowDialog";
import { LoanDetailsTable } from "../../Value/LoansDetailsTable";
import { ReallocateDialog } from "../../Value/ReallocateDialog";
import { RepayDialog } from "../../Value/RepayDialog";
import { ProjectItem } from "../shared";

function AllLoanRow({
  loan,
  projects,
  tokenSymbol,
  now,
}: {
  loan: any;
  projects: ProjectItem[];
  tokenSymbol: string;
  now: number;
}) {
  const { source, pending } = useLoanToken(loan, projects);
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
        {source ? (
          <TokenAmount
            value={BigInt(loan.borrowAmount)}
            decimals={source.decimals}
            symbol={source.symbol}
          />
        ) : pending ? (
          "…"
        ) : (
          "Unavailable"
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums">
        <TokenAmount value={BigInt(loan.collateral)} decimals={18} symbol={tokenSymbol} />
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums">
        {loan.prepaidFeePercent / 10}%
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums">
        {fee === null ? (
          "Expired"
        ) : source ? (
          <TokenAmount value={fee} decimals={source.decimals} symbol={source.symbol} />
        ) : pending ? (
          "…"
        ) : (
          "Unavailable"
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {new Date(loan.createdAt * 1000).toLocaleDateString()}
      </TableCell>
    </TableRow>
  );
}

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
        <div className="text-zinc-500">No active loans found.</div>
      ) : (
        <div className="mb-4 w-full max-w-full min-w-0">
          <div className="flex min-w-0 flex-col">
            <Table containerClassName="max-h-96">
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Network</TableHead>
                  <TableHead className="whitespace-nowrap">Borrower</TableHead>
                  <TableHead className="whitespace-nowrap">Borrowed</TableHead>
                  <TableHead>Tokens backing loan</TableHead>
                  <TableHead className="whitespace-nowrap">
                    <ConceptTerm note={PROTOCOL_CONCEPTS.prepaidFee}>Prepaid fee</ConceptTerm>
                  </TableHead>
                  <TableHead>Current repayment fee</TableHead>
                  <TableHead className="whitespace-nowrap">Opened</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((loan) => (
                  <AllLoanRow
                    key={`${loan.chainId}:${loan.id}`}
                    loan={loan}
                    projects={projects}
                    tokenSymbol={tokenSymbol}
                    now={now}
                  />
                ))}
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

  // One loan dialog at a time. A closed repay dialog stays mounted until another one opens.
  const [dialog, setDialog] = useState<
    | {
        kind: "repay";
        loanId: string;
        chainId: JBChainId;
        loanProjectId: number;
        open: boolean;
      }
    | { kind: "reallocate"; loan: SelectedLoan }
    | null
  >(null);

  if (!address) {
    return (
      <div className="flex w-full min-w-0 flex-col items-start gap-3">
        <AllLoansCard projects={projects} tokenSymbol={tokenSymbol} />
        <p className="text-md text-black font-light italic">
          Connect a wallet to manage loans backed by your {tokenSymbol}.
        </p>
        <WalletConnectButton />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      <AllLoansCard projects={projects} tokenSymbol={tokenSymbol} />

      <p className="text-md text-black font-light italic mb-2">
        Use {tokenSymbol} to back a loan from the revnet. This backing is called collateral. The
        tokens are removed from supply; repay to create them again. If they can support more
        borrowing later, you can use the extra capacity for a new loan, called refinancing.
      </p>

      <LoanDetailsTable
        title="Your loans"
        revnetId={projectId}
        address={address}
        tokenSymbol={tokenSymbol}
        projects={projects}
        onSelectLoan={(loanId, chainId, loanProjectId) => {
          if (!loanId || !chainId) return;
          setDialog({
            kind: "repay",
            loanId,
            chainId: chainId as JBChainId,
            loanProjectId,
            open: true,
          });
        }}
        onReallocateLoan={(loan) => setDialog({ kind: "reallocate", loan })}
      />

      {dialog?.kind === "repay" && (
        <RepayDialog
          loanId={dialog.loanId}
          chainId={dialog.chainId}
          projectId={projectId}
          loanProjectId={BigInt(dialog.loanProjectId)}
          open={dialog.open}
          onOpenChange={(open) => setDialog({ ...dialog, open })}
        />
      )}

      {dialog?.kind === "reallocate" && (
        <ReallocateDialog
          projectId={BigInt(projectId)}
          tokenSymbol={tokenSymbol}
          selectedLoan={dialog.loan}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        >
          <div style={{ display: "none" }} />
        </ReallocateDialog>
      )}
    </div>
  );
}
