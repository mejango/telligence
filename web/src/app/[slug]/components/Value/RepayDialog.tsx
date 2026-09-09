import { chainDisplayName } from "@/app/constants";
import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonLines } from "@/components/ui/skeleton";
import { SummaryRow, TxConfirmDialog } from "@/components/ui/TxConfirmDialog";
import { useToast } from "@/components/ui/use-toast";
import {
  isSafeProposalPendingError,
  requireOnchainExecution,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { ProjectOperation, SuckerGroupOperation, useBendystrawQuery } from "@/lib/bendystraw";
import { repayCeilingFor, repayPrincipalFor } from "@/lib/loanFees";
import { useJBChainId, useJBTokenContext } from "@/lib/nana/project";
import type { JBChainId } from "@/lib/nana/types";
import { getTokenConfigForChain, getTokenSymbolFromAddress, isNativeToken } from "@/lib/tokenUtils";
import { formatTokenSymbol, formatWalletError } from "@/lib/utils";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import { getRevnetLoanContract, revLoansAbi } from "@bananapus/nana-sdk-core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Address, erc20Abi, formatUnits, parseUnits } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useSimulateContract,
  useWalletClient,
} from "wagmi";

const REPAY_STATUS_TEXT: Record<string, string> = {
  "waiting-signature": "Waiting for wallet confirmation...",
  approving: "Approving token allowance...",
  pending: "Repayment pending...",
  success: "Repayment successful!",
  error: "Something went wrong during repayment.",
};

