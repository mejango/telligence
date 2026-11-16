"use client";

import {
  failedLine,
  reviewedCall,
  ReviewRefusal,
  SafeProposalPendingError,
  useReviewedAction,
} from "@/hooks/useReviewedAction";
import { fence, type TabLocks } from "@/lib/fence";
import { confirmCheckedIt, confirmHeldWriteExit, confirmUnreadableExit } from "@/lib/flow-choice";
import * as markee from "@/lib/markee";
import { recoverMarkeeSubmission } from "@/lib/markee-recovery";
import { safeExecutionResult, safeExecutionRunsCalls } from "@/lib/safe-service-config";
import {
  contractTransactionKey,
  recordTransactionActivity,
  refreshTransactionActivities,
  releaseTransactionActivityVerification,
  requireTransactionActivityPersistence,
  settleTransactionActivityFailure,
  transactionActivityForHash,
  updateTransactionActivity,
} from "@/lib/transaction-activity";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import { savedAttempts } from "@/lib/write-hold";
import {
  browserLocks,
  HELD_RELEASED_ELSEWHERE_LINE,
  HELD_RELEASED_LINE,
  intent,
  settledLine,
  writeIntentKey,
  type SavedAttempt,
  type SavedAttemptOutcome,
} from "@bananapus/nana-sdk-core/review";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  encodeFunctionData,
  isAddress,
  isHash,
  isHex,
  parseEther,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { useAccount, usePublicClient } from "wagmi";

type Kind = "board" | "message" | "approval" | "start" | "update" | "stop" | "withdraw";
type Pending = {
  kind: Kind;
  id: string;
  target: Address;
  data: Hex;
  value: string;
  hash?: Hex;
  rate?: string;
  allowance?: string;
};
type Recovery = {
  account: Address;
  board?: Address;
  message?: string;
  messageAddress?: Address;
  monthlyInput?: string;
  pending?: Pending;
};
const RECOVERY_KEY = "revnet:markee-rent:recovery:v1";
/** A saved submission that went through, whose Markee result still can't be verified. */
const SETTLED_UNVERIFIED =
  "This transaction went through, but its Markee result couldn't be verified. Check the board before sending again.";
/**
 * A Markee step's write intent: the account, the step and the contract it acts on, never the
 * rate, message or calldata a retry regenerates. No SDK builder covers it.
 */
function markeeIntent(account: Address, step: Pick<Pending, "kind" | "target">): string {
  return writeIntentKey("markee", {
    chainId: markee.MARKEE_CHAIN_ID,
    account: intent.address(account),
    step: step.kind,
    target: intent.address(step.target),
  });
}
function configurationKey(value: unknown) {
  return JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item));
}
function loadRecovery(): Recovery | undefined {
  const raw = window.localStorage.getItem(RECOVERY_KEY);
  if (!raw) return;
  if (raw.length > 32768) throw new Error("Markee recovery storage is too large.");
  const value = JSON.parse(raw) as Recovery;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.account !== "string" ||
    !isAddress(value.account) ||
    (value.message !== undefined &&
      (typeof value.message !== "string" || value.message.length > 8192)) ||
    (value.monthlyInput !== undefined &&
      (typeof value.monthlyInput !== "string" ||
        !/^\d+(?:\.\d{1,18})?$/.test(value.monthlyInput))) ||
    (value.board && !isAddress(value.board)) ||
    (value.messageAddress && !isAddress(value.messageAddress)) ||
    (value.pending &&
      (typeof value.pending.id !== "string" ||
        value.pending.id.length > 16384 ||
        (value.pending.rate !== undefined && !/^\d{1,30}$/.test(value.pending.rate)) ||
        (value.pending.allowance !== undefined && !/^\d{1,78}$/.test(value.pending.allowance)) ||
        !value.pending.id ||
        !isAddress(value.pending.target) ||
        !isHex(value.pending.data) ||
        !/^\d+$/.test(value.pending.value) ||
        (value.pending.hash && !isHash(value.pending.hash)) ||
        !["board", "message", "approval", "start", "update", "stop", "withdraw"].includes(
          value.pending.kind,
        )))
  )
    throw new Error("Markee recovery storage is invalid. Do not submit again until it is checked.");
  return value;
}
/** A sent step whose confirm closed before its result: the saved hash is checked, never resent. */
export const MARKEE_SENT_UNCHECKED = "Sent. Check its result here before sending again.";

/** Saves the Markee journal, and the board it just created, when it created one. */
function saveRecovery(value: Recovery, createdBoard?: Address) {
  requireTransactionActivityPersistence();
  if (createdBoard) window.localStorage.setItem(markee.MARKEE_BOARD_KEY, createdBoard);
  window.localStorage.setItem(RECOVERY_KEY, JSON.stringify(value));
}

