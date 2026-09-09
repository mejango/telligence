"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { Input } from "@/components/ui/input";
import { requireOnchainExecution, useWriteContract } from "@/hooks/useReviewedWriteContract";
import { gatewayRequest } from "@/lib/telligence/api";
import { computeFactoryAbi, computeReadAbi } from "@/lib/telligence/factory";
import { assertComputePaymentReceipt } from "@/lib/telligence/funding-receipt";
import {
  assertDeploymentConfig,
  buildComputePayment,
  parseVvvAmount,
  VVV_ADDRESS,
} from "@/lib/telligence/transactions";
import type { ProjectSnapshot } from "@/lib/telligence/types";
import { transactionActivityForHash, updateTransactionActivity } from "@/lib/transaction-activity";
import { requireNoViewAs } from "@/lib/view-as";
import { getViemPublicClient } from "@/lib/wagmiTransports";
import { waitForReceiptWithRetry } from "@/lib/waitForReceipt";
import { previewPay } from "@bananapus/nana-sdk-core/v6";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { erc20Abi, parseAbi, type Hex } from "viem";
import { useAccount, useConfig } from "wagmi";
import { getAccount } from "wagmi/actions";

type PendingFunding = {
  hash: Hex;
  step: "approval" | "payment";
  amount: string;
  creator: string;
  projectId: string;
};
const policyTerminalAbi = parseAbi(["function TERMINAL() view returns (address)"]);

