import { chainDisplayName } from "@/app/constants";
import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import { SummaryRow, TxProgress } from "@/components/ui/TxProgress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loanNumberOf } from "@/lib/loanTransactions";
import { SAFE_PROPOSAL_PENDING_LINE, SAFE_PROPOSAL_UNCONFIRMED_LINE } from "@/lib/reviewed-call";
import { JBChainId } from "@bananapus/nana-sdk-core";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { ImportantInfo } from "./ImportantInfo";
import { LoanFeeChart } from "./LoanFeeChart";
import { SimulatedLoanCard } from "./SimulatedLoanCard";
import { useBorrowDialog, type LoanStatus, type SelectedLoan } from "./hooks/useBorrowDialog";

const REALLOCATE_STATUS_TEXT: Record<LoanStatus, string> = {
  idle: "",
  checking: "Checking permissions...",
  "granting-permission": "Granting permission...",
  "waiting-signature": "Waiting for wallet confirmation...",
  pending: "Refinancing loan...",
  proposed: SAFE_PROPOSAL_PENDING_LINE,
  "reallocation-pending": "Refinancing loan...",
  success: "Loan refinanced.",
  "safe-unconfirmed": SAFE_PROPOSAL_UNCONFIRMED_LINE,
  error: "The loan could not be refinanced.",
};

