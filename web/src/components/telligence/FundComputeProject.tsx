"use client";

import { ButtonWithWallet } from "@/components/ButtonWithWallet";
import { Input } from "@/components/ui/input";
import {
  failedLine,
  reviewedCall,
  SAFE_PROPOSAL_PENDING_LINE,
  useReviewedAction,
} from "@/hooks/useReviewedAction";
import { isSafeConnection } from "@/lib/safe-connector";
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
import { requireNoViewAs } from "@/lib/view-as";
import { getViemPublicClient } from "@/lib/wagmiTransports";
import { approvalIntent, payIntent } from "@bananapus/nana-sdk-core/review";
import { previewPay } from "@bananapus/nana-sdk-core/v6";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { erc20Abi, parseAbi } from "viem";
import { useAccount, useConfig } from "wagmi";
import { getAccount } from "wagmi/actions";

const policyTerminalAbi = parseAbi(["function TERMINAL() view returns (address)"]);

export function FundComputeProject({ project }: { project: ProjectSnapshot }) {
  const { address } = useAccount();
  const wallet = useConfig();
  const { run } = useReviewedAction();
  const router = useRouter();
  const [amount, setAmount] = useState("");
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
  const accepting = project.chainId === 8453 && ["active", "accumulating"].includes(project.status);

  useEffect(() => {
    setMessage("");
    setError(null);
  }, [address, project.id]);

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
      const value = parseVvvAmount(amount);
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
      await assertActive();
      assertSupporter();
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
      // Held by the project and supporter alone: one contribution at a time, whatever the amount.
      const intent = payIntent({ chainId: 8453, project: projectId, beneficiary: supporter });
      const approval = allowance < value;
      const result = await run({
        account: supporter,
        title: "Review your contribution",
        confirmLabel: "Agree & send",
        calls: [
          ...(approval
            ? [
                reviewedCall(
                  {
                    chainId: 8453,
                    address: VVV_ADDRESS,
                    abi: erc20Abi,
                    functionName: "approve",
                    args: [deployment.canonicalTerminal, value],
                  },
                  // A Safe batch is held under its first call's key: the contribution's own.
                  isSafeConnection(wallet)
                    ? { intent }
                    : {
                        intent: approvalIntent(intent, {
                          step: "erc20",
                          token: VVV_ADDRESS,
                          spender: deployment.canonicalTerminal,
                        }),
                      },
                ),
              ]
            : []),
          reviewedCall(transaction, { intent, dependsOnPrior: approval }),
        ],
        scope: approval ? intent : undefined,
        batch: true,
        reverify: async () => {
          assertSupporter();
          await assertActive();
          assertSupporter();
        },
        assertWriteState: assertSupporter,
        beforeWallet: (_call, step) =>
          setMessage(
            approval && step === 0
              ? "Approve only this contribution amount…"
              : "Confirm your contribution in the wallet…",
          ),
        onSubmitted: (_call, step) => {
          if (!approval || step === 1) setMessage("Waiting for your contribution to confirm…");
        },
      });
      if (!result) {
        setMessage("");
        return;
      }
      if (result.status === "failed") throw new Error(failedLine(result));
      if (result.status === "proposed") {
        setMessage(SAFE_PROPOSAL_PENDING_LINE);
        return;
      }
      // A Safe's outer receipt can succeed while its inner payment fails: the terminal's own
      // event for this exact contribution is the confirmation.
      assertComputePaymentReceipt(result.receipts.at(-1)!, {
        terminal: deployment.canonicalTerminal,
        projectId,
        supporter,
        amount: value,
      });
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
        disabled={busy}
        className="mt-3 h-12"
      />
      <ButtonWithWallet
        targetChainId={8453}
        className="mt-4 w-full"
        disabled={busy || !accepting || !amount}
        loading={busy}
        onClick={() => void fund()}
      >
        Fund compute
      </ButtonWithWallet>
      <p className="mt-4 text-[11px] leading-5 text-melon-700">
        Normal Revnet issuance and buybacks apply. You receive participation tokens in your wallet.
        Cash-out value varies; compute backing has withdrawal delays. The payment quote allows up to
        1% slippage.
      </p>
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
