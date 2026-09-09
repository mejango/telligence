import { chainDisplayName } from "@/app/constants";
import { ChainLogo } from "@/components/ChainLogo";
import { useFormContext } from "@/lib/forms";
import { OPERATOR_LIMITS, OPERATOR_POWERS } from "@/lib/protocolConcepts";
import { sortChains } from "@/lib/utils";
import { JBChainId } from "@bananapus/nana-sdk-core";
import { useEffect, useRef, useState } from "react";
import { PERMANENTLY_DISABLED_OPERATOR } from "../constants";
import { RevnetFormData } from "../types";

const inputClassName =
  "flex h-9 w-full border-2 border-melon-300 bg-melon-25 px-3 py-1.5 text-md placeholder:text-zinc-500 hover:border-melon-400 focus-visible:border-melon-600 focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50";

/** Whether an address means "nobody holds these controls". */
const isDisabled = (address?: string) =>
  (address ?? "").trim().toLowerCase() === PERMANENTLY_DISABLED_OPERATOR;

/**
 * Who, if anyone, holds the revnet's limited operator controls.
 *
 * Its own section rather than a field inside stage 1's dialog: the operator is a single
 * revnet-wide choice (per chain, never per stage), so burying it in the first stage's terms
 * both hid it and implied it could change stage to stage.
 *
 * Addresses are bound BY CHAIN ID: each row reads and writes the `operator` entry whose chainId
 * matches the chain named beside it, so selection order can never cross-wire an address onto
 * another chain's deployment.
 */