export function FundComputeProject({ project }: { project: ProjectSnapshot }) {
  const { address } = useAccount();
  const wallet = useConfig();
  const verifyBeforeWrite = useRef<null | (() => Promise<void>)>(null);
  const { writeContractAsync } = useWriteContract({
    manualReceiptVerification: (transaction) => transaction.functionName === "pay",
    allowSafeManualReceiptVerification: true,
    beforeSubmission: async () => {
      if (!verifyBeforeWrite.current) throw new Error("Review this contribution again.");
      await verifyBeforeWrite.current();
    },
    reverify: async () => {
      if (!verifyBeforeWrite.current) throw new Error("Review this contribution again.");
      await verifyBeforeWrite.current();
    },
  });
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState<PendingFunding | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);
  const mounted = useRef(false);
  const identity = `${project.chainId}:${project.id}:${project.revnetId}:${project.wrapperAddress}:${project.vaultAddress}:${project.creatorAddress}`;
  const latestIdentity = useRef(identity);
  latestIdentity.current = identity;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const storageKey = `telligence:fund:8453:${project.id}:${address?.toLowerCase()}`;
  const ownPending =
    pending?.creator.toLowerCase() === address?.toLowerCase() && pending?.projectId === project.id
      ? pending
      : null;
  const accepting = project.chainId === 8453 && ["active", "accumulating"].includes(project.status);

  useEffect(() => {
    setPending(null);
    setMessage("");
    setError(null);
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (
        saved &&
        saved.creator?.toLowerCase() === address?.toLowerCase() &&
        saved.projectId === project.id &&
        /^0x[0-9a-fA-F]{64}$/.test(saved.hash) &&
        ["approval", "payment"].includes(saved.step)
      ) {
        parseVvvAmount(saved.amount);
        setPending(saved);
        setAmount(saved.amount);
      }
    } catch {
      /* Invalid public intent is never submitted. */
    }
  }, [storageKey, address, project.id]);

  async function fund() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    setMessage("");
    const supporter = getAccount(wallet).address;
    const assertSupporter = () => {
      requireNoViewAs();
      if (!mounted.current || latestIdentity.current !== identity)
        throw new Error("The project view changed. Review your contribution again.");
      if (!supporter || getAccount(wallet).address?.toLowerCase() !== supporter.toLowerCase())
        throw new Error("Connected wallet changed. Resume with the original supporter.");
    };
    try {
      assertSupporter();
      if (!supporter) throw new Error("Connect a wallet first.");
      const client = getViemPublicClient(8453);
      const remember = (hash: Hex, step: PendingFunding["step"], amountText: string) => {
        const saved = { hash, step, amount: amountText, creator: supporter, projectId: project.id };
        setPending(saved);
        try {
          localStorage.setItem(storageKey, JSON.stringify(saved));
        } catch {
          throw new Error(
            `Transaction submitted as ${hash}. Keep its hash and verify it before submitting again.`,
          );
        }
        return saved;
      };
      const confirm = async (saved: PendingFunding) => {
        requireOnchainExecution(
          saved.hash,
          saved.step === "payment" ? "Compute funding" : "VVV approval",
        );
        const hash = transactionActivityForHash(saved.hash)?.executionHash ?? saved.hash;
        const receipt = await waitForReceiptWithRetry(client, hash);
        if (receipt.status !== "success") {
          localStorage.removeItem(storageKey);
          setPending(null);
          throw new Error("The transaction reverted. Review the amount and try again.");
        }
        if (saved.step === "payment") {
          // A Safe's outer receipt can succeed while its inner payment fails. Verify the exact terminal event before
          // clearing recovery. Read the immutable policy directly so this confirmation also works during gateway outages.
          const terminal = await client.readContract({
            address: project.wrapperAddress,
            abi: policyTerminalAbi,
            functionName: "TERMINAL",
          });
          assertComputePaymentReceipt(receipt, {
            terminal,
            projectId: BigInt(project.revnetId),
            supporter,
            amount: parseVvvAmount(saved.amount),
          });
          const activity = transactionActivityForHash(saved.hash);
          if (activity)
            updateTransactionActivity(activity.id, {
              status: "success",
              manualVerificationRequired: false,
              message: "The exact compute contribution was verified onchain.",
            });
        }
        return receipt;
      };
      const stored = localStorage.getItem(storageKey);
      let savedIntent = ownPending;
      if (stored !== null) {
        let saved: PendingFunding;
        try {
          saved = JSON.parse(stored) as PendingFunding;
        } catch {
          throw new Error(
            "A saved contribution could not be verified. Check your wallet history before contributing again.",
          );
        }
        if (!saved || typeof saved !== "object")
          throw new Error(
            "A saved contribution could not be verified. Check your wallet history before contributing again.",
          );
        if (
          saved.creator?.toLowerCase() !== supporter.toLowerCase() ||
          saved.projectId !== project.id ||
          !/^0x[0-9a-fA-F]{64}$/.test(saved.hash) ||
          !["approval", "payment"].includes(saved.step)
        )
          throw new Error(
            "A saved contribution could not be verified. Check your wallet history before contributing again.",
          );
        parseVvvAmount(saved.amount);
        savedIntent = saved;
        setPending(saved);
      }
      if (savedIntent?.step === "payment") {
        setMessage("Confirming your saved contribution…");
        await confirm(savedIntent);
        assertSupporter();
        localStorage.removeItem(storageKey);
        setPending(null);
        setAmount("");
        setMessage("Contribution confirmed. Compute capacity updates after backing is activated.");
        router.refresh();
        return;
      }
      const amountText = savedIntent?.amount ?? amount;
      const value = parseVvvAmount(amountText);
      if (!accepting) throw new Error("This project is not accepting compute funding.");
      setMessage("Checking this project’s onchain funding policy…");
      const deployment = await gatewayRequest<unknown>("/v1/config");
      assertDeploymentConfig(deployment);
      const projectId = BigInt(project.revnetId);
      const [policy, vault, creator] = await Promise.all([
        client.readContract({
          address: deployment.factoryAddress,
          abi: computeFactoryAbi,
          functionName: "policyOf",
          args: [projectId],
        }),
        client.readContract({
          address: deployment.factoryAddress,
          abi: computeFactoryAbi,
          functionName: "vaultOf",
          args: [projectId],
        }),
        client.readContract({
          address: deployment.factoryAddress,
          abi: computeFactoryAbi,
          functionName: "creatorOf",
          args: [projectId],
        }),
      ]);
      if (
        policy.toLowerCase() !== project.wrapperAddress.toLowerCase() ||
        vault.toLowerCase() !== project.vaultAddress.toLowerCase() ||
        creator.toLowerCase() !== project.creatorAddress.toLowerCase()
      )
        throw new Error("The project does not match its confirmed factory registration.");
      const terminal = await client.readContract({
        address: policy,
        abi: policyTerminalAbi,
        functionName: "TERMINAL",
      });
      if (terminal.toLowerCase() !== deployment.canonicalTerminal.toLowerCase())
        throw new Error("The funding terminal does not match the project’s immutable policy.");
      const assertActive = async () => {
        if (
          (await client.readContract({
            address: vault,
            abi: computeReadAbi,
            functionName: "state",
          })) !== 0
        )
          throw new Error("Compute backing is winding down. New contributions are paused.");
      };
      verifyBeforeWrite.current = async () => {
        assertSupporter();
        await assertActive();
        assertSupporter();
      };
      await assertActive();
      assertSupporter();
      // Check persistence before asking the wallet to send either transaction.
      localStorage.setItem(storageKey + ":check", "1");
      localStorage.removeItem(storageKey + ":check");
      if (savedIntent?.step === "approval") {
        setMessage("Confirming your saved approval…");
        await confirm(savedIntent);
        assertSupporter();
        localStorage.removeItem(storageKey);
        setPending(null);
      }
      const [balance, allowance] = await Promise.all([
        client.readContract({
          address: VVV_ADDRESS,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [supporter],
        }),
        client.readContract({
          address: VVV_ADDRESS,
          abi: erc20Abi,
          functionName: "allowance",
          args: [supporter, deployment.canonicalTerminal],
        }),
      ]);
      if (balance < value)
        throw new Error("Your wallet does not have enough VVV on Base for this contribution.");
      if (allowance < value) {
        assertSupporter();
        setMessage("Approve only this contribution amount…");
        const hash = await writeContractAsync({
          chainId: 8453,
          address: VVV_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [deployment.canonicalTerminal, value],
        });
        const saved = remember(hash, "approval", amountText);
        await confirm(saved);
        assertSupporter();
        localStorage.removeItem(storageKey);
        setPending(null);
      }
      await assertActive();
      assertSupporter();
      setMessage("Refreshing the contribution quote…");
      const quote = await previewPay(client, {
        chainId: 8453,
        terminal: deployment.canonicalTerminal,
        projectId,
        token: VVV_ADDRESS,
        amount: value,
        beneficiary: supporter,
        metadata: "0x",
      });
      if (quote.reservedTokenCount <= 0n)
        throw new Error(
          "This contribution would not produce compute backing. Try a larger amount or wait for the project to start.",
        );
      const transaction = buildComputePayment({
        projectId,
        terminal: deployment.canonicalTerminal,
        beneficiary: supporter,
        amount: value,
        quotedTokens: quote.beneficiaryTokenCount,
        slippageBps: 100,
      });
      assertSupporter();
      setMessage("Review your contribution in the wallet…");
      const hash = await writeContractAsync(transaction);
      const saved = remember(hash, "payment", amountText);
      setMessage("Waiting for your contribution to confirm…");
      await confirm(saved);
      assertSupporter();
      localStorage.removeItem(storageKey);
      setPending(null);
      setAmount("");
      setMessage("Contribution confirmed. Compute capacity updates after backing is activated.");
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Your contribution could not be completed. Try again.",
      );
    } finally {
      verifyBeforeWrite.current = null;
      working.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="support-compute-heading"
      className="border border-melon-300 p-5 sm:p-7"
    >
      <p className="compute-eyebrow">Help the work continue</p>
      <h2 id="support-compute-heading" className="mt-4 text-xl tracking-[-0.03em]">
        Fund this project’s compute
      </h2>
      <p className="mt-4 text-xs leading-6 text-melon-700">
        Your contribution helps build recurring inference capacity. Funding converts under the
        project’s Revnet terms; it does not buy a guaranteed amount of credit.
      </p>
      <label htmlFor={`fund-${project.id}`} className="mt-6 block text-xs">
        Contribution · VVV on Base
      </label>
      <Input
        id={`fund-${project.id}`}
        inputMode="decimal"
        autoComplete="off"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        placeholder="0.00"
        disabled={busy || !!ownPending}
        className="mt-3 h-12"
      />
      <ButtonWithWallet
        targetChainId={8453}
        className="mt-4 w-full"
        disabled={busy || (!ownPending && (!accepting || !amount))}
        loading={busy}
        onClick={() => void fund()}
      >
        {ownPending ? "Resume contribution" : "Fund compute"}
      </ButtonWithWallet>
      <p className="mt-4 text-[11px] leading-5 text-melon-700">
        Normal Revnet issuance and buybacks apply. You receive participation tokens in your wallet.
        Cash-out value varies; compute backing has withdrawal delays. The payment quote allows up to
        1% slippage.
      </p>
      {ownPending && (
        <a
          className="compute-text-link mt-4 inline-block break-all text-xs"
          href={`https://basescan.org/tx/${transactionActivityForHash(ownPending.hash)?.executionHash ?? ownPending.hash}`}
          target="_blank"
          rel="noreferrer"
        >
          Inspect pending {ownPending.step} ↗
        </a>
      )}
      {message && (
        <p role="status" className="mt-4 text-xs leading-6">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 break-words text-xs leading-6 text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
