import { chainDisplayName } from "@/app/constants";
import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { ChainLogo } from "@/components/ChainLogo";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { getTokenSymbolFromAddress } from "@/lib/tokenUtils";
import { JBChainId, NATIVE_TOKEN_DECIMALS } from "@bananapus/nana-sdk-core";
import { PropsWithChildren, useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { ImportantInfo } from "./ImportantInfo";
import { LoanFeeChart } from "./LoanFeeChart";
import { SimulatedLoanCard } from "./SimulatedLoanCard";
import { useBorrowDialog } from "./hooks/useBorrowDialog";

interface Props {
  projectId: bigint;
  tokenSymbol: string;
}

const BORROW_STATUS_TEXT: Record<string, string> = {
  checking: "Checking permissions...",
  "granting-permission": "Granting permission...",
  "permission-granted": "Permission granted. Creating loan...",
  "waiting-signature": "Waiting for wallet confirmation...",
  pending: "Creating loan...",
  "reallocation-pending": "Adjusting loan...",
  success: "Loan created successfully!",
  "error-permission-denied": "Permission was not granted. Please approve to proceed.",
  "error-loan-canceled": "Loan creation was canceled.",
  error: "Something went wrong during loan creation.",
};

export function BorrowDialog(props: PropsWithChildren<Props>) {
  const { projectId, tokenSymbol, children } = props;
  const borrowDialog = useBorrowDialog({ projectId });
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
    internalSelectedLoan,
    loading,
    projectTokenDecimals,
    selectedBalance,
    totalFixedFees,
    feeData,
    displayYears,
    displayMonths,
    estimatedBorrowFromInputOnly,
    minimumBorrowAmountPreview,
    selectedLoanReallocAmount,
    handleOpenChange,
    handleBorrow,
    setCollateralAmount,
    setPrepaidPercent,
    setShowChart,
    setShowInfo,
    setInternalSelectedLoan,
    balances,
    setSelectedChainId,
    setCashOutChainId,
    // ===== PHASE 3: BASE TOKEN CONTEXT =====
    baseToken,
    selectedChainTokenConfig,
    tokenConfigForChain,
  } = borrowDialog;

  // ===== PHASE 3: DYNAMIC TOKEN SYMBOL =====
  // Get the correct token symbol for the selected chain
  const getTokenSymbolForChain = useCallback(
    (targetChainId: number) => {
      // Null config is LOADING — surface no symbol rather than a wrong one.
      const chainTokenConfig = tokenConfigForChain(targetChainId);
      return chainTokenConfig
        ? (chainTokenConfig.symbol ?? getTokenSymbolFromAddress(chainTokenConfig.token))
        : undefined;
    },
    [tokenConfigForChain],
  );

  const selectedChainTokenSymbol = cashOutChainId
    ? getTokenSymbolForChain(Number(cashOutChainId))
    : baseToken?.symbol;

  const selectableBalances = useMemo(
    () => balances?.filter((balance) => balance.balance.value > 0n) ?? [],
    [balances],
  );
  const defaultBalance = selectableBalances[0] ?? balances?.[0];
  const hasOnlyOneProjectChain = balances?.length === 1;

  // Handle chain selection - exactly like RedeemDialog
  const handleChainSelect = useCallback(
    (chainId: string) => {
      const selected = balances?.find((b: any) => b.chainId === Number(chainId));
      if (selected) {
        setSelectedChainId(Number(chainId));
        setCashOutChainId(chainId);
        // Clear, not pre-fill. Pre-filling the FULL balance here contradicted the auto-select
        // effect below, which deliberately leaves the amount empty so that picking a sensible
        // chain does not silently opt the holder into collateralizing everything they hold.
        setCollateralAmount("");
        setInternalSelectedLoan(null);
      }
    },
    [balances, setSelectedChainId, setCashOutChainId, setCollateralAmount, setInternalSelectedLoan],
  );

  // Start on the first chain where the account can collateralize tokens (or
  // the project's only chain when the balance is zero). Keep the amount empty:
  // choosing a sensible chain should not silently opt the holder into using
  // their full balance.
  useEffect(() => {
    if (!isDialogOpen || cashOutChainId || !defaultBalance) return;
    setSelectedChainId(defaultBalance.chainId);
    setCashOutChainId(defaultBalance.chainId.toString());
  }, [isDialogOpen, cashOutChainId, defaultBalance, setSelectedChainId, setCashOutChainId]);

  const maxCollateralAmount = selectedBalance
    ? Number(formatUnits(selectedBalance.balance.value, projectTokenDecimals))
    : 0;

  // Calculate effectiveBorrowableAmount and simulation values
  const effectiveBorrowableAmount =
    internalSelectedLoan && selectedLoanReallocAmount
      ? selectedLoanReallocAmount - BigInt(internalSelectedLoan.borrowAmount)
      : estimatedBorrowFromInputOnly;

  // Use correct decimals for the selected chain. `??`, not `||`: a legitimate
  // 0-decimal accounting token must not be read as 18.
  const tokenDecimals = selectedChainTokenConfig?.decimals ?? NATIVE_TOKEN_DECIMALS;
  const simulatedAmountBorrowed = effectiveBorrowableAmount
    ? Number(formatUnits(effectiveBorrowableAmount, tokenDecimals))
    : 0;

  const busy =
    loading ||
    ["checking", "granting-permission", "permission-granted", "waiting-signature"].includes(
      borrowStatus,
    );
  const statusText = BORROW_STATUS_TEXT[borrowStatus];
  const adjusting =
    !!internalSelectedLoan && !!collateralAmount && !isNaN(Number(collateralAmount));

  useEffect(() => {
    if (["pending", "reallocation-pending", "success"].includes(borrowStatus)) setReview(false);
  }, [borrowStatus]);

  return (
    <Dialog open={isDialogOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New loan</DialogTitle>
        </DialogHeader>
        <div className="mb-5 w-[65%]">
          <span className="text-sm text-black font-medium">Your {tokenSymbol}</span>
          <div className="mt-1 border border-melon-300 p-3 bg-melon-25">
            {balances?.map((balance) => (
              <div key={balance.chainId} className="flex justify-between gap-2">
                {chainDisplayName(balance.chainId as JBChainId)}
                <span className="font-medium">
                  {balance.balance?.format(8)} {tokenSymbol}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Collateral Input Section - Like RedeemDialog */}
        <div className="grid w-full gap-1.5">
          <Label htmlFor="collateral-amount" className="text-zinc-900">
            How much {tokenSymbol} do you want to collateralize?
          </Label>
          <div className="grid grid-cols-7 gap-2">
            <div className="col-span-3">
              {hasOnlyOneProjectChain && cashOutChainId ? (
                <div className="flex h-10 w-full items-center border-2 border-melon-300 bg-melon-25 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <ChainLogo chainId={Number(cashOutChainId) as JBChainId} />
                    <span>{chainDisplayName(Number(cashOutChainId) as JBChainId)}</span>
                  </div>
                </div>
              ) : (
                <Select onValueChange={handleChainSelect} value={cashOutChainId || ""}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select chain">
                      {cashOutChainId && (
                        <div className="flex items-center gap-2">
                          <ChainLogo chainId={Number(cashOutChainId) as JBChainId} />
                          <span>{chainDisplayName(Number(cashOutChainId) as JBChainId)}</span>
                        </div>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {selectableBalances.map((balance) => (
                      <SelectItem value={balance.chainId.toString()} key={balance.chainId}>
                        <div className="flex items-center gap-2">
                          <ChainLogo chainId={balance.chainId as JBChainId} />
                          {chainDisplayName(balance.chainId as JBChainId)}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="col-span-4">
              <div className="relative">
                <Input
                  id="collateral-amount"
                  name="collateral-amount"
                  type="number"
                  step="0.0001"
                  max={maxCollateralAmount}
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
                    const maxValue = maxCollateralAmount;

                    if (isNaN(numValue)) {
                      // Allow partial input (like just a decimal point)
                      setCollateralAmount(value);
                    } else {
                      // Prevent entering more than available balance
                      if (numValue > maxValue) {
                        setCollateralAmount(maxValue.toFixed(8));
                      } else {
                        setCollateralAmount(value);
                      }
                    }
                  }}
                  placeholder={
                    maxCollateralAmount ? maxCollateralAmount.toFixed(8) : "Enter amount"
                  }
                />
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 z-10">
                  <span className="text-zinc-500 sm:text-md">{tokenSymbol}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="col-span-full">
            <div className="flex gap-1 mt-1 mb-2 justify-end">
              {[10, 25, 50, 100].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => {
                    if (!cashOutChainId) {
                      return toast({
                        variant: "warning",
                        description: "Please select a chain first.",
                      });
                    }
                    setCollateralAmount((maxCollateralAmount * (pct / 100)).toFixed(8));
                  }}
                  className="h-10 px-3 text-sm text-zinc-700 border border-zinc-300 rounded-md bg-white hover:bg-zinc-100"
                >
                  {pct === 100 ? "Max" : `${pct}%`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* --- Simulation state for loan preview, including reallocation --- */}
        {collateralAmount && !isNaN(Number(collateralAmount)) && selectedChainTokenSymbol ? (
          <SimulatedLoanCard
            collateralAmount={collateralAmount}
            tokenSymbol={selectedChainTokenSymbol}
            collateralTokenSymbol={tokenSymbol}
            amountBorrowed={simulatedAmountBorrowed}
            prepaidPercent={prepaidPercent}
            feeData={feeData}
            totalFixedFees={totalFixedFees}
          />
        ) : null}
        {minimumBorrowAmountPreview !== undefined && selectedChainTokenConfig ? (
          <div className="border border-melon-300 bg-melon-25 p-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-zinc-600">Protected minimum borrowed</span>
              <span className="font-medium">
                {formatUnits(minimumBorrowAmountPreview, selectedChainTokenConfig.decimals)}{" "}
                {selectedChainTokenSymbol}
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Based on the live contract quote with a 1% safety tolerance; refreshed again before
              submission.
            </p>
          </div>
        ) : null}
        {/* Fee Structure Over Time toggleable chart */}
        <button
          type="button"
          onClick={() => setShowChart(!showChart)}
          className="flex items-center gap-2 text-left text-zinc-700 text-sm font-bold"
        >
          <span>Variable Fee Structure</span>
          <span
            className={`transform transition-transform ${showChart ? "rotate-90" : "rotate-0"}`}
          >
            ▶
          </span>
        </button>
        {showChart && selectedChainTokenSymbol && (
          <LoanFeeChart
            prepaidPercent={prepaidPercent}
            setPrepaidPercent={setPrepaidPercent}
            feeData={feeData}
            grossBorrowedNative={grossBorrowedNative}
            collateralAmount={collateralAmount}
            tokenSymbol={selectedChainTokenSymbol}
            collateralTokenSymbol={tokenSymbol}
            displayYears={displayYears}
            displayMonths={displayMonths}
          />
        )}
        {/* Important Info toggleable section */}
        <button
          type="button"
          onClick={() => setShowInfo(!showInfo)}
          className="flex items-center gap-2 text-left text-zinc-700 text-sm font-bold mb-2"
        >
          <span>Important Info</span>
          <span className={`transform transition-transform ${showInfo ? "rotate-90" : "rotate-0"}`}>
            ▶
          </span>
        </button>
        {showInfo && (
          <ImportantInfo collateralAmount={collateralAmount} tokenSymbol={tokenSymbol} />
        )}
        {/* Borrow Button and Status Message - horizontally aligned */}
        <DialogFooter className="flex items-center justify-between w-full gap-4">
          <div className="flex-1 text-left">
            {statusText ? <p className="text-sm text-zinc-600">{statusText}</p> : null}
          </div>
          {/* Single borrow button for both reallocation and standard borrowing */}
          <ButtonWithWallet
            targetChainId={Number(cashOutChainId) as JBChainId}
            loading={loading}
            disabled={
              !cashOutChainId ||
              !collateralAmount ||
              Number(collateralAmount) <= 0 ||
              minimumBorrowAmountPreview === undefined
            }
            onClick={() => setReview(true)}
            className="bg-teal-500 text-melon-950 hover:bg-teal-600"
          >
            {adjusting ? "Adjust loan" : "Open loan"}
          </ButtonWithWallet>
        </DialogFooter>
        {review && cashOutChainId && selectedChainTokenConfig ? (
          <TxConfirmDialog
            open
            onOpenChange={(open) => {
              if (!open) setReview(false);
            }}
            title={adjusting ? "Confirm loan adjustment" : "Confirm loan"}
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
              { key: "borrow", title: adjusting ? "Adjust the loan" : "Open the loan" },
            ]}
            activeIndex={
              borrowStatus === "granting-permission" ? 0 : busy ? (grantsPermission ? 1 : 0) : -1
            }
            action={adjusting ? "Adjust loan" : "Open loan"}
            onConfirm={() => void handleBorrow()}
            busy={busy}
            status={busy ? statusText : null}
            error={borrowStatus.startsWith("error") ? statusText : null}
          >
            <SummaryRow label="Collateral">
              {collateralAmount} {tokenSymbol}
            </SummaryRow>
            <SummaryRow label="On">
              {chainDisplayName(Number(cashOutChainId) as JBChainId)}
            </SummaryRow>
            <SummaryRow label="Borrows">
              ~{simulatedAmountBorrowed.toFixed(8)} {selectedChainTokenSymbol}
              {minimumBorrowAmountPreview !== undefined ? (
                <span className="block text-xs text-zinc-500">
                  At least{" "}
                  {formatUnits(minimumBorrowAmountPreview, selectedChainTokenConfig.decimals)}{" "}
                  {selectedChainTokenSymbol}, enforced onchain
                </span>
              ) : null}
            </SummaryRow>
            <SummaryRow label="Prepaid fee">{prepaidPercent}%</SummaryRow>
          </TxConfirmDialog>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
