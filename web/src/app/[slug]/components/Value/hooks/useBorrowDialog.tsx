import { useToast } from "@/components/ui/use-toast";
import { useBorrowableAmountFrom } from "@/hooks/useBorrowableAmountFrom";
import { useProjectBaseToken } from "@/hooks/useProjectBaseToken";
import {
  failedLine,
  reviewedCall,
  ReviewRefusal,
  SAFE_PROPOSAL_PENDING_LINE,
  useReviewedAction,
  type ReviewedAction,
  type ReviewedActionInput,
  type ReviewedCall,
} from "@/hooks/useReviewedAction";
import { ProjectOperation, SuckerGroupOperation, useBendystrawQuery } from "@/lib/bendystraw";
import { generateFeeData } from "@/lib/feeHelpers";
import { legacyIntents } from "@/lib/legacy-intents";
import {
  buildProtectedBorrowTx,
  buildProtectedReallocateCollateralTx,
  LOAN_SOURCE_CHANGED,
  LOAN_SOURCE_UNREADABLE,
  minimumBorrowAmount,
  readFreshBorrowableAmount,
  readLoanSource,
  sameLoanSource,
} from "@/lib/loanTransactions";
import { useJBChainId, useJBContractContext, useJBTokenContext } from "@/lib/nana/project";
import { useSuckersUserTokenBalance } from "@/lib/nana/suckers";
import type { JBChainId } from "@/lib/nana/types";
import { getTokenConfigForChain, getTokenSymbolFromAddress } from "@/lib/tokenUtils";
import { formatWalletError } from "@/lib/utils";
import {
  getRevnetLoanContract,
  JB_TOKEN_DECIMALS,
  jbPermissionsAbi,
  revDeployerAbi,
  revLoansAbi,
  RevnetCoreContracts,
} from "@bananapus/nana-sdk-core";
import { borrowIntent, loanIntent } from "@bananapus/nana-sdk-core/review";
import { hasPermissions, JBPermissionIdsV6 } from "@bananapus/nana-sdk-core/v6";
import {
  MIN_PREPAID_FEE_PERCENT,
  REV_PREPAID_FEE_PERCENT,
} from "@bananapus/nana-sdk-core/v6/loan-math";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, isAddressEqual, parseUnits } from "viem";
import { useAccount, usePublicClient, useReadContract, useWalletClient } from "wagmi";

/** What the loan dialog shows of its send. */
export type LoanStatus =
  | "idle"
  | "checking"
  | "granting-permission"
  | "waiting-signature"
  | "pending"
  // Proposed to a Safe: nothing is created until the Safe executes it.
  | "proposed"
  | "success"
  | "error"
  | "reallocation-pending"
  | "safe-unconfirmed";

/**
 * The loan send outside its runner: the reads before it, then which runner sends it, which
 * wallet prompt it last opened, and whether its run ended at a Safe proposal the runner follows.
 * Everything after that is the runner's own phase.
 */
type LoanAttempt =
  | { status: "idle" | "checking" | "error" }
  | {
      status: "sending";
      runner: "borrow" | "reallocation";
      prompt?: "grant" | "loan";
      proposed?: true;
    };