export function OperatorSection({ disabled = false }: { disabled?: boolean }) {
  const { values, setFieldValue } = useFormContext<RevnetFormData>();
  const operators = values.operator;
  const sortedChains = sortChains(values.chainIds);

  // Drafts written before this section existed carry the operator on stage 1. Reading it here
  // keeps an imported `.jb` showing the operator it was saved with.
  const fromStage = values.stages[0]?.initialOperator?.trim() ?? "";
  const namedInStage = fromStage !== "" && !isDisabled(fromStage);

  // The answer to "is there an operator?" is a question about the revnet, not about any chain,
  // so the section holds it rather than deriving it from the address rows. Chains are picked in
  // an earlier section, but the reader can answer this one before going back for them.
  const [controlsEnabled, setControlsEnabled] = useState(
    () => namedInStage || (operators.length > 0 && !operators.every((e) => isDisabled(e.address))),
  );

  const entryFor = (chainId: JBChainId) =>
    operators.find((entry) => Number(entry.chainId) === Number(chainId));

  const latestRef = useRef({ operators, sortedChains, setFieldValue, fromStage, controlsEnabled });
  latestRef.current = { operators, sortedChains, setFieldValue, fromStage, controlsEnabled };

  // An imported draft arrives after mount, so the initial answer above can be the wrong one.
  useEffect(() => {
    if (operators.length > 0 && !operators.every((entry) => isDisabled(entry.address))) {
      setControlsEnabled(true);
    }
  }, [operators]);

  // The rows mirror the chains that are actually selected: one entry each, no more. Anything
  // else is a validation error the reader cannot see, since only selected chains are rendered —
  // a stale entry for a dropped chain, or a missing one for a chain added after this was
  // answered, would only surface at submit.
  useEffect(() => {
    const latest = latestRef.current;
    if (latest.sortedChains.length === 0) return;
    const next = latest.sortedChains.map((chainId) => {
      const existing = latest.operators.find(
        (entry) => Number(entry.chainId) === Number(chainId),
      )?.address;
      const seed = latest.controlsEnabled
        ? isDisabled(latest.fromStage)
          ? ""
          : latest.fromStage
        : PERMANENTLY_DISABLED_OPERATOR;
      // Keep whatever was typed, unless the answer above contradicts it.
      const keep =
        existing !== undefined && isDisabled(existing) !== latest.controlsEnabled ? existing : seed;
      return { chainId: String(chainId), address: keep };
    });
    const unchanged =
      next.length === latest.operators.length &&
      next.every(
        (entry, index) =>
          entry.chainId === String(latest.operators[index]?.chainId) &&
          entry.address === latest.operators[index]?.address,
      );
    if (!unchanged) latest.setFieldValue("operator", next);
  }, [values.chainIds, controlsEnabled, operators]);

  // One operator for the whole revnet is the common case, so the per-chain rows are opt-in —
  // the same affordance a split beneficiary uses. They open by themselves when the addresses
  // already differ, which is how an imported draft with per-chain operators arrives.
  const distinctAddresses = new Set(
    sortedChains.map((chainId) => entryFor(chainId)?.address?.trim().toLowerCase() ?? ""),
  );
  const [perChain, setPerChain] = useState(() => distinctAddresses.size > 1);

  const setEveryAddress = (address: string) => {
    setFieldValue(
      "operator",
      sortedChains.map((chainId) => ({ chainId: String(chainId), address })),
    );
  };

  const setAddress = (chainId: JBChainId, address: string) => {
    const index = operators.findIndex((entry) => Number(entry.chainId) === Number(chainId));
    if (index === -1) {
      setFieldValue("operator", [...operators, { chainId: String(chainId), address }]);
    } else {
      setFieldValue(`operator.${index}.address`, address);
    }
  };

  const answerControls = (enabled: boolean) => {
    setControlsEnabled(enabled);
    if (values.stages.length > 0 && !enabled) {
      setFieldValue("stages.0.initialOperator", PERMANENTLY_DISABLED_OPERATOR);
    }
  };

  return (
    <>
      <div className="md:col-span-1">
        <h2 className="mb-4 text-lg font-bold md:mb-2">5. Operator</h2>
        <p className="text-lg text-zinc-600">
          An optional address holding limited controls over the revnet once it&apos;s deployed.
        </p>
        <p className="mt-2 text-lg text-zinc-600">
          Whoever you name here can be changed later only by the operator itself.
        </p>
      </div>
      <div className="mt-6 md:col-span-2 md:mt-0">
        <label className="flex cursor-pointer items-start gap-3 border border-melon-300 bg-melon-25 p-4">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-green-600"
            checked={controlsEnabled}
            disabled={disabled}
            onChange={(event) => answerControls(event.target.checked)}
          />
          <div>
            <span className="block text-md font-semibold text-zinc-800">
              Enable limited operator controls
            </span>
            <span className="mt-1 block text-sm leading-relaxed text-zinc-500">
              One address gets exactly these powers over the revnet once it&apos;s live:
            </span>
            {/* The whole list, not a summary of it: every line is a permission the contracts
                actually grant, so a reader can check what they are agreeing to. */}
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-zinc-500">
              {OPERATOR_POWERS.map((power) => (
                <li key={power}>{power}</li>
              ))}
            </ul>
            <span className="mt-2 block text-sm leading-relaxed text-zinc-500">
              {OPERATOR_LIMITS}
            </span>
          </div>
        </label>
        {controlsEnabled && sortedChains.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Pick the chains you&apos;re deploying on, and an address per chain appears here.
          </p>
        ) : controlsEnabled ? (
          <div className="mt-4">
            <label className="mb-1 block text-md text-zinc-600" htmlFor="operatorAddress">
              Revnet operator
            </label>
            <input
              id="operatorAddress"
              aria-label="Revnet operator address"
              className={inputClassName}
              placeholder="0x"
              disabled={disabled}
              required
              value={perChain ? "" : (entryFor(sortedChains[0])?.address ?? "")}
              // One address is the common case; the per-chain rows below are the exception, so
              // typing here sets it on every chain at once.
              onChange={(event) => setEveryAddress(event.target.value)}
              hidden={perChain}
            />
            {sortedChains.length > 1 ? (
              <label
                className="mt-2 flex w-fit items-center gap-2 text-md italic text-zinc-400"
                htmlFor="perChainOperator"
              >
                set operator per chain?
                <input
                  type="checkbox"
                  id="perChainOperator"
                  checked={perChain}
                  disabled={disabled}
                  onChange={(event) => setPerChain(event.target.checked)}
                />
              </label>
            ) : null}
            {perChain
              ? sortedChains.map((chain) => (
                  <div key={chain} className="mt-3 flex items-center gap-2 text-md text-zinc-600">
                    <div className="flex w-40 shrink-0 items-center gap-2 text-sm">
                      <ChainLogo chainId={chain} width={20} height={20} />
                      <span className="text-zinc-400">{chainDisplayName(chain)}</span>
                    </div>
                    <input
                      aria-label={`${chainDisplayName(chain)} operator address`}
                      className={inputClassName}
                      placeholder="0x"
                      disabled={disabled}
                      required
                      value={entryFor(chain)?.address ?? ""}
                      onChange={(event) => setAddress(chain, event.target.value)}
                    />
                  </div>
                ))
              : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">
            No operator address will retain these limited controls.
          </p>
        )}
      </div>
    </>
  );
}
