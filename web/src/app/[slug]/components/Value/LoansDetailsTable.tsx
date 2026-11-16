import { ChainLogo } from "@/components/ChainLogo";
import { TokenAmount } from "@/components/TokenAmount";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBorrowableAmountFrom } from "@/hooks/useBorrowableAmountFrom";
import { useCompleteLoansByAccount } from "@/hooks/useCompleteBendystrawLists";
import { useLoanToken } from "@/hooks/useLoanToken";
import { ProjectOperation, SuckerGroupOperation, useBendystrawQuery } from "@/lib/bendystraw";
import type { Project } from "@/lib/bendystraw/types";
import { useJBChainId, useJBTokenContext } from "@/lib/nana/project";
import type { LoanTokenProject } from "@/lib/tokenUtils";
import { formatSeconds } from "@/lib/utils";
import { getRevnetLoanContract, JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";

// Constants for loan calculations and display
const LOAN_CONSTANTS = {
  POLL_INTERVAL: 3000, // Refresh every 3 seconds
} as const;

// Separate component for each loan row to avoid Rules of Hooks violation
function LoanRow({
  loan,
  tokenSymbol,
  selectedLoanId,
  now,
  onSelectLoan,
  onReallocateLoan,
  suckerGroupData,
}: {
  loan: any;
  tokenSymbol: string;
  selectedLoanId?: string;
  now: number;
  onSelectLoan?: (loanId: string, chainId: number, projectId: number) => void;
  onReallocateLoan?: (loan: any) => void;
  suckerGroupData?: any;
}) {
  const { token } = useJBTokenContext();
  const projectTokenDecimals = token?.data?.decimals ?? 18;

  const {
    source: chainTokenConfig,
    pending,
    retry,
  } = useLoanToken(loan, suckerGroupData?.suckerGroup?.projects?.items ?? [], true);
  const baseTokenSymbol = chainTokenConfig?.symbol;
  const baseTokenDecimals = chainTokenConfig?.decimals;
  const sourceReady = chainTokenConfig?.currency !== undefined;

  // Calculate headroom: current value of collateral - borrowed amount. The quote is keyed
  // on the loan's OWN (chainId, projectId) — V6 project ids are per-chain, so the route
  // chain's id names a different revnet here — and valued at the ECONOMIC ceiling
  // (`capacity`), the quote the contract's reallocation solvency check uses.
  const { capacity: currentCollateralValue } = useBorrowableAmountFrom({
    chainId: loan.chainId as JBChainId,
    address: getRevnetLoanContract(6, loan.chainId as JBChainId),
    args:
      sourceReady && chainTokenConfig
        ? [
            BigInt(loan.projectId),
            BigInt(loan.collateral),
            BigInt(chainTokenConfig.decimals),
            BigInt(chainTokenConfig.currency!),
          ]
        : undefined,
  });

  const headroom =
    currentCollateralValue !== undefined && sourceReady
      ? currentCollateralValue > BigInt(loan.borrowAmount)
        ? currentCollateralValue - BigInt(loan.borrowAmount)
        : 0n
      : undefined;

  return (
    <TableRow className={`hover:bg-zinc-100 ${selectedLoanId === loan.id ? "bg-zinc-100" : ""}`}>
      <TableCell className="whitespace-nowrap px-3 py-2">
        {loan.chainId in JB_CHAINS ? (
          <ChainLogo chainId={loan.chainId as JBChainId} width={15} height={15} standalone />
        ) : (
          <span>{loan.chainId}</span>
        )}
      </TableCell>
      <TableCell className="text-left px-3 py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="whitespace-nowrap">
              {baseTokenDecimals !== undefined ? (
                <TokenAmount
                  value={BigInt(loan.borrowAmount)}
                  decimals={baseTokenDecimals}
                  symbol={baseTokenSymbol}
                />
              ) : pending ? (
                "…"
              ) : (
                "Unavailable"
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent>Loan ID: {loan.id?.toString() ?? "Unavailable"}</TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell className="text-left px-3 py-2">
        <span className="whitespace-nowrap">
          <TokenAmount
            value={BigInt(loan.collateral)}
            decimals={projectTokenDecimals}
            symbol={tokenSymbol}
          />
        </span>
      </TableCell>
      <TableCell className="text-left px-3 py-2">
        <span className="whitespace-nowrap">
          {baseTokenDecimals !== undefined && headroom !== undefined ? (
            <TokenAmount value={headroom} decimals={baseTokenDecimals} symbol={baseTokenSymbol} />
          ) : pending ? (
            "…"
          ) : (
            "Unavailable"
          )}
        </span>
      </TableCell>
      <TableCell className="text-left px-3 py-2">
        <span className="whitespace-nowrap text-gray-700">
          {formatSeconds(Math.max(0, loan.prepaidDuration - (now - Number(loan.createdAt))))}
        </span>
      </TableCell>
      <TableCell className="sticky right-0 bg-melon-50 text-center px-3 py-2">
        {!sourceReady && (
          <div className="mb-1 text-xs text-gray-600">
            {pending ? (
              "Checking loan token…"
            ) : (
              <>
                Loan token context unavailable.{" "}
                <button type="button" className="underline" onClick={() => void retry()}>
                  Retry
                </button>
              </>
            )}
          </div>
        )}
        <div className="flex gap-1 justify-center">
          <Button
            size="sm"
            disabled={!sourceReady}
            title={!sourceReady ? "Waiting for this loan’s source token context." : undefined}
            onClick={() => onSelectLoan?.(loan.id, Number(loan.chainId), Number(loan.projectId))}
            className="text-xs px-2 py-1 bg-teal-500 text-melon-950 hover:bg-teal-600"
          >
            Repay
          </Button>
          {onReallocateLoan && (
            <Button
              size="sm"
              disabled={!sourceReady}
              title={!sourceReady ? "Waiting for this loan’s source token context." : undefined}
              onClick={() => onReallocateLoan(loan)}
              className="text-xs px-2 py-1 bg-teal-500 text-melon-950 hover:bg-teal-600"
            >
              Refinance
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * Whether a loan belongs to this revnet. V6 project ids are a per-chain namespace, so
 * membership is the (chainId, projectId) PAIR — a bare id match would also admit a
 * different revnet's loan whose chain-local id happens to collide.
 */
export function isLoanForRevnet(
  loan: { chainId: number | string; projectId: number | string },
  projects: Array<Pick<Project, "projectId" | "chainId">>,
) {
  return projects.some(
    (project) =>
      Number(project.chainId) === Number(loan.chainId) &&
      Number(project.projectId) === Number(loan.projectId),
  );
}

export function LoanDetailsTable({
  revnetId,
  address,
  onSelectLoan,
  onReallocateLoan,
  tokenSymbol,
  title,
  selectedLoanId,
  projects,
}: {
  revnetId: bigint;
  address: string;
  onSelectLoan?: (loanId: string, chainId: number, projectId: number) => void;
  onReallocateLoan?: (loan: any) => void;
  tokenSymbol: string;
  title?: string;
  selectedLoanId?: string;
  projects: Array<LoanTokenProject & Pick<Project, "chainId" | "projectId">>;
}) {
  const currentChainId = useJBChainId();

  // Get project data to find sucker group ID
  const { data: projectData } = useBendystrawQuery(
    ProjectOperation,
    {
      chainId: Number(currentChainId),
      projectId: Number(revnetId),
      version: 6,
    },
    {
      enabled: !!currentChainId && !!revnetId,
      pollInterval: 10000,
    },
  );

  const suckerGroupId = projectData?.project?.suckerGroupId;

  // Get sucker group data for token mapping
  const { data: suckerGroupData } = useBendystrawQuery(
    SuckerGroupOperation,
    {
      id: suckerGroupId ?? "",
    },
    {
      enabled: !!suckerGroupId,
      pollInterval: 10000,
      chainId: Number(currentChainId),
    },
  );

  // Every loan the user owns, paged to completion: a single page would silently drop rows
  // for an account past the indexer's default page size, and the filter below would then
  // show an arbitrary subset of this revnet's loans as if it were all of them.
  const { data: loans } = useCompleteLoansByAccount(
    address,
    6,
    Number(currentChainId),
    LOAN_CONSTANTS.POLL_INTERVAL,
  );

  if (!loans) return null;

  const now = Math.floor(Date.now() / 1000);

  // Filter loans to only show those from this revnet's projects
  const filteredLoans = loans.filter((loan) => isLoanForRevnet(loan, projects));

  if (!filteredLoans.length) return null;

  const sortedLoans = [...filteredLoans].sort((a, b) => {
    const timeA = a.prepaidDuration - (now - Number(a.createdAt));
    const timeB = b.prepaidDuration - (now - Number(b.createdAt));
    return timeA - timeB;
  });
  return (
    <>
      {title && <p className="text-md font-semibold mt-6 mb-4 text-black">{title}</p>}
      <div className="border border-zinc-200">
        <div className="flex flex-col">
          <div className="min-w-full">
            <Table containerClassName="max-h-96">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left px-3 py-2">Network</TableHead>
                  <TableHead className="text-left px-3 py-2">Borrowed</TableHead>
                  <TableHead className="text-left px-3 py-2">Tokens backing loan</TableHead>
                  <TableHead className="text-left px-3 py-2">Extra borrowing capacity</TableHead>
                  <TableHead className="text-left px-3 py-2">Repayment cost rises in</TableHead>
                  <TableHead className="sticky right-0 bg-melon-100 text-left px-3 py-2">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedLoans.map((loan) => (
                  <LoanRow
                    key={`${loan.id}-${loan.createdAt}`}
                    loan={loan}
                    tokenSymbol={tokenSymbol}
                    selectedLoanId={selectedLoanId}
                    now={now}
                    onSelectLoan={onSelectLoan}
                    onReallocateLoan={onReallocateLoan}
                    suckerGroupData={suckerGroupData}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </>
  );
}
