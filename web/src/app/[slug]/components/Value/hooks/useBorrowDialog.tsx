import { useToast } from "@/components/ui/use-toast";
import { useBorrowableAmountFrom } from "@/hooks/useBorrowableAmountFrom";
import { useProjectBaseToken } from "@/hooks/useProjectBaseToken";
import {
  isSafeProposalPendingError,
  requireOnchainExecution,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "@/hooks/useReviewedWriteContract";
import { ProjectOperation, SuckerGroupOperation, useBendystrawQuery } from "@/lib/bendystraw";
import { generateFeeData } from "@/lib/feeHelpers";
import {
  buildProtectedBorrowTx,
  buildProtectedReallocateCollateralTx,
  minimumBorrowAmount,
  readFreshBorrowableAmount,
} from "@/lib/loanTransactions";
import { useJBChainId, useJBContractContext, useJBTokenContext } from "@/lib/nana/project";
import { useSuckersUserTokenBalance } from "@/lib/nana/suckers";
import type { JBChainId } from "@/lib/nana/types";
import { getTokenConfigForChain, getTokenSymbolFromAddress } from "@/lib/tokenUtils";
import { formatWalletError } from "@/lib/utils";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import {
  getRevnetLoanContract,
  JB_TOKEN_DECIMALS,
  jbPermissionsAbi,
  revDeployerAbi,
  revLoansAbi,
  RevnetCoreContracts,
} from "@bananapus/nana-sdk-core";
import { hasPermissions, JBPermissionIdsV6 } from "@bananapus/nana-sdk-core/v6";
import { useCallback, useEffect, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, usePublicClient, useReadContract, useWalletClient } from "wagmi";

// Types
type BorrowState =
  | "idle"
  | "checking"
  | "granting-permission"
  | "permission-granted"
  | "waiting-signature"
  | "pending"
  | "success"
  | "error-permission-denied"
  | "error-loan-canceled"
  | "error"
  | "reallocation-pending";

/**
 * A loan row as the loan tables select it (a superset of Bendystraw's LoanRow;
 * the legacy tables pass `chain` instead of `chainId`).
 */
export interface SelectedLoan {
  id: string | number | bigint;
  chainId?: number;
  /** Legacy alias for chainId from the older loan tables. */
  chain?: number;
  borrowAmount: string | number | bigint;
  collateral: string | number | bigint;
  createdAt?: number;
  prepaidDuration?: number;
  projectId?: number;
  terminal?: string;
  token?: string;
}

interface UseBorrowDialogProps {
  projectId: bigint;
  selectedLoan?: SelectedLoan | null;
  defaultTab?: "borrow" | "repay";
}

export function useBorrowDialog({ projectId, selectedLoan, defaultTab }: UseBorrowDialogProps) {
  // ===== STATE VARIABLES =====
  // Dialog and UI state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedTab, setSelectedTab] = useState<"borrow" | "repay">(defaultTab ?? "borrow");
  const [showChart, setShowChart] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showOtherCollateral, setShowOtherCollateral] = useState(false);
  const [showLoanDetailsTable, setShowLoanDetailsTable] = useState(true);
  const [showRefinanceLoanDetailsTable, setShowRefinanceLoanDetailsTable] = useState(true);
  const [showingWaitingMessage, setShowingWaitingMessage] = useState(false);

  // Borrow-related state
  const [borrowStatus, setBorrowStatus] = useState<BorrowState>("idle");
  // The burn permission is read live at submission, so a run only learns it is
  // two prompts once the grant starts. Remembering that keeps the finished
  // grant listed instead of vanishing when the loan step begins.
  const [grantsPermission, setGrantsPermission] = useState(false);
  useEffect(() => {
    if (borrowStatus === "granting-permission") setGrantsPermission(true);
    if (borrowStatus === "idle") setGrantsPermission(false);
  }, [borrowStatus]);
  const [collateralAmount, setCollateralAmount] = useState("");
  const [selectedChainId, setSelectedChainId] = useState<number | undefined>(undefined);
  const [cashOutChainId, setCashOutChainId] = useState<string>();
  const [prepaidPercent, setPrepaidPercent] = useState("2.5");
  const [grossBorrowedNative, setGrossBorrowedNative] = useState(0);
  const [internalSelectedLoan, setInternalSelectedLoan] = useState<SelectedLoan | null>(
    selectedLoan ?? null,
  );

  const { toast } = useToast();

  // ===== HOOKS AND CONTEXT =====
  // Context hooks
  const { token } = useJBTokenContext();
  const { contractAddress } = useJBContractContext();

  const chainId = useJBChainId();

  // Account and wallet hooks
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const selectedBorrowChainId = cashOutChainId ? (Number(cashOutChainId) as JBChainId) : undefined;
  const publicClient = usePublicClient({ chainId: selectedBorrowChainId });

  // ===== PHASE 1: BASE TOKEN CONTEXT =====

  // Get base token information
  const baseToken = useProjectBaseToken();

  // Get sucker group data for token mapping
  const { data: projectData } = useBendystrawQuery(
    ProjectOperation,
    { chainId: Number(chainId), projectId: Number(projectId), version: 6 },
    { enabled: !!chainId && !!projectId, pollInterval: 30000 },
  );
  const suckerGroupId = projectData?.project?.suckerGroupId;

  const { data: suckerGroupData } = useBendystrawQuery(
    SuckerGroupOperation,
    { id: suckerGroupId ?? "" },
    { enabled: !!suckerGroupId, pollInterval: 30000, chainId: Number(chainId) },
  );

  // ===== PHASE 1: TOKEN RESOLUTION FUNCTION =====
  // Get the correct token configuration for a specific chain
  const tokenConfigForChain = useCallback(
    (chainId: string | number) => {
      return getTokenConfigForChain(suckerGroupData, Number(chainId));
    },
    [suckerGroupData],
  );

  const revLoansContractAddress = cashOutChainId
    ? getRevnetLoanContract(6, Number(cashOutChainId) as JBChainId)
    : undefined;

  // Data hooks
  const { data: balances } = useSuckersUserTokenBalance();
  const { data: resolvedPermissionsAddress } = useReadContract({
    abi: revDeployerAbi,
    functionName: "PERMISSIONS",
    address: contractAddress(RevnetCoreContracts.REVDeployer),
    chainId: cashOutChainId ? (Number(cashOutChainId) as JBChainId) : undefined,
  });

  const { data: minPrepaidFeePercent } = useReadContract({
    abi: revLoansAbi,
    functionName: "MIN_PREPAID_FEE_PERCENT",
    address: revLoansContractAddress,
    chainId: cashOutChainId ? (Number(cashOutChainId) as JBChainId) : undefined,
  });

  const { data: revPrepaidFeePercent } = useReadContract({
    abi: revLoansAbi,
    functionName: "REV_PREPAID_FEE_PERCENT",
    address: revLoansContractAddress,
    chainId: cashOutChainId ? (Number(cashOutChainId) as JBChainId) : undefined,
  });

  // ===== DERIVED VALUES (needed by callbacks) =====
  const projectTokenDecimals = token?.data?.decimals ?? JB_TOKEN_DECIMALS;

  const selectedBalance = balances?.find((b) => b.chainId === Number(cashOutChainId));

  const userProjectTokenBalance = selectedBalance?.balance.value ?? 0n;

  // Dynamically determine the correct projectId based on the selected chain
  const effectiveProjectId = selectedBalance?.projectId
    ? BigInt(selectedBalance.projectId)
    : projectId;

  // V6 project ids are a per-chain namespace: the page's prop is the ROUTE chain's id, and
  // quoting it on the loan's chain prices a different revnet. Per-loan reads key on the
  // loan row's own id, falling back to the sucker-pair id for the selected chain.
  const loanProjectId =
    internalSelectedLoan?.projectId != null
      ? BigInt(internalSelectedLoan.projectId)
      : effectiveProjectId;

  // Calculate total fixed fees from contract values (in basis points)
  const totalFixedFees =
    (minPrepaidFeePercent ? Number(minPrepaidFeePercent) : 0) +
    (revPrepaidFeePercent ? Number(revPrepaidFeePercent) : 0);

  // Used for estimating how much Native could be borrowed if both
  // the existing loan's collateral and new collateral were combined into one.
  const totalReallocationCollateral =
    internalSelectedLoan && collateralAmount
      ? BigInt(internalSelectedLoan.collateral) + parseUnits(collateralAmount, projectTokenDecimals)
      : undefined;

  // ===== PHASE 2: UPDATE CONTRACT CALLS =====

  // Get token configuration for the selected chain
  const selectedChainTokenConfig = cashOutChainId
    ? tokenConfigForChain(Number(cashOutChainId))
    : null;

  // Borrow-related hooks
  const { data: borrowableAmountRaw } = useBorrowableAmountFrom({
    address: revLoansContractAddress,
    chainId: cashOutChainId ? (Number(cashOutChainId) as JBChainId) : undefined,
    args:
      cashOutChainId && selectedChainTokenConfig
        ? ([
            effectiveProjectId,
            userProjectTokenBalance,
            BigInt(selectedChainTokenConfig.decimals),
            BigInt(selectedChainTokenConfig.currency),
          ] as const)
        : undefined,
  });

  const { data: estimatedBorrowFromInputOnly } = useBorrowableAmountFrom({
    address: revLoansContractAddress,
    chainId: cashOutChainId ? (Number(cashOutChainId) as JBChainId) : undefined,
    args:
      collateralAmount && selectedChainTokenConfig
        ? [
            effectiveProjectId,
            parseUnits(collateralAmount, projectTokenDecimals),
            BigInt(selectedChainTokenConfig.decimals),
            BigInt(selectedChainTokenConfig.currency),
          ]
        : undefined,
  });

  // Reallocation-related hooks
  const { data: selectedLoanReallocAmount } = useBorrowableAmountFrom({
    address: revLoansContractAddress,
    chainId: cashOutChainId ? (Number(cashOutChainId) as JBChainId) : undefined,
    args:
      totalReallocationCollateral && selectedChainTokenConfig
        ? [
            loanProjectId,
            totalReallocationCollateral,
            BigInt(selectedChainTokenConfig.decimals),
            BigInt(selectedChainTokenConfig.currency),
          ]
        : undefined,
  });

  // The existing collateral is valued at the ECONOMIC ceiling (`capacity`): the contract's
  // reallocation solvency check ignores the live treasury surplus, and `borrowableNow`
  // collapses toward zero whenever the treasury is drawn down.
  const { capacity: currentBorrowableOnSelectedCollateral } = useBorrowableAmountFrom({
    address: revLoansContractAddress,
    chainId: cashOutChainId ? (Number(cashOutChainId) as JBChainId) : undefined,
    args:
      internalSelectedLoan && selectedChainTokenConfig
        ? [
            loanProjectId,
            BigInt(internalSelectedLoan.collateral),
            BigInt(selectedChainTokenConfig.decimals),
            BigInt(selectedChainTokenConfig.currency),
          ]
        : undefined,
  });

  // Transaction hooks
  const { writeContractAsync, isPending: isWriteLoading, data: txHash } = useWriteContract();

  const {
    writeContractAsync: reallocateCollateralAsync,
    isPending: isReallocating,
    data: reallocationTxHash,
  } = useWriteContract();
  const { writeContractAsync: permissionWriteAsync } = useWriteContract();

  // Transaction status hooks
  const { isLoading: isTxLoading, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const { isLoading: isReallocationTxLoading, isSuccess: isReallocationSuccess } =
    useWaitForTransactionReceipt({
      hash: reallocationTxHash,
    });

  // Additional derived values in native tokens
  const netAvailableToBorrow =
    selectedTab === "borrow" && selectedLoanReallocAmount !== undefined && internalSelectedLoan
      ? selectedLoanReallocAmount - BigInt(internalSelectedLoan.borrowAmount)
      : 0n;

  const isOvercollateralized =
    selectedLoanReallocAmount !== undefined &&
    BigInt(internalSelectedLoan?.borrowAmount ?? 0) < selectedLoanReallocAmount;

  const extraCollateralBuffer = isOvercollateralized
    ? selectedLoanReallocAmount - BigInt(internalSelectedLoan?.borrowAmount ?? 0)
    : 0n;

  const collateralHeadroom =
    currentBorrowableOnSelectedCollateral !== undefined && internalSelectedLoan
      ? currentBorrowableOnSelectedCollateral - BigInt(internalSelectedLoan.borrowAmount)
      : 0n;

  // Convert the source-token headroom to project-token collateral with exact
  // integer math. This replaces the previous Number conversion, which lost
  // precision and mixed source-token and project-token units.
  const collateralCountToTransfer =
    internalSelectedLoan &&
    currentBorrowableOnSelectedCollateral !== undefined &&
    currentBorrowableOnSelectedCollateral > 0n &&
    collateralHeadroom > 0n
      ? (collateralHeadroom * BigInt(internalSelectedLoan.collateral)) /
        currentBorrowableOnSelectedCollateral
      : 0n;

  // Quote the exact collateral count the reallocation transaction will place
  // into its new loan, in the source token's own decimals and currency.
  const collateralCountToAdd = collateralAmount
    ? parseUnits(collateralAmount, projectTokenDecimals)
    : 0n;
  const newLoanCollateral = collateralCountToTransfer + collateralCountToAdd;
  const { data: newLoanBorrowableAmount } = useBorrowableAmountFrom({
    address: revLoansContractAddress,
    chainId: cashOutChainId ? (Number(cashOutChainId) as JBChainId) : undefined,
    args:
      newLoanCollateral > 0n && selectedChainTokenConfig
        ? [
            loanProjectId,
            newLoanCollateral,
            BigInt(selectedChainTokenConfig.decimals),
            BigInt(selectedChainTokenConfig.currency),
          ]
        : undefined,
  });

  const minimumBorrowAmountPreview = (() => {
    const quote = internalSelectedLoan ? newLoanBorrowableAmount : estimatedBorrowFromInputOnly;
    if (quote === undefined || quote <= 0n) return undefined;
    try {
      return minimumBorrowAmount(quote);
    } catch {
      return undefined;
    }
  })();

  // ===== PHASE 4: UPDATE FEE CALCULATIONS =====

  // For reallocation, use the total borrowable amount for combined collateral.
  // The quote only exists once the chain's token config resolved, so its
  // decimals are authoritative — never fall back to ETH/18.
  const borrowAmountForFeeCalculation =
    internalSelectedLoan && selectedLoanReallocAmount && selectedChainTokenConfig
      ? Number(formatUnits(selectedLoanReallocAmount, selectedChainTokenConfig.decimals))
      : grossBorrowedNative;

  const feeData = generateFeeData({
    grossBorrowedEth: borrowAmountForFeeCalculation,
    prepaidPercent,
  });

  // Fee calculation for the new loan simulation (not the combined total)
  const newLoanFeeData =
    newLoanBorrowableAmount && selectedChainTokenConfig
      ? generateFeeData({
          grossBorrowedEth: Number(
            formatUnits(newLoanBorrowableAmount, selectedChainTokenConfig.decimals),
          ),
          prepaidPercent,
        })
      : feeData;

  // Calculate prepaidMonths using new prepaidDuration logic
  const monthsToPrepay = (parseFloat(prepaidPercent) / 50) * 120;
  const prepaidMonths = monthsToPrepay;
  const displayYears = Math.floor(prepaidMonths / 12);
  const displayMonths = Math.round(prepaidMonths % 12);

  const loading = isWriteLoading || isTxLoading;

  // ===== CALLBACK HOOKS (must be before any conditional logic) =====
  // Reset internal state when dialog closes or set tab on open
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsDialogOpen(open);
      if (open) {
        setSelectedTab(defaultTab ?? "borrow");
      } else {
        // Clear all form state
        setCollateralAmount("");
        setPrepaidPercent("2.5");
        setGrossBorrowedNative(0);

        // Clear all status states
        setBorrowStatus("idle");

        // Clear chain selection and loan data
        setCashOutChainId(undefined);
        setSelectedChainId(undefined);
        setInternalSelectedLoan(null);

        // Clear UI state
        setShowChart(false);
        setShowInfo(false);
        setShowOtherCollateral(false);
        setShowLoanDetailsTable(true);
        setShowRefinanceLoanDetailsTable(true);
        setShowingWaitingMessage(false);
      }
    },
    [defaultTab],
  );

  const handleChainSelection = useCallback(
    (chainId: number) => {
      const selected = balances?.find((b) => b.chainId === chainId);
      const collateral = selected ? formatUnits(selected.balance.value, projectTokenDecimals) : "0";
      setSelectedChainId(chainId);
      setCashOutChainId(chainId.toString());
      setCollateralAmount(collateral);
      setInternalSelectedLoan(null);
    },
    [balances, projectTokenDecimals],
  );

  const handleLoanSelection = useCallback((_loanId: string, loanData: SelectedLoan) => {
    setInternalSelectedLoan(loanData);
    // Set the cashOutChainId based on the loan's chain
    if (loanData?.chainId) {
      setCashOutChainId(loanData.chainId.toString());
    } else if (loanData?.chain) {
      setCashOutChainId(loanData.chain.toString());
    }
  }, []);

  /**
   * Ensure REVLoans holds BURN_TOKENS for this account+project, granting it if not.
   *
   * Shared by BOTH submit paths. The reallocation branch used to skip it entirely, so a
   * reallocation that ADDS collateral hit a simulation failure with no grant step offered and
   * no way forward from this UI — the standard borrow path had the step all along.
   *
   * Returns true when the caller may proceed. A false return has already set status and
   * toasted, including the Safe-proposal-pending case.
   */
  const ensureBurnTokensPermission = useCallback(async (): Promise<boolean> => {
    if (
      !publicClient ||
      !address ||
      !cashOutChainId ||
      !revLoansContractAddress ||
      !resolvedPermissionsAddress
    ) {
      setBorrowStatus("error");
      return false;
    }

    // Read permission live at submission time. The indexer can lag a newly
    // granted permission, and treating an unresolved query as `false`
    // would prompt an unnecessary approval. Loans need BURN_TOKENS (11),
    // never the much broader ROOT permission (1).
    const hasBorrowPermission = await hasPermissions(publicClient, {
      chainId: Number(cashOutChainId) as JBChainId,
      operator: revLoansContractAddress,
      account: address,
      projectId: loanProjectId,
      permissionIds: [JBPermissionIdsV6.BURN_TOKENS],
    });
    if (!hasBorrowPermission) {
      setBorrowStatus("granting-permission");
      try {
        const txHash = await permissionWriteAsync({
          chainId: cashOutChainId ? (Number(cashOutChainId) as JBChainId) : undefined,
          account: address,
          address: resolvedPermissionsAddress,
          abi: jbPermissionsAbi,
          functionName: "setPermissionsFor",
          args: [
            address,
            {
              operator: revLoansContractAddress,
              projectId: loanProjectId,
              permissionIds: [JBPermissionIdsV6.BURN_TOKENS],
            },
          ],
        });
        requireOnchainExecution(txHash, "Borrow permission grant");
        const permissionReceipt = await waitForReceiptWithRetry(publicClient, txHash);
        if (permissionReceipt.status !== "success") {
          throw new Error(`Permission grant ${txHash} reverted onchain.`);
        }
        setBorrowStatus("permission-granted");
      } catch (err) {
        if (isSafeProposalPendingError(err)) {
          setBorrowStatus("pending");
          toast({
            title: "Safe permission proposal submitted",
            description: err.message,
          });
          return false;
        }
        setBorrowStatus("error-permission-denied");
        toast({
          variant: "destructive",
          title: "Permission Denied",
          description: "Permission was not granted. Please approve to proceed.",
        });
        return false;
      }
    } else {
      setBorrowStatus("permission-granted");
    }
    return true;
  }, [
    address,
    cashOutChainId,
    loanProjectId,
    permissionWriteAsync,
    publicClient,
    resolvedPermissionsAddress,
    revLoansContractAddress,
    toast,
  ]);

  const handleBorrow = useCallback(async () => {
    // Get token configuration for the selected chain
    const selectedChainTokenConfig = cashOutChainId ? tokenConfigForChain(cashOutChainId) : null;

    // Validate that we have token configuration for the selected chain
    if (!selectedChainTokenConfig) {
      setBorrowStatus("error");
      toast({
        variant: "destructive",
        title: "Configuration Error",
        description: "Unable to determine token configuration for the selected chain.",
      });
      return;
    }

    if (
      internalSelectedLoan &&
      collateralAmount !== undefined &&
      !isNaN(Number(collateralAmount))
    ) {
      // Reallocation path - allow 0 additional capital
      if (!internalSelectedLoan || !cashOutChainId || !address || !walletClient) {
        setBorrowStatus("error");
        return;
      }

      // collateralCountToAdd: The amount of collateral to add to the new loan (can be 0)
      // Should be in project token decimals, not base token decimals
      const collateralCountToAdd = parseUnits(collateralAmount || "0", projectTokenDecimals);

      // feePercent: The fee percent for the new loan
      const feePercent = BigInt(Math.round(parseFloat(prepaidPercent) * 10));

      // Validate that the reallocation won't result in a borrow amount less than the original
      if (
        selectedLoanReallocAmount !== undefined &&
        selectedLoanReallocAmount < BigInt(internalSelectedLoan.borrowAmount)
      ) {
        setBorrowStatus("error");
        toast({
          variant: "destructive",
          title: "Invalid Reallocation",
          description:
            "Adding this collateral would result in a borrow amount less than your original loan. Please add more collateral.",
        });
        return;
      }

      // Adding collateral burns project tokens, exactly as the standard borrow path does, so
      // it needs the same BURN_TOKENS grant. Skipping this left the user at a simulation
      // failure with no grant step offered.
      if (collateralCountToAdd > 0n && !(await ensureBurnTokensPermission())) return;

      try {
        if (!publicClient) {
          throw new Error("The selected chain is unavailable. Nothing was submitted.");
        }

        const newLoanCollateralCount = collateralCountToTransfer + collateralCountToAdd;
        const freshBorrowableAmount = await readFreshBorrowableAmount(publicClient, {
          chainId: Number(cashOutChainId) as JBChainId,
          // The loan's chain carries its OWN revnet id — the page's prop is the route chain's.
          // A mismatch quotes a different revnet's borrowable amount, which then becomes both the
          // tx's collateral-transfer argument and its slippage floor.
          revnetId: loanProjectId,
          collateralCount: newLoanCollateralCount,
          decimals: BigInt(selectedChainTokenConfig.decimals),
          currency: BigInt(selectedChainTokenConfig.currency),
        });

        setBorrowStatus("waiting-signature");

        await reallocateCollateralAsync(
          buildProtectedReallocateCollateralTx({
            chainId: Number(cashOutChainId) as JBChainId,
            loanId: BigInt(internalSelectedLoan.id),
            collateralCountToTransfer,
            token: selectedChainTokenConfig.token,
            quotedBorrowAmount: freshBorrowableAmount,
            collateralCountToAdd,
            beneficiary: address,
            prepaidFeePercent: feePercent,
          }),
        );
      } catch (err) {
        setBorrowStatus("error");
        toast({
          variant: "destructive",
          title: "Reallocation Failed",
          description: formatWalletError(err),
        });
      }
    } else {
      // Standard borrow path
      try {
        setBorrowStatus("checking");

        if (
          !walletClient ||
          !publicClient ||
          !address ||
          !cashOutChainId ||
          !resolvedPermissionsAddress
        ) {
          setBorrowStatus("error");
          return;
        }

        const feeBasisPoints = Math.round(parseFloat(prepaidPercent) * 10);
        if (!(await ensureBurnTokensPermission())) return;

        // collateralBigInt should be in project token decimals, not base token decimals
        const collateralBigInt = parseUnits(collateralAmount, projectTokenDecimals);

        if (!writeContractAsync) {
          setBorrowStatus("error");
          return;
        }

        try {
          const freshBorrowableAmount = await readFreshBorrowableAmount(publicClient, {
            chainId: Number(cashOutChainId) as JBChainId,
            revnetId: effectiveProjectId,
            collateralCount: collateralBigInt,
            decimals: BigInt(selectedChainTokenConfig.decimals),
            currency: BigInt(selectedChainTokenConfig.currency),
          });

          setBorrowStatus("waiting-signature");
          await writeContractAsync(
            buildProtectedBorrowTx({
              chainId: Number(cashOutChainId) as JBChainId,
              revnetId: effectiveProjectId,
              token: selectedChainTokenConfig.token,
              quotedBorrowAmount: freshBorrowableAmount,
              collateralCount: collateralBigInt,
              beneficiary: address as `0x${string}`,
              prepaidFeePercent: BigInt(feeBasisPoints),
              holder: address as `0x${string}`,
            }),
          );
        } catch (err) {
          setBorrowStatus("error");
          toast({
            variant: "destructive",
            title: "Loan not submitted",
            description: formatWalletError(err),
          });
          return;
        }
      } catch (err) {
        setBorrowStatus("error");
        toast({
          variant: "destructive",
          title: "Borrow Failed",
          description: formatWalletError(err),
        });
      }
    }
  }, [
    internalSelectedLoan,
    collateralAmount,
    cashOutChainId,
    address,
    walletClient,
    selectedLoanReallocAmount,
    prepaidPercent,
    reallocateCollateralAsync,
    toast,
    resolvedPermissionsAddress,
    writeContractAsync,
    effectiveProjectId,
    loanProjectId,
    publicClient,
    projectTokenDecimals,
    tokenConfigForChain,
    collateralCountToTransfer,
    ensureBurnTokensPermission,
  ]);

  // ===== EFFECTS =====
  // Sync defaultTab with selectedTab if defaultTab changes
  useEffect(() => {
    if (defaultTab && defaultTab !== selectedTab) {
      setSelectedTab(defaultTab);
    }
  }, [defaultTab, selectedTab]);

  // Sync internalSelectedLoan with selectedLoan prop
  useEffect(() => {
    setInternalSelectedLoan(selectedLoan ?? null);
    // Also set the cashOutChainId based on the loan's chain
    if (selectedLoan?.chainId) {
      setCashOutChainId(selectedLoan.chainId.toString());
    } else if (selectedLoan?.chain) {
      setCashOutChainId(selectedLoan.chain.toString());
    }
  }, [selectedLoan]);

  // Don't auto-select any chain - let user choose manually
  // This prevents pre-selection issues and ensures user has full control

  // Handle reallocation pending status
  useEffect(() => {
    if (isReallocating) {
      setBorrowStatus("reallocation-pending");
    }
  }, [isReallocating]);

  // Transaction status effects
  useEffect(() => {
    if (!txHash && !reallocationTxHash) return;

    if (isTxLoading || isReallocationTxLoading) {
      setBorrowStatus("pending");
    } else if (isSuccess || isReallocationSuccess) {
      // Success persists until the user closes the dialog — no timed close.
      setBorrowStatus("success");
      toast({
        title: "Success",
        description: isReallocationSuccess
          ? "Loan adjusted successfully!"
          : "Loan created successfully!",
      });
    } else {
      setBorrowStatus("error");
    }
  }, [
    txHash,
    reallocationTxHash,
    isTxLoading,
    isReallocationTxLoading,
    isSuccess,
    isReallocationSuccess,
    toast,
  ]);

  // Calculate gross borrowed
  useEffect(() => {
    if (!collateralAmount || isNaN(Number(collateralAmount))) {
      setGrossBorrowedNative(0);
      return;
    }

    // Get token configuration for the selected chain. Null is LOADING — keep
    // the estimates at 0 instead of computing with ETH/18 defaults.
    const selectedChainTokenConfig = cashOutChainId ? tokenConfigForChain(cashOutChainId) : null;
    if (!selectedChainTokenConfig) {
      setGrossBorrowedNative(0);
      return;
    }
    const tokenDecimals = selectedChainTokenConfig.decimals;

    const percent =
      Number(
        formatUnits(parseUnits(collateralAmount, projectTokenDecimals), projectTokenDecimals),
      ) / Number(formatUnits(userProjectTokenBalance, projectTokenDecimals));
    const estimatedRaw = borrowableAmountRaw
      ? Number(formatUnits(borrowableAmountRaw, tokenDecimals))
      : 0;
    const adjusted = estimatedRaw * percent;
    setGrossBorrowedNative(adjusted);
  }, [
    collateralAmount,
    userProjectTokenBalance,
    borrowableAmountRaw,
    projectTokenDecimals,
    cashOutChainId,
    tokenConfigForChain,
  ]);

  // Terminal borrow statuses persist until the user closes the dialog
  // (handleOpenChange resets them) — timers must never clear an error state.

  // Borrow status effects
  useEffect(() => {
    if (borrowStatus === "waiting-signature") {
      const timeout = setTimeout(() => setShowingWaitingMessage(true), 250);
      return () => clearTimeout(timeout);
    } else {
      setShowingWaitingMessage(false);
    }
  }, [borrowStatus]);

  // Tab-related effects - COMBINED into one effect
  useEffect(() => {
    setShowLoanDetailsTable(selectedTab === "repay");
  }, [selectedTab]);

  // ===== RETURN VALUES =====
  return {
    // State
    isDialogOpen,
    selectedTab,
    showChart,
    showInfo,
    showOtherCollateral,
    showLoanDetailsTable,
    showRefinanceLoanDetailsTable,
    showingWaitingMessage,
    borrowStatus,
    grantsPermission,
    collateralAmount,
    selectedChainId,
    cashOutChainId,
    prepaidPercent,
    grossBorrowedNative,
    internalSelectedLoan,
    loading,

    // Derived values
    projectTokenDecimals,
    userProjectTokenBalance,
    selectedBalance,
    totalFixedFees,
    totalReallocationCollateral,
    netAvailableToBorrow,
    isOvercollateralized,
    extraCollateralBuffer,
    collateralHeadroom,
    collateralCountToTransfer,
    feeData,
    newLoanFeeData,
    displayYears,
    displayMonths,
    estimatedBorrowFromInputOnly,
    selectedLoanReallocAmount,
    currentBorrowableOnSelectedCollateral,
    newLoanBorrowableAmount,
    minimumBorrowAmountPreview,
    borrowableAmountRaw,

    // Actions
    handleOpenChange,
    handleChainSelection,
    handleLoanSelection,
    handleBorrow,
    setCollateralAmount,
    setPrepaidPercent,
    setShowChart,
    setShowInfo,
    setShowOtherCollateral,
    setInternalSelectedLoan,

    // Additional exports needed by component
    balances,
    address,
    setSelectedChainId,
    setCashOutChainId,

    // ===== PHASE 5: BASE TOKEN EXPORTS =====
    baseToken,
    selectedChainTokenConfig,
    tokenConfigForChain,
    // Undefined until the selected chain's token config resolves — consumers
    // must render a loading state, never assume ETH.
    selectedChainTokenSymbol: selectedChainTokenConfig
      ? (selectedChainTokenConfig.symbol ??
        getTokenSymbolFromAddress(selectedChainTokenConfig.token))
      : undefined,
  };
}