export function RepayDialog({
  loanId,
  chainId,
  projectId,
  loanProjectId,
  open,
  onOpenChange,
}: {
  loanId: string;
  chainId: JBChainId;
  /** The route chain's project id — only for the sucker-group lookup. */
  projectId: bigint;
  /**
   * The loan's own chain-local project id. V6 project ids are a per-chain namespace, so
   * quotes on the loan's chain must use this, never the route chain's id.
   */
  loanProjectId: bigint;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // ===== STATE =====
  const [collateralToReturn, setCollateralToReturn] = useState("");
  const [repayStatus, setRepayStatus] = useState("idle");
  const [repayTxHash, setRepayTxHash] = useState<`0x${string}` | undefined>();
  const [collateralError, setCollateralError] = useState<string>("");
  const [review, setReview] = useState<"approve" | "repay" | null>(null);

  // ===== HOOKS =====
  const { address: userAddress } = useAccount();
  const { toast } = useToast();
  const { token } = useJBTokenContext();
  const tokenSymbol = formatTokenSymbol(token);
  const projectTokenDecimals = token?.data?.decimals ?? 18;
  const currentChainId = useJBChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  // Check allowance for non-ETH base tokens before simulation
  const [allowanceChecked, setAllowanceChecked] = useState(false);
  const [hasSufficientAllowance, setHasSufficientAllowance] = useState(true);
  const [allowanceError, setAllowanceError] = useState<string>("");

  // Fetch loan data first to get the project ID
  const { data: loanData, isLoading: isLoadingLoan } = useReadContract({
    abi: revLoansAbi,
    functionName: "loanOf",
    address: getRevnetLoanContract(6, chainId),
    chainId,
    args: [BigInt(loanId)],
  });

  // `repayLoan` adds the accrued source fee ON TOP of the principal and reverts when the total
  // exceeds `maxRepayBorrowAmount` (REVLoans.sol:984-987, :1004-1008), so the principal alone is
  // not a ceiling once the prepaid window lapses — it's the one amount guaranteed to be too small.
  const { data: accruedSourceFee } = useReadContract({
    abi: revLoansAbi,
    functionName: "determineSourceFeeAmount",
    address: getRevnetLoanContract(6, chainId),
    chainId,
    args: loanData ? [loanData, loanData.amount] : undefined,
    query: { enabled: !!loanData },
  });

  // The ceiling sent as `maxRepayBorrowAmount`. The fee keeps accruing between this read and
  // inclusion, so pad it: the fee ramps linearly to 100% over the 10-year liquidation window
  // (REVLoansSourceFees.sol), which makes 0.1% of principal worth ~3.6 days of accrual. The
  // contract refunds whatever isn't used (REVLoans.sol:1023-1031), so overshooting is free
  // beyond needing the balance and allowance to cover it.
  const repayCeiling = useMemo(() => {
    if (!loanData || accruedSourceFee === undefined) return undefined;
    return repayCeilingFor(loanData.amount, accruedSourceFee);
  }, [loanData, accruedSourceFee]);

  // Get project data to find sucker group ID using the project ID
  const { data: projectData } = useBendystrawQuery(
    ProjectOperation,
    { chainId: Number(currentChainId), projectId: Number(projectId), version: 6 },
    { enabled: !!currentChainId && !!projectId, pollInterval: 10000 },
  );

  const suckerGroupId = projectData?.project?.suckerGroupId;

  // Get sucker group data for token mapping
  const { data: suckerGroupData } = useBendystrawQuery(
    SuckerGroupOperation,
    { id: suckerGroupId ?? "" },
    { enabled: !!suckerGroupId, pollInterval: 10000, chainId: Number(currentChainId) },
  );

  // Token configuration for this loan's chain. Null means LOADING/unknown —
  // never assume ETH: gate submission and show skeletons until it resolves.
  const chainTokenConfig = useMemo(
    () => getTokenConfigForChain(suckerGroupData, chainId),
    [suckerGroupData, chainId],
  );
  // Native-vs-ERC-20 is decided by the accounting token ADDRESS; symbols are
  // display-only. Undefined while the config is unresolved.
  const isNativeBase = chainTokenConfig ? isNativeToken(chainTokenConfig.token) : undefined;
  const baseTokenSymbol = chainTokenConfig
    ? (chainTokenConfig.symbol ?? getTokenSymbolFromAddress(chainTokenConfig.token))
    : undefined;
  const baseTokenDecimals = chainTokenConfig?.decimals ?? 18;

  // Repay loan hook
  const { writeContractAsync: repayLoanAsync, isPending: isRepaying } = useWriteContract();

  // Transaction status tracking
  const { isLoading: isRepayTxLoading, isSuccess: isRepaySuccess } = useWaitForTransactionReceipt({
    hash: repayTxHash,
  });

  // ===== HELPER FUNCTIONS =====
  const formatCollateralAmount = useCallback(
    (amountWei: bigint) => {
      const amountTokens = formatUnits(amountWei, projectTokenDecimals);
      return Number(amountTokens)
        .toFixed(6)
        .replace(/\.?0+$/, "");
    },
    [projectTokenDecimals],
  );

  const calculateCollateralAmount = (input: string, maxCollateral: bigint): bigint => {
    try {
      const userInputWei = parseUnits(input, projectTokenDecimals);
      return userInputWei >= maxCollateral ? maxCollateral : userInputWei;
    } catch (error) {
      return 0n;
    }
  };

  // ===== WHAT THIS REPAYMENT ACTUALLY COSTS =====
  //
  // Derived from the same two views `repayLoan` uses, NOT from the simulation. The simulation
  // takes the ceiling as an input, so deriving the ceiling from it is circular — and a
  // half-applied version lets the allowance pass below what the send pulls.
  //
  //   newBorrowAmount = borrowableAmountFrom(revnetId, collateral - returned).capacity
  //   repayPrincipal  = loan.amount - newBorrowAmount           (REVLoans.sol:951-970)
  //   fee             = determineSourceFeeAmount(loan, repayPrincipal)   (:984)
  //   owed            = repayPrincipal + fee                             (:987)
  //
  // `maxRepayBorrowAmount` must cover `owed`; the contract refunds the surplus (:1023-1031).
  const collateralToReturnWei = loanData
    ? calculateCollateralAmount(collateralToReturn, loanData.collateral)
    : undefined;

  // The contract reads the ECONOMIC capacity of the collateral left behind — the second
  // tuple member, not `borrowableNow`, which nets off the live treasury balance.
  const { data: remainingBorrowable } = useReadContract({
    abi: revLoansAbi,
    functionName: "borrowableAmountFrom",
    address: getRevnetLoanContract(6, chainId),
    chainId,
    args:
      loanData && collateralToReturnWei !== undefined && chainTokenConfig
        ? [
            loanProjectId,
            loanData.collateral - collateralToReturnWei,
            BigInt(chainTokenConfig.decimals),
            BigInt(chainTokenConfig.currency),
          ]
        : undefined,
    query: {
      enabled: !!loanData && collateralToReturnWei !== undefined && !!chainTokenConfig,
    },
  });

  const repayPrincipal = useMemo(() => {
    if (!loanData || remainingBorrowable === undefined) return undefined;
    return repayPrincipalFor(loanData.amount, remainingBorrowable[1]);
  }, [loanData, remainingBorrowable]);

  // The fee for THIS repayment, not for the whole loan. `repayLoan` computes
  // `_determineSourceFeeAmount(loan, repayBorrowAmount)` and adds it on top
  // (REVLoans.sol:984-987), so a partial repay owes a proportionally smaller fee than
  // `accruedSourceFee` (which is quoted against the full principal).
  const { data: feeForThisRepay } = useReadContract({
    abi: revLoansAbi,
    functionName: "determineSourceFeeAmount",
    address: getRevnetLoanContract(6, chainId),
    chainId,
    args: loanData && repayPrincipal !== undefined ? [loanData, repayPrincipal] : undefined,
    query: { enabled: !!loanData && repayPrincipal !== undefined },
  });

  // What the wallet actually parts with: the principal repaid PLUS the fee charged on it.
  // Showing the principal alone understated the cost.
  const amountToPayNow =
    repayPrincipal === undefined || feeForThisRepay === undefined
      ? undefined
      : repayPrincipal + feeForThisRepay;

  // The ceiling the contract is authorized to pull, scaled to THIS repayment.
  //
  // Authorizing the whole loan meant that unlocking 10% of the collateral still required the
  // wallet to hold the entire principal. Both the fee and the buffer are proportional to the
  // amount repaid — `_determineSourceFeeAmount` charges pro-rata on `amount`
  // (REVLoansSourceFees.sol:55), so a tenth of the debt accrues a tenth of the fee and needs a
  // tenth of the padding — which is what makes scaling safe rather than merely smaller.
  //
  // Falls back to the whole-loan ceiling until both reads resolve. That is the conservative
  // direction: over-authorizing is refunded, under-authorizing reverts.
  //
  // And under-authorizing FAILS CLOSED rather than costing anything: `repayLoan` reverts with
  // `REVLoans_OverMaxRepayBorrowAmount` (REVLoans.sol:1001-1005), so a short ceiling shows up
  // as a simulation error and the button is already disabled on that. The derivation is
  // checked against the contract on every render, not trusted.
  const finalRepayAmount = useMemo(() => {
    if (repayPrincipal === undefined || feeForThisRepay === undefined) return repayCeiling;
    return repayCeilingFor(repayPrincipal, feeForThisRepay);
  }, [repayPrincipal, feeForThisRepay, repayCeiling]);

  // Simulation arguments - only run once the token config resolved and, for
  // ERC-20 base tokens, the allowance is sufficient.
  const shouldRunSimulation =
    !isLoadingLoan &&
    loanData &&
    finalRepayAmount !== undefined &&
    collateralToReturn &&
    userAddress &&
    !!chainTokenConfig &&
    allowanceChecked && // Ensure allowance check has completed
    (isNativeBase || hasSufficientAllowance);

  const simulationArgs = shouldRunSimulation
    ? [
        BigInt(loanId),
        finalRepayAmount, // this repayment's principal + fee + buffer; the surplus is refunded
        calculateCollateralAmount(collateralToReturn, loanData.collateral),
        userAddress as Address,
        {
          sigDeadline: 0n,
          amount: 0n,
          expiration: 0,
          nonce: 0,
          signature:
            "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
        },
      ]
    : undefined;

  // Always call the hook, but pass undefined args when we shouldn't simulate.
  //
  // The RESULT is no longer read — displayed amounts are derived from the same views the
  // contract uses (see above), so they match what the transaction was actually built from.
  // What matters here is the ERROR: it is the live check that the derived ceiling covers what
  // `repayLoan` will pull, and the button is disabled while it is set.
  const { isLoading: isSimulating, error: simulationError } = useSimulateContract({
    abi: revLoansAbi,
    functionName: "repayLoan",
    address: getRevnetLoanContract(6, chainId),
    chainId,
    args:
      shouldRunSimulation && simulationArgs
        ? (simulationArgs as unknown as readonly [
            bigint,
            bigint,
            bigint,
            `0x${string}`,
            {
              sigDeadline: bigint;
              amount: bigint;
              expiration: number;
              nonce: number;
              signature: `0x${string}`;
            },
          ])
        : undefined,
    value: isNativeBase ? finalRepayAmount : 0n, // Only send native value for native-base projects
  });

  // ===== ALLOWANCE CHECKING =====
  // Check allowance for non-ETH base tokens
  useEffect(() => {
    const checkAllowance = async () => {
      // Unresolved token config: the allowance question can't be answered yet.
      // Stay un-checked so submission remains gated (LOADING, not ETH).
      if (!chainTokenConfig) {
        setAllowanceChecked(false);
        setHasSufficientAllowance(false);
        setAllowanceError("");
        return;
      }

      if (!loanData || !userAddress || !publicClient || isNativeToken(chainTokenConfig.token)) {
        setAllowanceChecked(true);
        setHasSufficientAllowance(true);
        setAllowanceError("");
        return;
      }

      try {
        const baseTokenAddress = chainTokenConfig.token;
        const revLoansContractAddress = getRevnetLoanContract(6, chainId);

        const allowance = await publicClient.readContract({
          address: baseTokenAddress,
          abi: erc20Abi,
          functionName: "allowance",
          args: [userAddress as Address, revLoansContractAddress as Address],
        });

        if (finalRepayAmount === undefined || BigInt(allowance) < finalRepayAmount) {
          setHasSufficientAllowance(false);
          setAllowanceError(
            "To calculate your repayment cost, we need permission for this loan. You will not be charged until you confirm repayment.",
          );
        } else {
          setHasSufficientAllowance(true);
          setAllowanceError("");
        }
      } catch (error) {
        setAllowanceError("Error checking allowance. Please try again.");
        setHasSufficientAllowance(false);
      } finally {
        setAllowanceChecked(true);
      }
    };

    checkAllowance();
    // `finalRepayAmount` is a dependency: it resolves asynchronously with the source-fee read, and the
    // allowance must be judged against the amount the contract will actually pull, not the principal.
  }, [loanData, userAddress, publicClient, chainTokenConfig, chainId, finalRepayAmount]);

  // ===== EFFECTS =====

  // Validate collateral input
  useEffect(() => {
    if (!loanData || !collateralToReturn) {
      setCollateralError("");
      return;
    }

    const maxCollateralDisplay = Number(formatUnits(loanData.collateral, projectTokenDecimals));
    const inputCollateral = Number(collateralToReturn);

    if (inputCollateral > maxCollateralDisplay) {
      setCollateralError(
        `Cannot return more than ${formatCollateralAmount(loanData.collateral)} ${tokenSymbol}`,
      );
    } else if (inputCollateral <= 0) {
      setCollateralError("Collateral amount must be greater than 0");
    } else {
      setCollateralError("");
    }
  }, [collateralToReturn, loanData, tokenSymbol, projectTokenDecimals, formatCollateralAmount]);

  // Handle transaction status updates. Terminal states persist until the user
  // dismisses the dialog — timers must never close it or clear an error.
  useEffect(() => {
    if (isRepayTxLoading) {
      setRepayStatus("pending");
    } else if (isRepaySuccess) {
      setRepayStatus("success");
      toast({
        title: "Success",
        description: "Loan repayment completed successfully!",
      });
    }
  }, [isRepayTxLoading, isRepaySuccess, toast]);

  // Initialize form when dialog opens
  useEffect(() => {
    if (open && loanData && projectTokenDecimals) {
      const maxCollateralDisplay = formatUnits(loanData.collateral, projectTokenDecimals);
      setCollateralToReturn(maxCollateralDisplay);
    }
    if (!open) {
      setCollateralToReturn("");
      setRepayStatus("idle");
      setRepayTxHash(undefined);
      setCollateralError("");
      setReview(null);
    }
  }, [open, loanData, projectTokenDecimals]);

  useEffect(() => {
    if (repayStatus === "pending" || repayStatus === "success") setReview(null);
  }, [repayStatus]);

  // ===== EVENT HANDLERS =====
  const handleApproveAllowance = async () => {
    if (
      !loanData ||
      !userAddress ||
      !publicClient ||
      !walletClient ||
      !chainTokenConfig ||
      finalRepayAmount === undefined
    ) {
      return;
    }
    if (isNativeToken(chainTokenConfig.token)) return;

    try {
      setRepayStatus("approving");
      const baseTokenAddress = chainTokenConfig.token;
      const revLoansContractAddress = getRevnetLoanContract(6, chainId);

      const approveHash = await repayLoanAsync({
        chainId,
        address: baseTokenAddress,
        abi: erc20Abi,
        functionName: "approve",
        // Approve exactly what this repayment can pull, not the whole loan.
        args: [revLoansContractAddress as Address, finalRepayAmount],
      });

      requireOnchainExecution(approveHash, "Token approval");
      const approvalReceipt = await waitForReceiptWithRetry(publicClient, approveHash);
      if (approvalReceipt.status !== "success") {
        throw new Error(`Token approval ${approveHash} reverted onchain.`);
      }

      // Reset allowance check to trigger re-check
      setAllowanceChecked(false);
      setRepayStatus("idle");

      toast({
        title: "Approval Successful",
        description: "Token allowance approved. You can now proceed with repayment.",
      });
    } catch (error: any) {
      if (isSafeProposalPendingError(error)) {
        setRepayStatus("pending");
        toast({ title: "Safe approval proposal submitted", description: error.message });
        return;
      }
      setRepayStatus("error");
      toast({
        variant: "destructive",
        title: "Approval Failed",
        description: formatWalletError(error),
      });
    }
  };

  const handleRepay = async () => {
    if (
      !loanData ||
      !userAddress ||
      !repayLoanAsync ||
      !publicClient ||
      !walletClient ||
      !chainTokenConfig ||
      finalRepayAmount === undefined
    ) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Missing required data for repayment",
      });
      return;
    }

    try {
      setRepayStatus("waiting-signature");

      const loanIdBigInt = BigInt(loanId);
      // Same value the simulation and the allowance check used — all three move together, or
      // the allowance passes below what the send pulls.
      const maxRepayBorrowAmount = finalRepayAmount;
      const collateralCountToReturn = calculateCollateralAmount(
        collateralToReturn,
        loanData.collateral,
      );

      // Check allowance for ERC-20-based projects
      if (!isNativeToken(chainTokenConfig.token)) {
        const baseTokenAddress = chainTokenConfig.token;
        const revLoansContractAddress = getRevnetLoanContract(6, chainId);

        const allowance = await publicClient.readContract({
          address: baseTokenAddress,
          abi: erc20Abi,
          functionName: "allowance",
          args: [userAddress as Address, revLoansContractAddress as Address],
        });

        if (BigInt(allowance) < maxRepayBorrowAmount) {
          setRepayStatus("approving");

          if (!walletClient) {
            throw new Error("Wallet client not available");
          }

          const approveHash = await repayLoanAsync({
            chainId,
            address: baseTokenAddress,
            abi: erc20Abi,
            functionName: "approve",
            args: [revLoansContractAddress as Address, maxRepayBorrowAmount],
          });

          requireOnchainExecution(approveHash, "Token approval");
          const approvalReceipt = await waitForReceiptWithRetry(publicClient, approveHash);
          if (approvalReceipt.status !== "success") {
            throw new Error(`Token approval ${approveHash} reverted onchain.`);
          }
          setRepayStatus("waiting-signature");
        }
      }

      const txHash = await repayLoanAsync({
        abi: revLoansAbi,
        functionName: "repayLoan",
        address: getRevnetLoanContract(6, chainId),
        chainId,
        args: [
          loanIdBigInt,
          maxRepayBorrowAmount,
          collateralCountToReturn,
          userAddress as Address,
          {
            sigDeadline: 0n,
            amount: 0n,
            expiration: 0,
            nonce: 0,
            signature:
              "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
          },
        ],
        // Repay cost accrues continuously, so a quoted exact value can be stale by send time and
        // underfund the repay. Send the ceiling (principal + accrued source fee + buffer); the
        // contract refunds the excess.
        value: isNativeToken(chainTokenConfig.token) ? maxRepayBorrowAmount : 0n,
      });

      setRepayTxHash(txHash);
    } catch (error: any) {
      if (isSafeProposalPendingError(error)) {
        setRepayStatus("pending");
        toast({ title: "Safe approval proposal submitted", description: error.message });
        return;
      }
      setRepayStatus("error");
      toast({
        variant: "destructive",
        title: "Repayment Failed",
        description: formatWalletError(error),
      });
    }
  };

  // ===== RENDER HELPERS =====
  const renderPercentageButtons = () => {
    if (!loanData) return null;

    return (
      <div className="flex gap-1 mt-4 flex-wrap">
        {[10, 25, 50, 75].map((pct) => (
          <button
            key={pct}
            type="button"
            onClick={() => {
              const collateralInTokens = Number(
                formatUnits(loanData.collateral, projectTokenDecimals),
              );
              const portion = collateralInTokens * (pct / 100);
              setCollateralToReturn(
                portion < 0.000001 ? "0" : portion.toFixed(6).replace(/\.?0+$/, ""),
              );
            }}
            className="h-8 px-3 text-xs text-zinc-700 border border-zinc-300 rounded-md bg-white hover:bg-zinc-100"
          >
            {pct}%
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            const maxCollateralDisplay = formatUnits(loanData.collateral, projectTokenDecimals);
            setCollateralToReturn(maxCollateralDisplay);
          }}
          className="h-8 px-3 text-xs text-zinc-700 border border-zinc-300 rounded-md bg-white hover:bg-zinc-100"
        >
          Max
        </button>
      </div>
    );
  };

  const statusText = REPAY_STATUS_TEXT[repayStatus];
  const renderStatusMessage = () =>
    statusText ? <p className="text-sm text-zinc-600 mt-2">{statusText}</p> : null;
  const signing = isRepaying || repayStatus === "waiting-signature" || repayStatus === "approving";

  // ===== LOADING STATES =====
  // An unresolved token config is a LOADING state: without it the loan's base
  // token is unknown, so amounts, allowance, and value attachment can't be
  // rendered or submitted safely.
  if (isLoadingLoan || !chainTokenConfig || (!allowanceChecked && isNativeBase === false)) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Repay loan</DialogTitle>
          </DialogHeader>
          <div className="space-y-5" role="status" aria-label="Loading loan details">
            <span className="sr-only">Loading loan details</span>
            <SkeletonLines lines={3} />
            <div className="grid grid-cols-2 gap-3">
              <SkeletonLines lines={2} />
              <SkeletonLines lines={2} />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!loanData) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Repay loan</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-zinc-700 space-y-4">
            <p>Loan not found or no longer exists.</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ===== MAIN RENDER =====
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Repay loan</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-zinc-700 space-y-4">
          <div className="grid grid-cols-7 gap-2">
            <div className="col-span-4">
              <Label
                htmlFor="collateral-to-return"
                className="block text-zinc-700 text-sm font-bold mb-1"
              >
                How much {tokenSymbol} collateral do you want back?
              </Label>
              <Input
                id="collateral-to-return"
                type="number"
                step="0.000001"
                value={collateralToReturn}
                onChange={(e) => {
                  const value = e.target.value;

                  // Allow empty input for clearing
                  if (value === "") {
                    setCollateralToReturn("");
                    return;
                  }

                  // Limit decimal places to 8 digits
                  const decimalIndex = value.indexOf(".");
                  if (decimalIndex !== -1 && value.length - decimalIndex - 1 > 8) {
                    return; // Don't update if too many decimal places
                  }

                  const numValue = Number(value);
                  const maxValue = loanData
                    ? Number(formatUnits(loanData.collateral, projectTokenDecimals))
                    : 0;

                  // Only validate max if it's a valid number
                  if (!isNaN(numValue)) {
                    // Prevent entering more than available collateral
                    if (numValue > maxValue) {
                      setCollateralToReturn(maxValue.toFixed(6));
                    } else {
                      setCollateralToReturn(value);
                    }
                  } else {
                    // Allow partial input (like just a decimal point)
                    setCollateralToReturn(value);
                  }
                }}
                placeholder="Enter collateral amount to return"
                className={collateralError ? "border-red-500" : ""}
              />
              {collateralError && <p className="text-xs text-red-500 mt-1">{collateralError}</p>}

              {renderPercentageButtons()}
            </div>
          </div>

          <div className="mt-4">
            <Label className="block text-zinc-700 text-sm font-bold mb-1">
              Repayment Breakdown
            </Label>
            {loanData && (
              <div className="bg-melon-25 border border-melon-300 p-4">
                <div className="text-sm text-zinc-600">
                  <table className="w-full">
                    <tbody className="space-y-1">
                      <tr>
                        <td className="pr-4">Original amount borrowed:</td>
                        <td className="font-semibold text-right">
                          {formatUnits(loanData.amount, baseTokenDecimals)} {baseTokenSymbol}
                        </td>
                      </tr>
                      <tr>
                        <td className="pr-4">
                          Amount of collateral you want back (
                          {(
                            (Number(collateralToReturn) /
                              Number(formatUnits(loanData.collateral, projectTokenDecimals))) *
                            100
                          ).toFixed(1)}
                          %):
                        </td>
                        <td className="font-semibold text-right">
                          {collateralToReturn} {tokenSymbol}
                        </td>
                      </tr>
                      {!isSimulating &&
                        !simulationError &&
                        amountToPayNow !== undefined &&
                        repayPrincipal !== undefined && (
                          <>
                            <tr>
                              <td className="pr-4">Amount to pay now:</td>
                              <td className="font-semibold text-right">
                                {formatUnits(amountToPayNow, baseTokenDecimals)} {baseTokenSymbol}
                                {feeForThisRepay !== undefined && feeForThisRepay > 0n ? (
                                  <span className="block text-xs font-normal text-zinc-500">
                                    includes {formatUnits(feeForThisRepay, baseTokenDecimals)}{" "}
                                    {baseTokenSymbol} source fee
                                  </span>
                                ) : null}
                              </td>
                            </tr>
                            <tr>
                              <td className="pr-4">Amount rolled into new loan id:</td>
                              <td className="font-semibold text-right">
                                {formatUnits(loanData.amount - repayPrincipal, baseTokenDecimals)}{" "}
                                {baseTokenSymbol}
                              </td>
                            </tr>
                          </>
                        )}
                    </tbody>
                  </table>
                </div>
                {isSimulating && (
                  <p className="text-sm text-zinc-500 mt-2">Calculating exact amounts...</p>
                )}
                {simulationError && shouldRunSimulation && (
                  <p className="text-sm text-red-500 mt-2">Error: {simulationError.message}</p>
                )}
                {!isSimulating &&
                  !simulationError &&
                  amountToPayNow === undefined &&
                  !hasSufficientAllowance &&
                  isNativeBase === false && (
                    <p className="text-sm text-red-500 mt-2">
                      Please approve token allowance to see exact repayment amounts
                    </p>
                  )}
                {!isSimulating &&
                  !simulationError &&
                  amountToPayNow === undefined &&
                  (hasSufficientAllowance || isNativeBase) && (
                    <p className="text-sm text-zinc-500 mt-2">
                      Contract will calculate exact amounts
                    </p>
                  )}
              </div>
            )}
          </div>
          {/* Allowance Error Display */}
          {allowanceChecked && !hasSufficientAllowance && isNativeBase === false && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="text-sm text-red-700 font-medium mb-2">Token Approval Required</p>
                  <p className="text-sm text-red-600 mb-3">{allowanceError}</p>
                  <ButtonWithWallet
                    targetChainId={chainId as JBChainId}
                    loading={repayStatus === "approving"}
                    onClick={() => setReview("approve")}
                    variant="outline"
                    size="sm"
                  >
                    Approve {baseTokenSymbol}
                  </ButtonWithWallet>
                </div>
              </div>
            </div>
          )}
          <div className="flex flex-col items-end pt-2">
            {repayStatus === "success" ? (
              <Button type="button" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            ) : (
              <ButtonWithWallet
                targetChainId={chainId as JBChainId}
                loading={
                  isRepaying || repayStatus === "waiting-signature" || repayStatus === "pending"
                }
                onClick={() => setReview("repay")}
                disabled={
                  !finalRepayAmount ||
                  Number(finalRepayAmount) <= 0 ||
                  !collateralToReturn ||
                  Number(collateralToReturn) <= 0 ||
                  !!collateralError ||
                  // The pre-send simulation is the ONLY thing standing between the user and a
                  // known-failing transaction; without this they could click straight into it.
                  (shouldRunSimulation && !!simulationError) ||
                  (isNativeBase === false && !hasSufficientAllowance)
                }
                className="bg-teal-500 text-melon-950 hover:bg-teal-600"
              >
                Repay loan
              </ButtonWithWallet>
            )}
            {renderStatusMessage()}
          </div>
        </div>
        {review && finalRepayAmount !== undefined ? (
          <TxConfirmDialog
            open
            onOpenChange={(next) => {
              if (!next) setReview(null);
            }}
            title={review === "approve" ? "Confirm approval" : "Confirm repayment"}
            chainId={chainId}
            steps={
              review === "approve"
                ? [
                    {
                      title: `Approve ${baseTokenSymbol}`,
                      detail: "REVLoans can pull at most this amount; the surplus is refunded.",
                    },
                  ]
                : [
                    {
                      title: "Repay the loan",
                      detail: "Pays what is owed and returns the collateral to your wallet.",
                    },
                  ]
            }
            activeIndex={signing ? 0 : -1}
            action={review === "approve" ? `Approve ${baseTokenSymbol}` : "Repay loan"}
            onConfirm={() => {
              if (review === "approve")
                void handleApproveAllowance().finally(() => setReview(null));
              else void handleRepay();
            }}
            busy={signing}
            status={signing ? statusText : null}
            error={repayStatus === "error" ? statusText : null}
          >
            {review === "repay" ? (
              <>
                <SummaryRow label="Returns">
                  {collateralToReturn} {tokenSymbol}
                </SummaryRow>
                <SummaryRow label="On">{chainDisplayName(chainId)}</SummaryRow>
                <SummaryRow label="Pays now">
                  {amountToPayNow !== undefined
                    ? `${formatUnits(amountToPayNow, baseTokenDecimals)} ${baseTokenSymbol}`
                    : "Calculated by the contract"}
                  {feeForThisRepay !== undefined && feeForThisRepay > 0n ? (
                    <span className="block text-xs text-zinc-500">
                      Includes {formatUnits(feeForThisRepay, baseTokenDecimals)} {baseTokenSymbol}{" "}
                      source fee
                    </span>
                  ) : null}
                </SummaryRow>
                {repayPrincipal !== undefined && loanData.amount - repayPrincipal > 0n ? (
                  <SummaryRow label="Rolled into a new loan">
                    {formatUnits(loanData.amount - repayPrincipal, baseTokenDecimals)}{" "}
                    {baseTokenSymbol}
                  </SummaryRow>
                ) : null}
              </>
            ) : (
              <SummaryRow label="On">{chainDisplayName(chainId)}</SummaryRow>
            )}
            <SummaryRow label="Authorizes up to">
              {formatUnits(finalRepayAmount, baseTokenDecimals)} {baseTokenSymbol}
              <span className="block text-xs text-zinc-500">The unused part is refunded</span>
            </SummaryRow>
          </TxConfirmDialog>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