/** Reviewed wallet writes and durable, receipt-qualified recovery for the homepage Rent board. */
export function useMarkee(initialBoardAddress?: Address) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: markee.MARKEE_CHAIN_ID });
  const ensClient = usePublicClient({ chainId: 1 });
  const [boardAddress, setBoardAddress] = useState<Address | undefined>(initialBoardAddress);
  const [board, setBoard] = useState<markee.BoardState>();
  const [wallet, setWallet] = useState<markee.WalletState>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const active = useRef<
    { recovery: Recovery; pending: Pending; guard: () => Promise<void> } | undefined
  >(undefined);
  const running = useRef(false);
  const readGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++readGeneration.current;
    setBoard(undefined);
    setWallet(undefined);
    if (!client) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let selected: Address | undefined = initialBoardAddress ?? boardAddress;
    try {
      const saved = loadRecovery();
      setPending(!!saved?.pending);
      const savedBoard = markee.savedMarkeeBoard();
      selected = initialBoardAddress ?? boardAddress ?? savedBoard;
      if (!selected) {
        setBoard(undefined);
        setWallet(undefined);
        return;
      }
      const next = await markee.readMarkeeBoard(client, selected);
      const nextWallet = address ? await markee.readMarkeeWallet(client, next, address) : undefined;
      if (readGeneration.current !== generation) return;
      setBoardAddress(selected);
      setBoard(next);
      setWallet(nextWallet);
      setError(undefined);
    } catch (cause) {
      if (readGeneration.current === generation) {
        setBoard(undefined);
        setWallet(undefined);
        setError(cause instanceof Error ? cause.message : String(cause));
        // Exit rights survive mutable advertising/payment policy changes.
        if (selected && address) {
          try {
            const source = await markee.readMarkeeExitBoard(client, selected);
            const exitWallet = await markee.readMarkeeWallet(client, source, address);
            if (readGeneration.current === generation) setWallet(exitWallet);
          } catch {
            /* Unsupported source identity remains unavailable. */
          }
        }
      }
    } finally {
      if (readGeneration.current === generation) setLoading(false);
    }
  }, [address, client, boardAddress, initialBoardAddress]);
  useEffect(() => {
    const generationRef = readGeneration;
    void refresh();
    return () => {
      generationRef.current++;
    };
  }, [refresh]);

  const { run, following, dismiss } = useReviewedAction();
  /** The Markee lock `act` holds: every journal and activity write checks it first. */
  const held = useRef<TabLocks>([]);
  const write = (journal: () => void) => fence(held.current, journal)();
  /** The Markee journal's record of the step at the wallet boundary, before the wallet opens. */
  const beforeWallet = async () => {
    const current = active.current;
    if (!current) throw new ReviewRefusal("Markee action is unavailable.");
    if (loadRecovery()?.pending)
      throw new ReviewRefusal(
        "Another Markee submission is already held. Check it before proceeding.",
      );
    current.recovery.pending = current.pending;
    await write(() => {
      saveRecovery(current.recovery);
      recordTransactionActivity({
        id: current.pending.id,
        hash: undefined,
        executionHash: undefined,
        createdAt: Date.now(),
        kind: "direct",
        account: current.recovery.account,
        chainId: markee.MARKEE_CHAIN_ID,
        title: "Markee Rent",
        status: "pending",
        manualVerificationRequired: true,
        message: "Wallet submission may be in progress. Check its result before sending again.",
      });
    });
    requireTransactionActivityPersistence();
    setPending(true);
  };
  /**
   * Nothing was sent for `step` (a gate refused, or the wallet said no): it is no longer held.
   * Refused for a lapsed lock, core runs it again once the lock is taken back.
   */
  const unsent = async (step: Pending) => {
    const saved = loadRecovery();
    if (saved?.pending?.id !== step.id || saved.pending.hash) return;
    await write(() => {
      const now = loadRecovery()!;
      delete now.pending;
      saveRecovery(now);
      updateTransactionActivity(step.id, {
        status: "failed",
        manualVerificationRequired: false,
        message: "Nothing was sent.",
      });
    });
    setPending(false);
  };

  /** What `receipt` shows `step` did on Markee: the board or message it created. Throws when it can't be verified. */
  const markeeEffects = async (
    recovery: Recovery,
    step: Pending,
    receipt: { logs: Parameters<typeof markee.decodeBoardCreated>[0] },
  ): Promise<Pick<Recovery, "board" | "messageAddress">> => {
    if (!client) throw new Error("Base RPC unavailable.");
    if (step.kind === "board") {
      const created = markee.decodeBoardCreated(receipt.logs);
      await markee.readMarkeeBoard(client, created.board);
      return { board: created.board };
    }
    if (!recovery.board) throw new Error("Saved board is missing.");
    const verifiedBoard = await markee.readMarkeeExitBoard(client, recovery.board);
    if (step.kind === "message")
      return {
        messageAddress: markee.decodeMarkeeCreated(
          receipt.logs,
          recovery.board,
          recovery.account,
          recovery.message ?? "",
          "",
        ),
      };
    const state = await markee.readMarkeeWallet(client, verifiedBoard, recovery.account);
    if (step.kind === "approval" && state.allowance < BigInt(step.allowance ?? "0"))
      throw new Error("ETHx approval could not be verified.");
    if (
      (step.kind === "start" || step.kind === "update") &&
      (state.flowRate !== BigInt(step.rate ?? "0") ||
        state.backerMarkee.toLowerCase() !== recovery.messageAddress?.toLowerCase())
    )
      throw new Error("The exact Markee stream could not be verified.");
    if (step.kind === "stop" && state.flowRate !== 0n)
      throw new Error("Stream cancellation could not be verified.");
    if (step.kind === "withdraw" && state.deposit !== 0n)
      throw new Error("Deposit withdrawal could not be verified.");
    return {};
  };

  /**
   * Saves a verified step's result and lets the submission go: persisted before any later step,
   * and only while the journal still holds exactly this step.
   */
  const completeStep = async (
    recovery: Recovery,
    step: Pending,
    effects: Pick<Recovery, "board" | "messageAddress">,
    hash = step.hash,
  ) => {
    const stillSaved = loadRecovery();
    const stillPending = stillSaved?.pending;
    if (
      !stillPending ||
      configurationKey(stillPending) !== configurationKey(step) ||
      stillSaved?.account.toLowerCase() !== recovery.account.toLowerCase()
    )
      throw new Error("The saved Markee submission changed during verification.");
    Object.assign(recovery, effects);
    const createdBoard = step.kind === "board" ? recovery.board : undefined;
    delete recovery.pending;
    await write(() => {
      saveRecovery(recovery, createdBoard);
      if (hash) releaseTransactionActivityVerification(hash, "Markee onchain result verified.");
      updateTransactionActivity(step.id, {
        status: "success",
        manualVerificationRequired: false,
        message: "Markee onchain result verified.",
      });
    });
    if (createdBoard) setBoardAddress(createdBoard);
    setPending(false);
  };

  /** The step this tab just sent: its receipt verified exactly, its result saved. */
  const verifyPending = async (recovery: Recovery) => {
    if (!client || !recovery.pending) throw new Error("No saved transaction to verify.");
    const step = recovery.pending;
    // A missing wallet reply is not proof that no transaction was broadcast.
    if (!step.hash)
      throw new Error(
        "The wallet submission result is unknown. Check wallet and account activity; do not submit again.",
      );
    const activity = transactionActivityForHash(step.hash);
    if (activity?.kind === "safe" && !activity.executionHash) {
      if (activity.status === "safe-proposed") throw new SafeProposalPendingError(step.hash);
      throw new Error("The Safe proposal has no verified execution receipt yet.");
    }
    const receipt = await waitForReceiptWithRetry(client, activity?.executionHash ?? step.hash);
    const transaction = await client.getTransaction({ hash: receipt.transactionHash });
    if (transaction.hash.toLowerCase() !== receipt.transactionHash.toLowerCase())
      throw new Error("The transaction hash does not match the verified receipt.");
    if (activity?.kind === "safe") {
      if (
        !activity.safeProposal ||
        activity.safeProposal.calls.length !== 1 ||
        activity.safeProposal.calls[0].to.toLowerCase() !== step.target.toLowerCase() ||
        activity.safeProposal.calls[0].data.toLowerCase() !== step.data.toLowerCase() ||
        BigInt(activity.safeProposal.calls[0].value) !== BigInt(step.value) ||
        !safeExecutionRunsCalls(
          transaction,
          recovery.account,
          activity.safeProposal.calls,
          activity.safeProposal.batch,
        ) ||
        safeExecutionResult(receipt, recovery.account, step.hash).status !== "success"
      )
        throw new Error("The exact reviewed Safe execution could not be verified.");
    } else if (
      transaction.from.toLowerCase() !== recovery.account.toLowerCase() ||
      transaction.to?.toLowerCase() !== step.target.toLowerCase() ||
      transaction.input.toLowerCase() !== step.data.toLowerCase() ||
      transaction.value !== BigInt(step.value)
    )
      throw new Error("The transaction does not match the reviewed Markee call.");
    if (
      receipt.transactionHash.toLowerCase() !== (activity?.executionHash ?? step.hash).toLowerCase()
    )
      throw new Error("The receipt does not match the submitted transaction.");
    if (receipt.status !== "success") {
      delete recovery.pending;
      await write(() => {
        updateTransactionActivity(step.id, {
          status: "failed",
          manualVerificationRequired: false,
          message: "Markee transaction reverted.",
        });
        if (activity)
          updateTransactionActivity(activity.id, {
            status: "failed",
            manualVerificationRequired: false,
            message: "Markee transaction reverted.",
          });
        saveRecovery(recovery);
      });
      setPending(false);
      throw new Error("The Markee transaction reverted. It can be reviewed again.");
    }
    await completeStep(recovery, step, await markeeEffects(recovery, step, receipt));
  };

  type Call = {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
  };
  const send = async (
    recovery: Recovery,
    kind: Kind,
    call: Call,
    guard: () => Promise<void>,
    expected: Partial<Pending> = {},
  ) => {
    if (loadRecovery()?.pending)
      throw new Error("Verify the saved Markee transaction before taking another action.");
    const data = encodeFunctionData({
      abi: call.abi,
      functionName: call.functionName,
      args: call.args,
    });
    const key = contractTransactionKey(recovery.account, markee.MARKEE_CHAIN_ID, { ...call, data });
    const step: Pending = {
      kind,
      id: `markee:${key}`,
      target: call.address,
      data,
      value: String(call.value ?? 0n),
      ...expected,
    };
    active.current = { recovery, pending: step, guard };
    setStatus(`Review ${kind === "start" ? "Take over" : kind}`);
    const result = await run({
      account: recovery.account,
      title: "Markee Rent",
      // Core checks the Markee lock before the wallet opens.
      locks: held.current,
      reverify: async () => {
        if (!active.current) throw new ReviewRefusal("Markee action is unavailable.");
        await active.current.guard();
      },
      beforeWallet,
      onUnsent: () => unsent(step),
      // The hash is the Markee journal's before its receipt is awaited. Refused for a lapsed
      // lock, core saves it once the lock is taken back.
      onSubmitted: async (_call, _step, hash) => {
        step.hash = hash;
        recovery.pending = step;
        await write(() => {
          const now = loadRecovery()!;
          if (now.pending?.id !== step.id) return;
          now.pending = { ...now.pending, hash };
          saveRecovery(now);
          updateTransactionActivity(step.id, {
            message: "Submitted. Verifying the exact Markee result.",
          });
        });
      },
      calls: [
        reviewedCall(
          { ...call, chainId: markee.MARKEE_CHAIN_ID },
          { intent: markeeIntent(recovery.account, step) },
        ),
      ],
    });
    // Null after a hash: the confirm closed while the step's hold still follows it.
    if (!result)
      throw new ReviewRefusal(
        step.hash ? MARKEE_SENT_UNCHECKED : "Review canceled. Nothing was sent.",
      );
    // Nothing sent: the run's own line. Sent: the step's exact result decides.
    if (!step.hash)
      throw new ReviewRefusal(
        result.status === "failed" ? failedLine(result) : "Nothing was sent.",
      );
    setStatus("Verifying onchain result");
    await verifyPending(recovery);
  };
  const act = async (run: () => Promise<string | void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await browserLocks().request(RECOVERY_KEY, { ifAvailable: true }, async (lock) => {
        if (!lock)
          throw new Error(
            "Another tab is handling a Markee action. Finish or check that action first.",
          );
        held.current = [lock];
        setStatus((await run()) ?? "Verified");
        await refresh();
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("Action needs attention");
    } finally {
      running.current = false;
      held.current = [];
      active.current = undefined;
      setBusy(false);
    }
  };
  const context = () => {
    if (!client || !address) throw new Error("Connect a wallet to continue.");
    const saved = loadRecovery();
    if (saved?.pending)
      throw new Error(
        "A saved Markee transaction needs verification. Use Check transaction first.",
      );
    return { client, account: address };
  };
  const guardBoard = async (selected: Address) => {
    if (!client) throw new Error("Base RPC unavailable.");
    await markee.readMarkeeExitBoard(client, selected);
  };

  const createBoard = () =>
    act(async () => {
      const { client, account } = context();
      if (account.toLowerCase() !== markee.MARKEE_ADMIN.toLowerCase())
        throw new Error("Connect the selected Markee admin to create the board.");
      if (boardAddress || window.localStorage.getItem(markee.MARKEE_BOARD_KEY))
        throw new Error(
          "The Markee board is already configured. Refresh to use the existing board.",
        );
      const verifyBeneficiary = async () => {
        if (!ensClient) throw new Error("Ethereum ENS verification is unavailable.");
        const resolved = await ensClient.getEnsAddress({ name: "team.rev.eth" });
        if (resolved?.toLowerCase() !== markee.MARKEE_BENEFICIARY.toLowerCase())
          throw new Error(
            "team.rev.eth no longer resolves to the reviewed beneficiary. Review setup again.",
          );
        const code = await client.getCode({ address: markee.MARKEE_BENEFICIARY });
        if (!code || code === "0x")
          throw new Error("The team beneficiary contract is unavailable on Base.");
      };
      await verifyBeneficiary();
      const factory = await markee.readMarkeeFactory(client);
      await send(
        { account },
        "board",
        {
          address: markee.MARKEE_FACTORY,
          abi: markee.factoryAbi,
          functionName: "createLeaderboard",
          args: [markee.MARKEE_BENEFICIARY, "revnet.money", "website", "revnet.money"],
        },
        async () => {
          await verifyBeneficiary();
          const current = await markee.readMarkeeFactory(client);
          if (configurationKey(current) !== configurationKey(factory))
            throw new Error("Markee factory settings changed. Review again.");
        },
      );
    });
  const takeover = (message: string, monthlyInput: string) =>
    act(async () => {
      const { client, account } = context();
      if (!boardAddress) throw new Error("Create the Markee board first.");
      const selected = boardAddress;
      const currentBoard = await markee.readMarkeeBoard(client, selected);
      if (!message.trim()) throw new Error("Enter an advertisement message.");
      markee.validateMarkeeText(message, currentBoard.maxMessageLength);
      const rate = markee.parseMonthlyRate(monthlyInput, currentBoard.minimumMonthlyRate);
      if (rate <= currentBoard.effectiveTopRate)
        throw new Error("Enter a rate higher than the current leading advertisement.");
      let state = await markee.readMarkeeWallet(
        client,
        await markee.readMarkeeBoard(client, selected),
        account,
      );
      if (state.flowRate !== 0n)
        throw new Error("Stop your current backing before taking over a new message.");
      if (state.deposit !== 0n)
        throw new Error("Withdraw your previous buffer before starting new backing.");
      const saved = loadRecovery();
      const recovery: Recovery =
        saved?.account.toLowerCase() === account.toLowerCase() &&
        saved.board?.toLowerCase() === selected.toLowerCase() &&
        saved.message === message
          ? { ...saved, monthlyInput }
          : { account, board: selected, message, monthlyInput };
      const guard = async () => {
        const fresh = await markee.readMarkeeBoard(client, selected);
        markee.validateMarkeeText(message, fresh.maxMessageLength);
        markee.parseMonthlyRate(monthlyInput, fresh.minimumMonthlyRate);
        if (rate <= fresh.effectiveTopRate)
          throw new Error("The leading advertisement rate changed. Review Take over again.");
        if (
          fresh.beneficiaryBps !== currentBoard.beneficiaryBps ||
          configurationKey(fresh.factoryConfig) !== configurationKey(currentBoard.factoryConfig)
        )
          throw new Error("Markee revenue split changed. Review again.");
        if (recovery.messageAddress) {
          const storedMessage = await markee.readMarkeeMessage(
            client,
            fresh,
            recovery.messageAddress,
          );
          if (
            storedMessage.owner.toLowerCase() !== account.toLowerCase() ||
            storedMessage.message !== message ||
            storedMessage.name !== ""
          )
            throw new Error(
              "The saved advertisement ownership or text changed. Review a new advertisement.",
            );
        }
      };
      if (!recovery.messageAddress)
        await send(
          recovery,
          "message",
          {
            address: selected,
            abi: markee.boardAbi,
            functionName: "createMarkee",
            args: [message, ""],
          },
          guard,
        );
      state = await markee.readMarkeeWallet(
        client,
        await markee.readMarkeeBoard(client, selected),
        account,
      );
      const pool = await client.readContract({
        address: selected,
        abi: markee.boardAbi,
        functionName: "poolOf",
        args: [recovery.messageAddress!],
      });
      if (pool === zeroAddress)
        throw new Error(
          "The message refund pool is not ready. Your message is saved; retry after the pool is initialized.",
        );
      const funding = markee.getRequiredWrap(
        state.ethxBalance,
        rate,
        state.deposit,
        parseEther(monthlyInput),
      );
      if (state.ethBalance < funding.wrapValue)
        throw new Error(
          "Not enough ETH for the stream buffer. Add ETH and retry; your message is saved.",
        );
      if (state.allowance < funding.buffer)
        await send(
          recovery,
          "approval",
          {
            address: markee.STREAMING_BASE.ethx,
            abi: markee.ethxAbi,
            functionName: "approve",
            args: [selected, funding.buffer],
          },
          guard,
          { allowance: funding.buffer.toString() },
        );
      const latest = await markee.readMarkeeWallet(
        client,
        await markee.readMarkeeBoard(client, selected),
        account,
      );
      const required = markee.getRequiredWrap(
        latest.ethxBalance,
        rate,
        latest.deposit,
        parseEther(monthlyInput),
      );
      const operations = markee.buildOpenStreamOps({
        ethx: markee.STREAMING_BASE.ethx,
        board: selected,
        markee: recovery.messageAddress!,
        backer: account,
        ratePerSec: rate,
        buffer: required.buffer,
        cfaAgreement: latest.cfaAgreement,
        gdaAgreement: latest.gdaAgreement,
        pool,
        wrapValue: required.wrapValue,
      });
      await send(
        recovery,
        "start",
        {
          address: markee.STREAMING_BASE.host,
          abi: markee.hostAbi,
          functionName: "batchCall",
          args: [operations],
          value: required.wrapValue,
        },
        async () => {
          await guard();
          const currentPool = await client.readContract({
            address: selected,
            abi: markee.boardAbi,
            functionName: "poolOf",
            args: [recovery.messageAddress!],
          });
          if (currentPool !== pool) throw new Error("The refund pool changed. Review again.");
          const now = await markee.readMarkeeWallet(
            client,
            await markee.readMarkeeBoard(client, selected),
            account,
          );
          if (
            now.flowRate !== 0n ||
            now.cfaAgreement !== latest.cfaAgreement ||
            now.gdaAgreement !== latest.gdaAgreement ||
            now.ethBalance < required.wrapValue ||
            now.deposit !== latest.deposit ||
            now.ethxBalance < latest.ethxBalance ||
            now.allowance < required.buffer
          )
            throw new Error("Stream funding changed. Review Take over again.");
        },
        { rate: rate.toString() },
      );
    });
  const updateStream = (monthlyInput: string) =>
    act(async () => {
      const { client, account } = context();
      if (!boardAddress) throw new Error("No Markee board configured.");
      const selected = boardAddress;
      const reviewed = await markee.readMarkeeBoard(client, selected);
      const state = await markee.readMarkeeWallet(client, reviewed, account);
      if (state.flowRate <= 0n || state.backerMarkee === zeroAddress)
        throw new Error("No active backing to update.");
      const rate = markee.parseMonthlyRate(monthlyInput, reviewed.minimumMonthlyRate);
      const recovery: Recovery = {
        account,
        board: selected,
        messageAddress: state.backerMarkee,
        monthlyInput,
      };
      const guard = async () => {
        const boardNow = await markee.readMarkeeBoard(client, selected);
        markee.parseMonthlyRate(monthlyInput, boardNow.minimumMonthlyRate);
        if (
          boardNow.beneficiaryBps !== reviewed.beneficiaryBps ||
          configurationKey(boardNow.factoryConfig) !== configurationKey(reviewed.factoryConfig)
        )
          throw new Error("Markee settings changed. Review the stream update again.");
        const current = await markee.readMarkeeWallet(client, boardNow, account);
        if (
          current.flowRate !== state.flowRate ||
          current.backerMarkee.toLowerCase() !== state.backerMarkee.toLowerCase() ||
          current.deposit !== state.deposit
        )
          throw new Error("Your backing changed. Review the stream update again.");
      };
      const funding = markee.getRequiredWrap(
        state.ethxBalance,
        rate,
        state.deposit,
        parseEther(monthlyInput),
      );
      if (state.ethBalance < funding.wrapValue)
        throw new Error("Not enough ETH to fund the stream update.");
      if (funding.depositTopUp > 0n && state.allowance < funding.depositTopUp)
        await send(
          recovery,
          "approval",
          {
            address: markee.STREAMING_BASE.ethx,
            abi: markee.ethxAbi,
            functionName: "approve",
            args: [selected, funding.depositTopUp],
          },
          guard,
          { allowance: funding.depositTopUp.toString() },
        );
      const latest = await markee.readMarkeeWallet(
        client,
        await markee.readMarkeeBoard(client, selected),
        account,
      );
      const required = markee.getRequiredWrap(
        latest.ethxBalance,
        rate,
        latest.deposit,
        parseEther(monthlyInput),
      );
      const operations = markee.buildUpdateStreamOps({
        ethx: markee.STREAMING_BASE.ethx,
        board: selected,
        backer: account,
        ratePerSec: rate,
        depositTopUp: required.depositTopUp,
        wrapValue: required.wrapValue,
        cfaAgreement: latest.cfaAgreement,
      });
      await send(
        recovery,
        "update",
        {
          address: markee.STREAMING_BASE.host,
          abi: markee.hostAbi,
          functionName: "batchCall",
          args: [operations],
          value: required.wrapValue,
        },
        async () => {
          await guard();
          const now = await markee.readMarkeeWallet(
            client,
            await markee.readMarkeeBoard(client, selected),
            account,
          );
          if (
            now.cfaAgreement !== latest.cfaAgreement ||
            now.ethBalance < required.wrapValue ||
            markee.getRequiredWrap(now.ethxBalance, rate, now.deposit, 0n).wrapValue >
              required.wrapValue ||
            now.allowance < required.depositTopUp
          )
            throw new Error("Stream funding changed. Review the update again.");
        },
        { rate: rate.toString() },
      );
    });
  const stop = () =>
    act(async () => {
      const { client, account } = context();
      if (!boardAddress) throw new Error("No Markee board configured.");
      const state = await markee.readMarkeeWallet(
        client,
        await markee.readMarkeeExitBoard(client, boardAddress),
        account,
      );
      if (!state.flowRate) throw new Error("No active stream to stop.");
      await send(
        { account, board: boardAddress },
        "stop",
        {
          address: markee.STREAMING_BASE.host,
          abi: markee.hostAbi,
          functionName: "batchCall",
          args: [
            markee.buildStopStreamOps({
              ethx: markee.STREAMING_BASE.ethx,
              board: boardAddress,
              backer: account,
              cfaAgreement: state.cfaAgreement,
            }),
          ],
        },
        async () => {
          await guardBoard(boardAddress);
          const now = await markee.readMarkeeWallet(client, { address: boardAddress }, account);
          if (
            now.flowRate !== state.flowRate ||
            now.backerMarkee !== state.backerMarkee ||
            now.cfaAgreement !== state.cfaAgreement
          )
            throw new Error("Your backing changed. Review stopping it again.");
        },
      );
    });
  const withdraw = () =>
    act(async () => {
      const { client, account } = context();
      if (!boardAddress) throw new Error("No Markee board configured.");
      const state = await markee.readMarkeeWallet(
        client,
        await markee.readMarkeeExitBoard(client, boardAddress),
        account,
      );
      if (state.flowRate || !state.deposit)
        throw new Error("Stop backing before withdrawing an available deposit.");
      await send(
        { account, board: boardAddress },
        "withdraw",
        { address: boardAddress, abi: markee.boardAbi, functionName: "withdrawDeposit", args: [] },
        async () => {
          await guardBoard(boardAddress);
          const now = await markee.readMarkeeWallet(client, { address: boardAddress }, account);
          if (now.flowRate !== 0n || now.deposit !== state.deposit)
            throw new Error("Your deposit or stream changed. Review withdrawal again.");
        },
      );
    });
  /**
   * The saved submission as the SDK's saved-attempt recovery reads it: its step's intent, exact
   * call and saved hash (a Safe proposal's safeTxHash, or a hash the user found for a lost reply).
   * Its domain check is the exact Markee result of a transaction; the journal's re-read is the
   * final say before any check or exit retires it.
   */
  const attemptOf = (
    saved: Recovery,
    step: Pending,
    providedHash?: Hex,
  ): SavedAttempt<Pick<Recovery, "board" | "messageAddress">> => {
    const safe = !!step.hash && transactionActivityForHash(step.hash)?.kind === "safe";
    const hash = step.hash ?? providedHash;
    return {
      chainId: markee.MARKEE_CHAIN_ID,
      account: saved.account,
      safe,
      namespaces: [markeeIntent(saved.account, step)],
      call: { to: step.target, data: step.data, value: BigInt(step.value) },
      saved: { started: true, ...(hash ? (safe ? { safeTxHash: hash } : { hash }) : {}) },
      authenticate: async (transactionHash) => {
        if (!client || !transactionHash) return { result: "unknown" };
        await recoverMarkeeSubmission(client, saved.account, step, transactionHash);
        const receipt = await waitForReceiptWithRetry(client, transactionHash);
        if (receipt.status !== "success") return { result: "not-this" };
        return { result: "proven", value: await markeeEffects(saved, step, receipt) };
      },
      confirmRetirable: async () => {
        const now = loadRecovery();
        return !!now?.pending && configurationKey(now.pending) === configurationKey(step);
      },
    };
  };
  /** The submission ended without a result to save: the journal lets it go. */
  const letGo = async (step: Pending, line: string) => {
    await write(() => {
      const current = loadRecovery();
      if (current?.pending && configurationKey(current.pending) === configurationKey(step)) {
        delete current.pending;
        saveRecovery(current);
      }
      updateTransactionActivity(step.id, {
        status: "failed",
        manualVerificationRequired: false,
        message: line,
      });
      if (step.hash) settleTransactionActivityFailure(step.hash, line);
    });
    setPending(false);
  };
  /**
   * What the SDK's recovery found for a saved submission: a held write offers the hold's exit; a
   * success shown as this step saves its result; one the SDK settled but Markee can't verify is
   * only checked again; a check offers the one "I checked it" action.
   */
  const settle = async (
    saved: Recovery,
    step: Pending,
    attempt: ReturnType<typeof attemptOf>,
    outcome: SavedAttemptOutcome<Pick<Recovery, "board" | "messageAddress">>,
  ): Promise<string> => {
    if (!client) throw new Error("Base RPC unavailable.");
    if (outcome.status === "none") {
      await letGo(step, HELD_RELEASED_LINE);
      return HELD_RELEASED_LINE;
    }
    if (outcome.status === "held") {
      // The state recovery read under the hold's lock: its exit, when the hold offers one.
      const shown = outcome.state;
      if (!shown.exit || !(await confirmHeldWriteExit(shown))) throw new Error(shown.line);
      const ended = await outcome.handle.exit(shown, { checkedWallet: true }, client);
      if (!ended.released)
        throw new Error(
          ended.state.status !== "clear"
            ? ended.state.line
            : ended.state.settled
              ? settledLine(ended.state.settled)
              : HELD_RELEASED_ELSEWHERE_LINE,
        );
      await savedAttempts.retire(attempt, { by: "exit" });
      await letGo(step, HELD_RELEASED_LINE);
      return HELD_RELEASED_LINE;
    }
    if (outcome.status === "done" && outcome.result === "failed") {
      await savedAttempts.retire(attempt, { by: "settled", hash: outcome.hash });
      await letGo(step, "Markee transaction reverted.");
      throw new Error("The Markee transaction reverted. It can be reviewed again.");
    }
    if (outcome.status === "done") {
      if (!outcome.authenticated) {
        // Saved with its hash and followed: never retired or sent again.
        const current = loadRecovery();
        if (outcome.hash && current?.pending && !current.pending.hash) {
          current.pending.hash = outcome.hash;
          await write(() => saveRecovery(current));
        }
        throw new Error(SETTLED_UNVERIFIED);
      }
      await completeStep(saved, step, outcome.value, step.hash ?? outcome.hash);
      await savedAttempts.retire(attempt, { by: "settled", hash: outcome.hash });
      return "Verified";
    }
    if (!(await confirmCheckedIt(outcome))) throw new Error(outcome.line);
    let retired = await savedAttempts.retire(attempt, { by: "check", outcome });
    if (!retired.retired && retired.reason === "unreadable" && (await confirmUnreadableExit()))
      retired = await savedAttempts.retire(attempt, { by: "check", outcome, force: "unreadable" });
    if (!retired.retired) throw new Error(outcome.line);
    await letGo(step, HELD_RELEASED_LINE);
    return HELD_RELEASED_LINE;
  };
  const recover = (providedHash?: string) =>
    act(async () => {
      const saved = loadRecovery();
      if (!saved?.pending) throw new Error("No saved transaction to check.");
      if (!address || address.toLowerCase() !== saved.account.toLowerCase())
        throw new Error("Reconnect the wallet that submitted this transaction.");
      if (!client) throw new Error("Base RPC unavailable.");
      if (providedHash && !isHash(providedHash))
        throw new Error("Enter a complete transaction hash.");
      const step = saved.pending;
      const found = providedHash && !step.hash ? (providedHash as Hex) : undefined;
      refreshTransactionActivities();
      const attempt = attemptOf(saved, step, found);
      let outcome = await savedAttempts.recover(attempt, client);
      // A hash the user found for a lost reply: the hold attaches it once the chain shows it is
      // this exact call, and is asked again.
      if (found && outcome.status === "held" && outcome.state.status === "held-no-hash") {
        await outcome.handle.attachHash(client, found).catch(() => undefined);
        outcome = await savedAttempts.recover(attempt, client);
      }
      return settle(saved, step, attempt, outcome);
    });
  const quoteFunding = (monthlyInput: string) => {
    if (!wallet || !board) return undefined;
    try {
      return markee.getRequiredWrap(
        wallet.ethxBalance,
        markee.parseMonthlyRate(monthlyInput, board.minimumMonthlyRate),
        wallet.deposit,
        parseEther(monthlyInput),
      );
    } catch {
      return undefined;
    }
  };
  return {
    quoteFunding,
    boardAddress,
    board,
    wallet,
    loading,
    busy,
    /** The sent step is only followed until its hold settles: the dialog can close (`dismiss`). */
    following,
    dismiss,
    status,
    error,
    pending,
    canCreateBoard: !boardAddress && address?.toLowerCase() === markee.MARKEE_ADMIN.toLowerCase(),
    createBoard,
    takeover,
    updateStream,
    stop,
    withdraw,
    recover,
    refresh,
  };
}
