import { chainDisplayName } from "@/app/constants";
import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
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
import { JBChainId, NATIVE_TOKEN_DECIMALS } from "@bananapus/nana-sdk-core";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { ImportantInfo } from "./ImportantInfo";
import { LoanFeeChart } from "./LoanFeeChart";
import { SimulatedLoanCard } from "./SimulatedLoanCard";
import { useBorrowDialog, type SelectedLoan } from "./hooks/useBorrowDialog";

const REALLOCATE_STATUS_TEXT: Record<string, string> = {
  checking: "Checking permissions...",
  "granting-permission": "Granting permission...",
  "permission-granted": "Permission granted. Reallocating loan...",
  "waiting-signature": "Waiting for wallet confirmation...",
  pending: "Reallocating loan...",
  "reallocation-pending": "Reallocating loan...",
  success: "Loan reallocated successfully!",
  "error-permission-denied": "Permission was not granted. Please approve to proceed.",
  "error-loan-canceled": "Loan reallocation was canceled.",
  error: "Something went wrong during loan reallocation.",
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
      setCollateralAmount("0");
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
  // `??`, not `||`: a legitimate 0-decimal accounting token must not be read as 18.
  const baseTokenDecimals = loanChainTokenConfig?.decimals ?? NATIVE_TOKEN_DECIMALS;
  const existingBorrowed = selectedLoan
    ? Number(formatUnits(BigInt(selectedLoan.borrowAmount), baseTokenDecimals))
    : 0;

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
    loading ||
    ["checking", "granting-permission", "permission-granted", "waiting-signature"].includes(
      borrowStatus,
    );
  const statusText = REALLOCATE_STATUS_TEXT[borrowStatus];

  useEffect(() => {
    if (["pending", "reallocation-pending", "success"].includes(borrowStatus)) setReview(false);
  }, [borrowStatus]);

  return (
    <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reallocate Loan</DialogTitle>
          <DialogDescription>
            Carve out your token's upside: maintain your original loan terms & generate a second
            loan that pays you cash out based on your collateral's gain.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Current Loan Details */}
          <div className="bg-zinc-50 p-4 rounded-lg">
            <h3 className="font-semibold text-sm mb-3">Current Loan Details</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-zinc-600">Current Collateral:</span>
                <div className="font-medium">
                  {existingCollateral.toFixed(6)} {tokenSymbol}
                </div>
              </div>
              <div>
                <span className="text-zinc-600">Currently Borrowed:</span>
                <div className="font-medium">
                  {existingBorrowed.toFixed(6)} {selectedChainTokenSymbol}
                </div>
              </div>
              <div>
                <span className="text-zinc-600">Loan ID will be burned and replaced:</span>
                <div className="font-medium">{selectedLoan?.id}</div>
              </div>
              <div>
                <span className="text-zinc-600">Chain:</span>
                <div className="font-medium">{selectedLoan?.chainId}</div>
              </div>
            </div>
          </div>

          {/* Additional Collateral Input */}
          {collateralToTransfer > 0 && (
            <div>
              {Number(borrowableAmountFormatted) > 0 ? (
                <div className="text-sm text-zinc-600 mb-2">
                  Your balance on this chain: {Number(borrowableAmountFormatted).toFixed(6)}{" "}
                  {tokenSymbol}
                </div>
              ) : (
                <div className="text-sm text-red-600 mb-2">
                  No {tokenSymbol} available on this chain for reallocation
                </div>
              )}
              <div className="text-sm text-zinc-600 mb-2">
                Borrowable amount for the new loan:{" "}
                {newLoanBorrowableAmount
                  ? Number(formatUnits(newLoanBorrowableAmount, baseTokenDecimals)).toFixed(8)
                  : "0.000000"}{" "}
                {selectedChainTokenSymbol}
              </div>
              <div className="text-sm text-zinc-600 mb-2">
                Protected minimum (1% tolerance):{" "}
                {minimumBorrowAmountPreview !== undefined
                  ? Number(formatUnits(minimumBorrowAmountPreview, baseTokenDecimals)).toFixed(8)
                  : "Unavailable"}{" "}
                {selectedChainTokenSymbol}
              </div>
              <div className="text-sm text-zinc-600 mb-2">
                Head room to reallocate:{" "}
                {collateralToTransfer > 0 ? collateralToTransfer.toFixed(6) : "0.000000"}{" "}
                {tokenSymbol}
              </div>
              <Label
                htmlFor="additional-collateral"
                className="block text-gray-700 text-sm font-bold mb-2"
              >
                How much additional {tokenSymbol} do you want to add as collateral for the new loan?
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
                      setCollateralAmount(maxValue.toFixed(6));
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
              <div className="flex gap-1 mt-1 mb-2">
                <div className="flex gap-1 mt-2 mb-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCollateralAmount("0");
                    }}
                    className="h-10 px-3 text-sm text-zinc-700 border border-zinc-300 rounded-md bg-white hover:bg-zinc-100 w-16"
                  >
                    0
                  </button>
                  {[10, 25, 50].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => {
                        const value = Number(borrowableAmountFormatted) * (pct / 100);
                        setCollateralAmount(value.toString().replace(/\.?0+$/, ""));
                      }}
                      className="h-10 px-3 text-sm text-zinc-700 border border-zinc-300 rounded-md bg-white hover:bg-zinc-100 w-16"
                    >
                      {pct}%
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setCollateralAmount(borrowableAmountFormatted);
                    }}
                    className="h-10 px-3 text-sm text-zinc-700 border border-zinc-300 rounded-md bg-white hover:bg-zinc-100 w-16"
                  >
                    Max
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Warning when nothing to reallocate */}
          {collateralToTransfer <= 0 && (
            <div className="text-sm text-amber-600 mb-2 font-medium">
              ⚠️ Nothing to reallocate. Consider taking out a new loan.
            </div>
          )}

          {/* New Loan Preview */}
          {collateralToTransfer > 0 && (
            <SimulatedLoanCard
              collateralAmount={newLoanCollateral.toFixed(8)}
              tokenSymbol={selectedChainTokenSymbol ?? "…"}
              collateralTokenSymbol={tokenSymbol}
              amountBorrowed={
                newLoanBorrowableAmount
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
                <span>Fee Structure for New Loan</span>
                <span
                  className={`transform transition-transform ${showChart ? "rotate-90" : "rotate-0"}`}
                >
                  ▶
                </span>
              </button>
              {showChart && (
                <div className="bg-zinc-50 p-4 rounded-lg">
                  <p className="text-sm text-zinc-600 mb-4">
                    This shows the fee structure for the new loan that will be created with{" "}
                    {newLoanCollateral.toFixed(6)} {tokenSymbol} collateral (appreciation:{" "}
                    {collateralToTransfer.toFixed(6)} + additional:{" "}
                    {additionalCollateral.toFixed(6)}
                    ), allowing you to borrow{" "}
                    {newLoanBorrowableAmount
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

          {/* Important Info */}
          {collateralToTransfer > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowInfo(!showInfo)}
                className="flex items-center gap-2 text-left text-gray-700 text-sm font-bold"
              >
                <span>Important Info</span>
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
          {collateralToTransfer > 0 && (
            <DialogFooter className="flex flex-row items-center justify-between w-full gap-4">
              <div className="flex-1 text-left">
                {statusText ? <p className="text-sm text-zinc-600">{statusText}</p> : null}
              </div>
              <ButtonWithWallet
                targetChainId={cashOutChainId ? (Number(cashOutChainId) as JBChainId) : undefined}
                loading={loading}
                onClick={() => setReview(true)}
                disabled={
                  !collateralAmount ||
                  Number(collateralAmount) > Number(borrowableAmountFormatted) ||
                  Number(collateralAmount) < 0 ||
                  minimumBorrowAmountPreview === undefined
                }
                className="bg-teal-500 text-melon-950 hover:bg-teal-600"
              >
                Reallocate loan
              </ButtonWithWallet>
            </DialogFooter>
          )}
          {review && cashOutChainId ? (
            <TxConfirmDialog
              open
              onOpenChange={(open) => {
                if (!open) setReview(false);
              }}
              title="Confirm reallocation"
              chainId={Number(cashOutChainId) as JBChainId}
              steps={[
                ...(grantsPermission
                  ? [
                      {
                        key: "permission",
                        title: "Let REVLoans burn your collateral",
                        detail: "A one-off permission so the loan can hold your tokens.",
                      },
                    ]
                  : []),
                { key: "borrow", title: "Reallocate the loan" },
              ]}
              activeIndex={
                borrowStatus === "granting-permission" ? 0 : busy ? (grantsPermission ? 1 : 0) : -1
              }
              action="Reallocate loan"
              onConfirm={() => void handleBorrow()}
              busy={busy}
              status={busy ? statusText : null}
              error={borrowStatus.startsWith("error") ? statusText : null}
            >
              <SummaryRow label="Loan">
                #{selectedLoan?.id} on {chainDisplayName(Number(cashOutChainId) as JBChainId)}
                <span className="block text-xs text-zinc-500">Replaced by a new loan id</span>
              </SummaryRow>
              <SummaryRow label="Adds collateral">
                {collateralAmount || "0"} {tokenSymbol}
                <span className="block text-xs text-zinc-500">
                  Plus {collateralToTransfer.toFixed(6)} {tokenSymbol} of headroom moved over
                </span>
              </SummaryRow>
              <SummaryRow label="New loan borrows">
                ~
                {newLoanBorrowableAmount
                  ? Number(formatUnits(newLoanBorrowableAmount, baseTokenDecimals)).toFixed(8)
                  : "0"}{" "}
                {selectedChainTokenSymbol}
                {minimumBorrowAmountPreview !== undefined ? (
                  <span className="block text-xs text-zinc-500">
                    At least{" "}
                    {Number(formatUnits(minimumBorrowAmountPreview, baseTokenDecimals)).toFixed(8)}{" "}
                    {selectedChainTokenSymbol}, enforced onchain
                  </span>
                ) : null}
              </SummaryRow>
              <SummaryRow label="Prepaid fee">{prepaidPercent}%</SummaryRow>
            </TxConfirmDialog>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