export function ReallocateDialog({
  projectId,
  tokenSymbol,
  selectedLoan,
  children,
  open,
  onOpenChange,
}: {
  projectId: bigint;
  tokenSymbol: string;
  selectedLoan: SelectedLoan;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const reallocateDialog = useBorrowDialog({
    projectId,
    selectedLoan,
    defaultTab: "borrow",
  });
  const [review, setReview] = useState(false);

  const {
    isDialogOpen,
    showChart,
    showInfo,
    borrowStatus,
    grantsPermission,
    collateralAmount,
    cashOutChainId,
    prepaidPercent,
    grossBorrowedNative,
    loading,
    projectTokenDecimals,
    totalFixedFees,
    newLoanFeeData,
    displayYears,
    displayMonths,
    newLoanBorrowableAmount,
    minimumBorrowAmountPreview,
    collateralCountToTransfer,
    handleOpenChange,
    handleBorrow,
    setCollateralAmount,
    setPrepaidPercent,
    setShowChart,
    setShowInfo,
    balances,
    selectedChainTokenSymbol,
    tokenConfigForChain,
    loanSourceLine,
    loanSourceBlocked,
    loanSourcePending,
  } = reallocateDialog;

  // Get the borrowable amount for the specific loan's chain
  const loanChainBalance = balances?.find((b) => b.chainId === Number(selectedLoan?.chainId));

  const borrowableAmount = loanChainBalance?.balance.value ?? 0n;
  const borrowableAmountFormatted = formatUnits(borrowableAmount, projectTokenDecimals).replace(
    /\.?0+$/,
    "",
  );

  // Set default collateral amount when dialog opens
  useEffect(() => {
    const isOpen = open !== undefined ? open : isDialogOpen;
    if (isOpen && Number(borrowableAmountFormatted) > 0) {
      setCollateralAmount("0", "auto");
    }
  }, [open, isDialogOpen, borrowableAmountFormatted, setCollateralAmount]);

  // Pre-populate with existing loan data
  const existingCollateral = selectedLoan
    ? Number(formatUnits(BigInt(selectedLoan.collateral), projectTokenDecimals))
    : 0;

  // Get the correct base token configuration for the loan's chain
  const loanChainTokenConfig = selectedLoan?.chainId
    ? tokenConfigForChain(selectedLoan.chainId)
    : null;
  // The loans contract's own context for the loan's source token, read onchain; undefined
  // while it loads or fails, never a guessed decimal.
  const baseTokenDecimals = loanChainTokenConfig?.decimals;
  const existingBorrowed =
    selectedLoan && baseTokenDecimals !== undefined
      ? Number(formatUnits(BigInt(selectedLoan.borrowAmount), baseTokenDecimals))
      : undefined;

  // Use provided open state or internal state
  const dialogOpen = open !== undefined ? open : isDialogOpen;
  const handleDialogOpenChange = onOpenChange || handleOpenChange;

  // No timed close on success: terminal loan statuses persist until the user closes the
  // dialog (the convention `useBorrowDialog` states and implements), so the reallocation
  // result and its explorer link stay readable.

  // Get the actual collateral amount that can be transferred (in project token)
  const collateralToTransfer = Number(formatUnits(collateralCountToTransfer, projectTokenDecimals));

  // Calculate the new loan simulation values. Both terms must be PROJECT-token amounts: the loan's
  // headroom is denominated in the source token, and `collateralCountToTransfer` is its project-token
  // equivalent (converted with exact integer math upstream). Adding the raw source-token headroom to
  // the user's project-token input would sum two different units under one symbol.
  const additionalCollateral = Number(collateralAmount || 0);
  const newLoanCollateral = collateralToTransfer + additionalCollateral;

  const busy =
    loading || ["checking", "granting-permission", "waiting-signature"].includes(borrowStatus);
  const statusText = REALLOCATE_STATUS_TEXT[borrowStatus];

  useEffect(() => {
    if (["pending", "proposed", "reallocation-pending", "success"].includes(borrowStatus))
      setReview(false);
  }, [borrowStatus]);

  const refinanceContext = cashOutChainId
    ? [
        {
          label: "Loan",
          value: `#${selectedLoan ? loanNumberOf(selectedLoan.id) : ""} on ${chainDisplayName(Number(cashOutChainId) as JBChainId)}`,
          note: "The remaining debt gets a new loan number",
        },
        {
          label: "Extra tokens used",
          value: `${collateralAmount || "0"} ${tokenSymbol}`,
          note: `Plus ${collateralToTransfer.toFixed(6)} ${tokenSymbol} moved from the existing loan`,
        },
        {
          label: "New loan borrows",
          value: `~${
            newLoanBorrowableAmount && baseTokenDecimals !== undefined
              ? Number(formatUnits(newLoanBorrowableAmount, baseTokenDecimals)).toFixed(8)
              : "0"
          } ${selectedChainTokenSymbol}`,
          strong: true,
          ...(minimumBorrowAmountPreview !== undefined && baseTokenDecimals !== undefined
            ? {
                note: `At least ${Number(formatUnits(minimumBorrowAmountPreview, baseTokenDecimals)).toFixed(8)} ${selectedChainTokenSymbol}; the contract enforces this minimum`,
              }
            : {}),
        },
        { label: "Prepaid fee", value: `${prepaidPercent}%` },
      ]
    : [];

  return (
    <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Refinance loan</DialogTitle>
          <DialogDescription>
            If the tokens backing your loan can support more borrowing, refinance to borrow the
            extra in a new loan. The original debt keeps its terms.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Current loan */}
          <div>
            <h3 className="text-sm font-medium text-black">Current loan</h3>
            <div className="mt-1 grid grid-cols-2 gap-3 border border-melon-300 p-3">
              <SummaryRow label="Tokens backing loan">
                {existingCollateral.toFixed(6)} {tokenSymbol}
              </SummaryRow>
              <SummaryRow label="Borrowed">
                {existingBorrowed !== undefined ? existingBorrowed.toFixed(6) : "…"}{" "}
                {selectedChainTokenSymbol}
              </SummaryRow>
              <SummaryRow label="Loan number to replace">
                {selectedLoan ? loanNumberOf(selectedLoan.id).toString() : null}
              </SummaryRow>
              <SummaryRow label="Network">
                {selectedLoan ? (
                  <span className="flex items-center gap-2">
                    <ChainLogo chainId={selectedLoan.chainId as JBChainId} />
                    <span>{chainDisplayName(selectedLoan.chainId as JBChainId)}</span>
                  </span>
                ) : null}
              </SummaryRow>
            </div>
          </div>

          {/* Additional Collateral Input */}
          {collateralToTransfer > 0 && (
            <div>
              {Number(borrowableAmountFormatted) > 0 ? null : (
                <div className="text-sm text-red-600 mb-2">
                  No extra {tokenSymbol} in your wallet on this network
                </div>
              )}
              <div className="mb-4 grid grid-cols-2 gap-3 border border-melon-300 p-3">
                {Number(borrowableAmountFormatted) > 0 ? (
                  <SummaryRow label="Your balance on this network">
                    {Number(borrowableAmountFormatted).toFixed(6)} {tokenSymbol}
                  </SummaryRow>
                ) : null}
                <SummaryRow label="Tokens available to back the new loan">
                  {collateralToTransfer > 0 ? collateralToTransfer.toFixed(6) : "0.000000"}{" "}
                  {tokenSymbol}
                </SummaryRow>
                <SummaryRow label="New loan can borrow">
                  {newLoanBorrowableAmount && baseTokenDecimals !== undefined
                    ? Number(formatUnits(newLoanBorrowableAmount, baseTokenDecimals)).toFixed(8)
                    : "0.000000"}{" "}
                  {selectedChainTokenSymbol}
                </SummaryRow>
                <SummaryRow label="Minimum borrowed">
                  {minimumBorrowAmountPreview !== undefined && baseTokenDecimals !== undefined
                    ? Number(formatUnits(minimumBorrowAmountPreview, baseTokenDecimals)).toFixed(8)
                    : "Unavailable"}{" "}
                  {selectedChainTokenSymbol}
                </SummaryRow>
              </div>
              <Label
                htmlFor="additional-collateral"
                className="block text-gray-700 text-sm font-bold mb-2"
              >
                How much extra {tokenSymbol} do you want to use for the new loan?
              </Label>
              <Input
                id="additional-collateral"
                type="number"
                step="0.0001"
                value={collateralAmount}
                onChange={(e) => {
                  const value = e.target.value;

                  // Allow empty input for clearing
                  if (value === "") {
                    setCollateralAmount("");
                    return;
                  }

                  // Limit decimal places to 8 digits
                  const decimalIndex = value.indexOf(".");
                  if (decimalIndex !== -1 && value.length - decimalIndex - 1 > 8) {
                    return; // Don't update if too many decimal places
                  }

                  const numValue = Number(value);

                  // Only validate max if it's a valid number
                  if (!isNaN(numValue)) {
                    const maxValue = Number(borrowableAmountFormatted);

                    // Prevent entering more than available balance
                    if (numValue > maxValue) {
                      setCollateralAmount(maxValue.toFixed(6), "max");
                    } else {
                      setCollateralAmount(value);
                    }
                  } else {
                    // Allow partial input (like just a decimal point)
                    setCollateralAmount(value);
                  }
                }}
                placeholder="Enter additional amount"
                className="mb-2"
                max={borrowableAmountFormatted}
              />
              <div className="flex flex-wrap gap-1 mt-1 mb-2">
                <button
                  type="button"
                  onClick={() => {
                    setCollateralAmount("0", "none");
                  }}
                  className="h-10 px-3 text-sm text-zinc-700 border border-zinc-300 bg-white hover:bg-zinc-100"
                >
                  0
                </button>
                {[10, 25, 50].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => {
                      const value = Number(borrowableAmountFormatted) * (pct / 100);
                      setCollateralAmount(value.toString().replace(/\.?0+$/, ""), `${pct}%`);
                    }}
                    className="h-10 px-3 text-sm text-zinc-700 border border-zinc-300 bg-white hover:bg-zinc-100"
                  >
                    {pct}%
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setCollateralAmount(borrowableAmountFormatted, "max");
                  }}
                  className="h-10 px-3 text-sm text-zinc-700 border border-zinc-300 bg-white hover:bg-zinc-100"
                >
                  Max
                </button>
              </div>
            </div>
          )}

          {/* Warning when nothing to reallocate */}
          {collateralToTransfer <= 0 && (
            <div className="text-sm text-amber-600 mb-2 font-medium">
              The tokens backing this loan cannot support another loan yet.
            </div>
          )}

          {/* New Loan Preview */}
          {collateralToTransfer > 0 && (
            <SimulatedLoanCard
              collateralAmount={newLoanCollateral.toFixed(8)}
              tokenSymbol={selectedChainTokenSymbol ?? "…"}
              collateralTokenSymbol={tokenSymbol}
              amountBorrowed={
                newLoanBorrowableAmount && baseTokenDecimals !== undefined
                  ? Number(formatUnits(newLoanBorrowableAmount, baseTokenDecimals))
                  : 0
              }
              prepaidPercent={prepaidPercent}
              feeData={newLoanFeeData || []}
              totalFixedFees={totalFixedFees}
            />
          )}

          {/* Fee Structure Chart */}
          {collateralToTransfer > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowChart(!showChart)}
                className="flex items-center gap-2 text-left text-gray-700 text-sm font-bold"
              >
                <span>New loan repayment cost</span>
                <span
                  className={`transform transition-transform ${showChart ? "rotate-90" : "rotate-0"}`}
                >
                  ▶
                </span>
              </button>
              {showChart && (
                <div>
                  <p className="text-sm text-zinc-600 mb-4">
                    The new loan uses {newLoanCollateral.toFixed(6)} {tokenSymbol}:{" "}
                    {collateralToTransfer.toFixed(6)} from the existing loan and{" "}
                    {additionalCollateral.toFixed(6)} from your wallet. You can borrow{" "}
                    {newLoanBorrowableAmount && baseTokenDecimals !== undefined
                      ? Number(formatUnits(newLoanBorrowableAmount, baseTokenDecimals)).toFixed(8)
                      : "0.000000"}{" "}
                    {selectedChainTokenSymbol}.
                  </p>
                  <LoanFeeChart
                    prepaidPercent={prepaidPercent}
                    setPrepaidPercent={setPrepaidPercent}
                    feeData={newLoanFeeData}
                    grossBorrowedNative={grossBorrowedNative}
                    collateralAmount={newLoanCollateral.toFixed(8)}
                    tokenSymbol={selectedChainTokenSymbol ?? "…"}
                    collateralTokenSymbol={tokenSymbol}
                    displayYears={displayYears}
                    displayMonths={displayMonths}
                  />
                </div>
              )}
            </>
          )}

          {/* What happens to the tokens */}
          {collateralToTransfer > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowInfo(!showInfo)}
                className="flex items-center gap-2 text-left text-gray-700 text-sm font-bold"
              >
                <span>What happens to your tokens</span>
                <span
                  className={`transform transition-transform ${showInfo ? "rotate-90" : "rotate-0"}`}
                >
                  ▶
                </span>
              </button>
              {showInfo && (
                <ImportantInfo collateralAmount={collateralAmount} tokenSymbol={tokenSymbol} />
              )}
            </>
          )}

          {/* Status and Action */}
          {loanSourceLine && !review && !(collateralToTransfer > 0) ? (
            <p className="text-sm text-zinc-600">{loanSourceLine}</p>
          ) : null}
          {collateralToTransfer > 0 && (
            <DialogFooter className="flex flex-row items-center justify-between w-full gap-4">
              <div className="flex-1 text-left">
                {statusText ? <p className="text-sm text-zinc-600">{statusText}</p> : null}
                {loanSourceLine && !review ? (
                  <p className="text-sm text-zinc-600">{loanSourceLine}</p>
                ) : null}
              </div>
              <ButtonWithWallet
                targetChainId={cashOutChainId ? (Number(cashOutChainId) as JBChainId) : undefined}
                loading={loading || loanSourcePending}
                onClick={() => setReview(true)}
                disabled={
                  loanSourceBlocked ||
                  !collateralAmount ||
                  Number(collateralAmount) > Number(borrowableAmountFormatted) ||
                  Number(collateralAmount) < 0 ||
                  minimumBorrowAmountPreview === undefined
                }
                className="bg-teal-500 text-melon-950 hover:bg-teal-600"
              >
                Refinance loan
              </ButtonWithWallet>
            </DialogFooter>
          )}
          {review && cashOutChainId ? (
            <TxProgress
              open
              onClose={() => setReview(false)}
              title="Confirm refinancing"
              steps={[
                ...(grantsPermission
                  ? [
                      {
                        key: "permission",
                        title: "Let the loan contract remove your tokens from supply",
                        detail: "Repayment creates the tokens again and returns them to you.",
                      },
                    ]
                  : []),
                { key: "borrow", title: "Refinance the loan" },
              ]}
              activeIndex={
                borrowStatus === "granting-permission" ? 0 : busy ? (grantsPermission ? 1 : 0) : -1
              }
              start={async () => {
                if ((await handleBorrow(refinanceContext)) === "closed") setReview(false);
              }}
              busy={busy}
              status={busy || borrowStatus === "safe-unconfirmed" ? statusText : null}
              error={loanSourceLine ?? (borrowStatus.startsWith("error") ? statusText : null)}
              rows={refinanceContext}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