/** The loan's status: the attempt's own until it sends, then its runner's phase. */
function loanStatus(attempt: LoanAttempt, run: ReviewedAction): LoanStatus {
  if (attempt.status !== "sending") return attempt.status;
  switch (run.phase) {
    case "receipt":
      return "pending";
    // A proposed grant waits for its Safe; a proposed loan whose result can't be known is not failed.
    case "proposed":
      return run.held?.exit && attempt.prompt !== "grant" ? "safe-unconfirmed" : "proposed";
    case "done":
      return "success";
    // Ended without a send: failed, or closed until the send returns.
    case "idle":
      return run.error ? "error" : "checking";
    default:
      return attempt.prompt === "grant"
        ? "granting-permission"
        : attempt.prompt === "loan"
          ? "waiting-signature"
          : attempt.runner === "reallocation"
            ? "reallocation-pending"
            : "checking";
  }
}

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
  const [attempt, setAttempt] = useState<LoanAttempt>({ status: "idle" });
  // A send-time read of the loan source that failed or disagreed with the reviewed one.
  const [sourceNotice, setSourceNotice] = useState<{ key?: string; line: string }>();
  // The burn permission is read live at submission, so a run only learns it is
  // two prompts once the grant starts. Remembering that keeps the finished
  // grant listed instead of vanishing when the loan step begins.
  const [grantsPermission, setGrantsPermission] = useState(false);
  const [collateralAmount, setCollateralText] = useState("");
  /** The second argument (an option's name, or "auto") is kept for callers; keys don't read it. */
  const setCollateralAmount = useCallback(
    (value: string, _policy?: string) => setCollateralText(value),
    [],
  );
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

  // ===== PHASE 1: THE LOAN SOURCE, READ ONCHAIN =====
  // REVLoans prices a loan in its terminal's accounting context for the source token, and an
  // existing loan fixes its own revnet and token. Those come from the loans contract, never the
  // indexer: the indexer's token only says which of the revnet's own contexts to prefer. The read
  // starts when a chain is picked, so it has normally landed before the confirm opens.
  const indexedTokenConfig = selectedBorrowChainId
    ? getTokenConfigForChain(suckerGroupData, selectedBorrowChainId)
    : null;
  const selectedLoanId = internalSelectedLoan?.id;
  const preferredToken = indexedTokenConfig?.token;
  const loanSourceArgs = useMemo(
    () =>
      selectedBorrowChainId
        ? {
            chainId: selectedBorrowChainId,
            revnetId: effectiveProjectId,
            loanId: selectedLoanId != null ? BigInt(selectedLoanId) : undefined,
            preferredToken,
          }
        : undefined,
    [selectedBorrowChainId, effectiveProjectId, selectedLoanId, preferredToken],
  );
  const loanSourceKey = loanSourceArgs
    ? [
        loanSourceArgs.chainId,
        loanSourceArgs.revnetId,
        loanSourceArgs.loanId,
        loanSourceArgs.preferredToken,
      ].join(":")
    : undefined;
  const loanSourceQuery = useQuery({
    queryKey: ["revLoanSource", loanSourceKey],
    enabled: !!publicClient && !!loanSourceArgs,
    staleTime: 60_000,
    retry: 1,
    retryDelay: 250,
    // A failed read retries on its own, so the line clears without a click.
    refetchInterval: (query) => (query.state.status === "error" ? 15_000 : false),
    queryFn: () => readLoanSource(publicClient!, loanSourceArgs!),
  });
  const loanSource = loanSourceQuery.data;
  const refetchLoanSource = loanSourceQuery.refetch;
  const reviewedLoanSource = loanSource;
  const loanSourceUpdatedAt = loanSourceQuery.dataUpdatedAt;
  useEffect(() => {
    // A read that lands again ends a send-time failure.
    if (loanSourceUpdatedAt)
      setSourceNotice((notice) => (notice?.line === LOAN_SOURCE_UNREADABLE ? undefined : notice));
  }, [loanSourceUpdatedAt]);
  const notice = sourceNotice?.key === loanSourceKey ? sourceNotice?.line : undefined;
  const loanSourceLine = loanSourceQuery.isError ? LOAN_SOURCE_UNREADABLE : (notice ?? null);
  // Only an unreadable source blocks the send; a changed one is shown and confirmed again.
  const loanSourceBlocked = loanSourceLine === LOAN_SOURCE_UNREADABLE;

  // Get the correct token configuration for a specific chain: the selected chain's is the
  // onchain loan source (null while it loads or fails); any other chain's is display only.
  const indexedSymbol =
    loanSource && indexedTokenConfig && isAddressEqual(indexedTokenConfig.token, loanSource.token)
      ? indexedTokenConfig.symbol
      : undefined;
  const selectedLoanSourceConfig = useMemo(
    () =>
      loanSource
        ? {
            token: loanSource.token,
            decimals: loanSource.decimals,
            currency: loanSource.currency,
            symbol: indexedSymbol ?? getTokenSymbolFromAddress(loanSource.token),
          }
        : null,
    [loanSource, indexedSymbol],
  );
  const tokenConfigForChain = useCallback(
    (chainId: string | number) =>
      Number(chainId) === selectedBorrowChainId
        ? selectedLoanSourceConfig
        : getTokenConfigForChain(suckerGroupData, Number(chainId)),
    [suckerGroupData, selectedBorrowChainId, selectedLoanSourceConfig],
  );

  // V6 project ids are a per-chain namespace: the page's prop is the ROUTE chain's id, and
  // quoting it on the loan's chain prices a different revnet. Per-loan reads key on the
  // loan's own revnet as the loans contract reports it, falling back to the loan row's id
  // until that read lands (no quote runs before it), else the sucker-pair id for the chain.
  const loanProjectId =
    (internalSelectedLoan ? loanSource?.revnetId : undefined) ??
    (internalSelectedLoan?.projectId != null
      ? BigInt(internalSelectedLoan.projectId)
      : effectiveProjectId);

  // Every quote on the selected chain prices the revnet the loans contract names.
  const quoteRevnetId = loanSource?.revnetId ?? effectiveProjectId;

  // Calculate total fixed fees from contract values (in basis points)
  // Until the reads land, the protocol's own constants stand in: a fallback of 0 overstated
  // "to your wallet after fees" by 3.5%.
  const totalFixedFees = Number(
    (minPrepaidFeePercent ?? MIN_PREPAID_FEE_PERCENT) +
      (revPrepaidFeePercent ?? REV_PREPAID_FEE_PERCENT),
  );

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
            quoteRevnetId,
            userProjectTokenBalance,
            BigInt(selectedChainTokenConfig.decimals),
            BigInt(selectedChainTokenConfig.currency),
          ] as const)
        : undefined,
  });

  const { data: estimatedBorrowFromInputOnly, isError: inputQuoteError } = useBorrowableAmountFrom({
    address: revLoansContractAddress,
    chainId: cashOutChainId ? (Number(cashOutChainId) as JBChainId) : undefined,
    args:
      collateralAmount && selectedChainTokenConfig
        ? [
            quoteRevnetId,
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
  const borrow = useReviewedAction();
  const reallocation = useReviewedAction();
  // The runner the attempt sends with.
  const sender =
    attempt.status === "sending" && attempt.runner === "reallocation" ? reallocation : borrow;
  const borrowStatus = loanStatus(attempt, sender);
  useEffect(() => {
    if (borrowStatus === "idle") setGrantsPermission(false);
  }, [borrowStatus]);
  const signing = (runner: ReviewedAction) => runner.busy && runner.status !== "receipt";
  // A Safe proposal reads as pending until its Safe executes it, unless its result can't be known.
  const confirming = (runner: ReviewedAction) =>
    runner.status === "receipt" || (runner.phase === "proposed" && !runner.held?.exit);
  const isWriteLoading = signing(borrow);

  // Transaction status
  const isTxLoading = confirming(borrow);

  /** One reviewed loan step, sent exactly; a failure throws its line. */
  const send = async (runner: ReviewedAction, action: ReviewedActionInput) => {
    const result = await runner.run(action);
    if (result?.status === "failed") throw new ReviewRefusal(failedLine(result));
    return result;
  };

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
  const { data: newLoanBorrowableAmount, isError: newLoanQuoteError } = useBorrowableAmountFrom({
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

  const borrowQuote = internalSelectedLoan ? newLoanBorrowableAmount : estimatedBorrowFromInputOnly;
  const borrowQuoteError = internalSelectedLoan ? newLoanQuoteError : inputQuoteError;
  const minimumBorrowAmountPreview = (() => {
    if (borrowQuote === undefined || borrowQuote <= 0n) return undefined;
    try {
      return minimumBorrowAmount(borrowQuote);
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
        setCollateralAmount("", "auto");
        setPrepaidPercent("2.5");
        setGrossBorrowedNative(0);

        // Clear all status states
        setAttempt({ status: "idle" });

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
    [defaultTab, setCollateralAmount],
  );

  const handleChainSelection = useCallback(
    (chainId: number) => {
      const selected = balances?.find((b) => b.chainId === chainId);
      const collateral = selected ? formatUnits(selected.balance.value, projectTokenDecimals) : "0";
      setSelectedChainId(chainId);
      setCashOutChainId(chainId.toString());
      setCollateralAmount(collateral, "auto");
      setInternalSelectedLoan(null);
    },
    [balances, projectTokenDecimals, setCollateralAmount],
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
   * The BURN_TOKENS grant REVLoans still needs for this account+project, as the first step of the
   * loan's one review, or null when it already holds it. Both submit paths use it: a reallocation
   * that ADDS collateral burns tokens exactly as a borrow does.
   */
  const burnPermissionCall = useCallback(async (): Promise<ReviewedCall | null> => {
    if (
      !publicClient ||
      !address ||
      !cashOutChainId ||
      !revLoansContractAddress ||
      !resolvedPermissionsAddress
    )
      throw new Error("This network is unavailable. Nothing was submitted.");
    // Read live at submission: the indexer can lag a new grant. Loans need BURN_TOKENS (11),
    // never the much broader ROOT permission (1).
    const held = await hasPermissions(publicClient, {
      chainId: Number(cashOutChainId) as JBChainId,
      operator: revLoansContractAddress,
      account: address,
      projectId: loanProjectId,
      permissionIds: [JBPermissionIdsV6.BURN_TOKENS],
    });
    setGrantsPermission(!held);
    return held
      ? null
      : reviewedCall({
          chainId: Number(cashOutChainId) as JBChainId,
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
  }, [
    address,
    cashOutChainId,
    loanProjectId,
    publicClient,
    resolvedPermissionsAddress,
    revLoansContractAddress,
  ]);

  /**
   * The loan's one run: the grant first when one is needed, then the loan call. Only the loan's
   * hash is the loan's; a grant that went to a Safe as a proposal ends the run there.
   * "closed" when the review was closed and nothing was sent.
   */
  const sendLoan = useCallback(
    async (
      kind: "borrow" | "reallocation",
      grant: ReviewedCall | null,
      loan: ReviewedCall,
      context: ReviewedActionInput["context"],
    ) => {
      setAttempt({ status: "sending", runner: kind });
      const result = await send(kind === "borrow" ? borrow : reallocation, {
        account: address,
        context,
        scope: grant ? loan.intent : undefined,
        beforeWallet: (_call, step) =>
          setAttempt({
            status: "sending",
            runner: kind,
            prompt: grant && step === 0 ? "grant" : "loan",
          }),
        calls: [...(grant ? [grant] : []), grant ? { ...loan, dependsOnPrior: true } : loan],
      });
      if (!result) return "closed" as const;
      if (result.status === "proposed")
        setAttempt((now) =>
          now.status === "sending" && now.runner === kind ? { ...now, proposed: true } : now,
        );
      if (grant && result.status === "proposed" && result.step === 0) {
        toast({
          title: "Safe permission proposal submitted",
          description: SAFE_PROPOSAL_PENDING_LINE,
        });
      }
      return result.status;
    },
    [address, borrow, reallocation, toast],
  );

  const handleBorrow = useCallback(
    async (context?: ReviewedActionInput["context"]) => {
      // The loan source is read again from the loans contract at send: the quote, the
      // minimum and the calldata all use what the chain says now.
      // Busy from the first read, so the dialog cannot close under the send.
      setAttempt({ status: "checking" });
      let selectedChainTokenConfig: Awaited<ReturnType<typeof readLoanSource>>;
      try {
        if (!publicClient || !loanSourceArgs) throw new Error(LOAN_SOURCE_UNREADABLE);
        selectedChainTokenConfig = await readLoanSource(publicClient, loanSourceArgs);
      } catch {
        setSourceNotice({ key: loanSourceKey, line: LOAN_SOURCE_UNREADABLE });
        setAttempt({ status: "error" });
        void refetchLoanSource();
        return;
      }
      // The confirm showed the cached source; if the chain now says otherwise, show the new
      // terms in place and send nothing until they are confirmed.
      if (!reviewedLoanSource || !sameLoanSource(reviewedLoanSource, selectedChainTokenConfig)) {
        setSourceNotice({ key: loanSourceKey, line: LOAN_SOURCE_CHANGED });
        setAttempt({ status: "error" });
        void refetchLoanSource();
        return;
      }
      setSourceNotice(undefined);

      if (
        internalSelectedLoan &&
        collateralAmount !== undefined &&
        !isNaN(Number(collateralAmount))
      ) {
        // Reallocation path - allow 0 additional capital
        if (!internalSelectedLoan || !cashOutChainId || !address || !walletClient) {
          setAttempt({ status: "error" });
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
          setAttempt({ status: "error" });
          toast({
            variant: "destructive",
            title: "Cannot refinance",
            description: "These tokens cannot back the original debt. Add more tokens.",
          });
          return;
        }

        // Busy from here, as the standard path is: the reads before the wallet
        // prompt are part of the send, and its dialog must not close under them.
        setAttempt({ status: "checking" });

        try {
          // Adding collateral burns project tokens, exactly as the standard borrow path does, so
          // it needs the same BURN_TOKENS grant; without it the refinance fails in simulation with
          // no grant step offered. A permission read that fails ends here, in the error state.
          const grant = collateralCountToAdd > 0n ? await burnPermissionCall() : null;

          if (!publicClient) {
            throw new Error("This network is unavailable. Nothing was submitted.");
          }

          const newLoanCollateralCount = collateralCountToTransfer + collateralCountToAdd;
          const freshBorrowableAmount = await readFreshBorrowableAmount(publicClient, {
            chainId: Number(cashOutChainId) as JBChainId,
            // The loan's chain carries its OWN revnet id — the page's prop is the route chain's.
            // A mismatch quotes a different revnet's borrowable amount, which then becomes both the
            // tx's collateral-transfer argument and its slippage floor.
            revnetId: selectedChainTokenConfig.revnetId,
            collateralCount: newLoanCollateralCount,
            decimals: BigInt(selectedChainTokenConfig.decimals),
            currency: BigInt(selectedChainTokenConfig.currency),
          });

          // Held by the loan alone: the borrowable amount and the collateral moved follow its capacity.
          const sent = await sendLoan(
            "reallocation",
            grant,
            reviewedCall(
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
              {
                intent: loanIntent({
                  chainId: Number(cashOutChainId),
                  loanId: BigInt(internalSelectedLoan.id),
                }),
                legacyIntents: legacyIntents.reallocate(internalSelectedLoan.id),
              },
            ),
            context,
          );
          if (sent === "closed") setAttempt({ status: "idle" });
          return sent;
        } catch (err) {
          setAttempt({ status: "error" });
          toast({
            variant: "destructive",
            title: "Refinancing failed",
            description: formatWalletError(err),
          });
        }
      } else {
        // Standard borrow path
        try {
          setAttempt({ status: "checking" });

          if (
            !walletClient ||
            !publicClient ||
            !address ||
            !cashOutChainId ||
            !resolvedPermissionsAddress
          ) {
            setAttempt({ status: "error" });
            return;
          }

          const feeBasisPoints = Math.round(parseFloat(prepaidPercent) * 10);
          const grant = await burnPermissionCall();

          // collateralBigInt should be in project token decimals, not base token decimals
          const collateralBigInt = parseUnits(collateralAmount, projectTokenDecimals);

          try {
            const freshBorrowableAmount = await readFreshBorrowableAmount(publicClient, {
              chainId: Number(cashOutChainId) as JBChainId,
              revnetId: selectedChainTokenConfig.revnetId,
              collateralCount: collateralBigInt,
              decimals: BigInt(selectedChainTokenConfig.decimals),
              currency: BigInt(selectedChainTokenConfig.currency),
            });

            // Held by the project and holder: the amount and collateral are not part of it.
            const sent = await sendLoan(
              "borrow",
              grant,
              reviewedCall(
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
                {
                  intent: borrowIntent({
                    chainId: Number(cashOutChainId),
                    project: effectiveProjectId,
                    holder: address,
                  }),
                  legacyIntents: legacyIntents.borrow({
                    revnetId: effectiveProjectId,
                    token: selectedChainTokenConfig.token,
                    collateral: collateralBigInt,
                    prepaidFeePercent: feeBasisPoints,
                  }),
                },
              ),
              context,
            );
            if (sent === "closed") setAttempt({ status: "idle" });
            return sent;
          } catch (err) {
            setAttempt({ status: "error" });
            toast({
              variant: "destructive",
              title: "Loan not submitted",
              description: formatWalletError(err),
            });
            return;
          }
        } catch (err) {
          setAttempt({ status: "error" });
          toast({
            variant: "destructive",
            title: "Borrow Failed",
            description: formatWalletError(err),
          });
        }
      }
    },
    [
      internalSelectedLoan,
      collateralAmount,
      cashOutChainId,
      address,
      walletClient,
      selectedLoanReallocAmount,
      prepaidPercent,
      toast,
      resolvedPermissionsAddress,
      effectiveProjectId,
      publicClient,
      projectTokenDecimals,
      loanSourceArgs,
      loanSourceKey,
      refetchLoanSource,
      reviewedLoanSource,
      collateralCountToTransfer,
      burnPermissionCall,
      sendLoan,
    ],
  );

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

  // The Safe ran the permission after its run ended: the loan is still to send, from its button again.
  const grantSettled =
    borrow.settledStep === 0 ? "borrow" : reallocation.settledStep === 0 ? "reallocation" : null;
  useEffect(() => {
    if (!grantSettled) return;
    setAttempt((now) =>
      now.status === "sending" && now.runner === grantSettled ? { status: "idle" } : now,
    );
    toast({
      title: "Safe granted the permission",
      description: `Review the loan again to ${grantSettled === "borrow" ? "borrow" : "refinance"}.`,
    });
  }, [grantSettled, toast]);

  // A followed proposal whose runner went idle with no error was released (from Account, say):
  // nothing is pending, and the loan is sent from its button again. A new run's own idle start
  // is not this: its attempt has not ended at a proposal.
  const released =
    attempt.status === "sending" && !!attempt.proposed && sender.phase === "idle" && !sender.error;
  useEffect(() => {
    if (released) setAttempt({ status: "idle" });
  }, [released]);

  // Success persists until the user closes the dialog: no timed close.
  const adjusted = attempt.status === "sending" && attempt.runner === "reallocation";
  useEffect(() => {
    if (borrowStatus === "success")
      toast({ title: "Success", description: adjusted ? "Loan adjusted." : "Loan opened." });
  }, [borrowStatus, adjusted, toast]);

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
    /** One line when the onchain loan token can't be read; the loan stays off. */
    borrowQuote,
    borrowQuoteError,
    loanSourceLine,
    loanSourceBlocked,
    loanSourcePending: !!loanSourceArgs && loanSourceQuery.isPending && !loanSourceQuery.isError,
    // Undefined until the selected chain's token config resolves — consumers
    // must render a loading state, never assume ETH.
    selectedChainTokenSymbol: selectedChainTokenConfig
      ? (selectedChainTokenConfig.symbol ??
        getTokenSymbolFromAddress(selectedChainTokenConfig.token))
      : undefined,
  };
}
