import { chainDisplayName } from "@/app/constants";
import { ChainLogo } from "@/components/ChainLogo";
import { ChainSelector } from "@/components/ChainSelector";
import { StickyGroupFields } from "@/components/sticky/StickyGroupFields";
import { StickyTokenStatus } from "@/components/sticky/StickyTokenStatus";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { X as XIcon } from "@/components/ui/icons";
import { toast } from "@/components/ui/use-toast";
import { useHydrated } from "@/hooks/useHydrated";
import { withSchema } from "@/lib/formValidation";
import { FieldArray, Form, FormProvider } from "@/lib/forms";
import { commaNumber } from "@/lib/number";
import { isStickyRow, stickyGroupOf, stickyUnavailableReason } from "@/lib/sticky";
import { cn, sortChains } from "@/lib/utils";
import { JBChainId } from "@bananapus/nana-sdk-core";
import { cloneElement, useState } from "react";
import { defaultStageData, PERMANENTLY_DISABLED_OPERATOR } from "../constants";
import { getResolvedIssuance } from "../helpers/calculatePickupIssuance";
import { formatFormErrors } from "../helpers/formatFormErrors";
import { stageSchema } from "../helpers/stageSchema";
import { StageData } from "../types";
import { CashOutCurvePreview } from "./CashOutCurvePreview";
import { Field } from "./Fields";
import { PickupFromPreviousStage } from "./PickupFromPreviousStage";
import { StartTimeField } from "./StartTimeField";
import { useCreateForm } from "./useCreateForm";

function NotesSection({
  title = "[ ? ]",
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div className="mt-4">
      {/* Dropdown Header */}
      <button
        type="button"
        onClick={toggleDropdown}
        className="flex items-center gap-2 text-left text-zinc-600"
      >
        <div className="font-sm">{title}</div>
        <span
          className={`transform transition-transform font-sm ${isOpen ? "rotate-90" : "rotate-0"}`}
        >
          ▶
        </span>
      </button>

      {/* Dropdown Content */}
      {isOpen && <div className="mt-2 pl-4 text-gray-600 text-md">{children}</div>}
    </div>
  );
}

export function AddStageDialog({
  stageIdx,
  children,
  onSave,
  initialValues,
}: {
  stageIdx: number;
  initialValues?: StageData;
  children: React.ReactElement<{ disabled?: boolean }>;
  onSave: (newStage: StageData) => void;
}) {
  const {
    values: {
      stages,
      chainIds,
      operator: perChainOperators,
      issuanceBaseCurrency,
      reserveAsset: reserveAssetChoice,
    },
    setFieldValue: setCreateFieldValue,
    revnetTokenSymbol,
    reserveAssetSymbol,
  } = useCreateForm();
  const reserveAsset = reserveAssetSymbol;
  // Splits most often pay the operator, so its address is the useful prefill. The operator
  // itself is set in its own section; this only reads it.
  const namedOperator =
    perChainOperators.find(
      (entry) => entry.address.trim().toLowerCase() !== PERMANENTLY_DISABLED_OPERATOR,
    )?.address ?? "";
  // A custom reserve is its own denomination, so there is nothing to choose.
  const customReserve = reserveAssetChoice === "CUSTOM";
  // Chains are picked in the form's first section, so every chain-dependent
  // input in this dialog can specialize per selected chain inline.
  const sortedChainIds = sortChains(chainIds);
  // Sticky is a hook type, offered only where every launch chain has the distributor.
  // A revnet deploys its ERC-20 at launch, so reserved tokens can always reach it.
  const stickyReason = stickyUnavailableReason(sortedChainIds);
  const perChainInputClassName =
    "h-9 min-w-0 flex-1 border-2 border-melon-300 bg-melon-25 px-3 py-1.5 text-md placeholder:text-zinc-500 hover:border-melon-400 focus-visible:border-melon-600 focus-visible:outline-none focus-visible:ring-0";

  const [open, setOpen] = useState(false);
  // The server-rendered trigger cannot open a dialog until its handler is attached.
  const hydrated = useHydrated();

  // The issuance denomination is a single global value (the ruleset's base
  // currency for the whole revnet), edited inline in the first stage's issuance
  // row and buffered like the operators. Later stages quote it, so they read
  // the parent's current value rather than a buffer of their own.
  const [draftBaseCurrency, setDraftBaseCurrency] = useState(issuanceBaseCurrency);
  const editsBaseCurrency = stageIdx === 0 && !customReserve;
  const baseCurrency = stageIdx === 0 ? draftBaseCurrency : issuanceBaseCurrency;
  const baseCurrencySymbol = customReserve ? reserveAssetSymbol : baseCurrency;

  // Move enableCut state to top level
  const [enableCut, setEnableCut] = useState(() => cutControlsFrom(initialValues).enabled);
  const [uiCutPercentage, setUiCutPercentage] = useState(
    () => cutControlsFrom(initialValues).percentage,
  );
  const [uiCutFrequency, setUiCutFrequency] = useState(
    () => cutControlsFrom(initialValues).frequency,
  );

  // Discrete values matching your radio options
  const steps = ["no tax", "light", "medium", "heavy", "extreme"];

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        // (Re)start the buffers from the parent's current state on every open.
        if (nextOpen) {
          setDraftBaseCurrency(issuanceBaseCurrency);
          const cut = cutControlsFrom(initialValues);
          setEnableCut(cut.enabled);
          setUiCutPercentage(cut.percentage);
          setUiCutFrequency(cut.frequency);
        }
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        {cloneElement(children, { disabled: !hydrated || children.props.disabled })}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[37rem] p-4 max-sm:w-full max-sm:border-x-0 sm:p-6">
        <DialogHeader className="text-left">
          <DialogTitle className="text-xl">Add stage</DialogTitle>
        </DialogHeader>
        <div className="mt-8">
          <FormProvider
            initialValues={initialValues ?? getDefaultStageData(stageIdx, stages)}
            validate={withSchema(stageSchema)}
            onSubmit={(newValues, { setSubmitting }) => {
              try {
                setSubmitting(true);
                // Apply the presentation-only cut controls to the submitted values.
                if (enableCut) {
                  newValues.priceCeilingIncreasePercentage = String(uiCutPercentage);
                  newValues.priceCeilingIncreaseFrequency = String(uiCutFrequency);
                } else {
                  newValues.priceCeilingIncreasePercentage = "0";
                  newValues.priceCeilingIncreaseFrequency = "0";
                }

                // Commit the buffered parent-form fields along with the stage.
                if (stageIdx === 0) {
                  setCreateFieldValue("issuanceBaseCurrency", draftBaseCurrency);
                }
                onSave(newValues);
                setOpen(false);
              } catch (e: any) {
                toast({
                  variant: "destructive",
                  title: "Error",
                  description: e.message || "Could not save stage",
                });
                console.error(e);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {({ values, isValid, errors, setFieldValue, submitCount }) => {
              // Unchecking only hides the fields, so their values come back with the checkbox.
              const handleCutToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
                setEnableCut(e.target.checked);
              };

              // Expand a split to per-chain beneficiaries (seeded with the
              // single default value), or collapse it back to single-value mode.
              const toggleSplitPerChain = (index: number, checked: boolean) => {
                setFieldValue(
                  `splits.${index}.beneficiary`,
                  checked
                    ? sortedChainIds.map((chainId) => ({
                        chainId,
                        address: values.splits[index].defaultBeneficiary || "",
                      }))
                    : undefined,
                );
              };

              const setSplitChainBeneficiary = (
                index: number,
                chainId: JBChainId,
                address: string,
              ) => {
                const entries = values.splits[index].beneficiary ?? [];
                const entryIndex = entries.findIndex(
                  (entry) => Number(entry.chainId) === Number(chainId),
                );
                if (entryIndex === -1) {
                  setFieldValue(`splits.${index}.beneficiary`, [...entries, { chainId, address }]);
                } else {
                  setFieldValue(`splits.${index}.beneficiary.${entryIndex}.address`, address);
                }
              };

              return (
                <Form>
                  <div className="pb-10">
                    <div>
                      <div className="block text-md font-semibold leading-6">
                        1. {revnetTokenSymbol} issuance
                      </div>
                      <p className="text-md text-zinc-500 mt-3">
                        How many {revnetTokenSymbol} a payment of 1 {baseCurrencySymbol} creates.
                      </p>

                      <PickupFromPreviousStage
                        stageIdx={stageIdx}
                        values={values}
                        setFieldValue={setFieldValue}
                      />

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-md text-zinc-600">
                        <div className="grid h-9 w-full min-w-0 grid-cols-[minmax(6rem,1fr)_max-content] items-center border-2 border-melon-300 bg-melon-25 hover:border-melon-400 focus-within:border-melon-600 sm:w-[250px]">
                          <Field
                            id="initialIssuance"
                            name="initialIssuance"
                            min="0"
                            step="any"
                            type="number"
                            className={`h-full min-w-0 border-0 bg-transparent px-3 py-0 text-md focus-visible:border-0 ${
                              values.pickUpFromPrevious
                                ? "bg-gray-50 text-gray-600 cursor-not-allowed"
                                : ""
                            }`}
                            readOnly={values.pickUpFromPrevious}
                            value={
                              values.pickUpFromPrevious
                                ? getResolvedIssuance(values, stageIdx, stages)
                                : values.initialIssuance
                            }
                          />
                          {/* The denomination is one global value for the whole
                              revnet, so only the first stage offers it. Later
                              stages quote the same value as text. */}
                          <span className="flex shrink-0 items-center pr-2 text-md text-zinc-500">
                            <span className="pointer-events-none whitespace-nowrap">
                              {revnetTokenSymbol} /
                            </span>
                            {!editsBaseCurrency ? (
                              <span
                                className={cn(
                                  "ml-1 whitespace-nowrap",
                                  // A quoted denomination explains where it is
                                  // set on hover, so it has to take pointers.
                                  customReserve && "pointer-events-none",
                                )}
                                title={customReserve ? undefined : "Set in stage 1"}
                              >
                                {baseCurrencySymbol}
                              </span>
                            ) : (
                              <select
                                aria-label="New token pricing currency"
                                className="inline-caret ml-1 h-7 border-0 bg-transparent py-0 pl-1 text-md text-zinc-600 focus:outline-none focus:ring-0"
                                value={draftBaseCurrency}
                                onChange={(event) =>
                                  setDraftBaseCurrency(event.target.value as "ETH" | "USD")
                                }
                              >
                                <option value="ETH">ETH</option>
                                <option value="USD">USD</option>
                              </select>
                            )}
                          </span>
                        </div>
                        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                          {!enableCut ? (
                            <>
                              <label
                                htmlFor="enableCut"
                                className="whitespace-nowrap italic text-zinc-400"
                              >
                                Cut automatically?
                              </label>
                              <input
                                type="checkbox"
                                id="enableCut"
                                checked={enableCut}
                                onChange={handleCutToggle}
                              />
                            </>
                          ) : (
                            <>
                              <label htmlFor="uiCutPercentage" className="whitespace-nowrap">
                                cut
                              </label>
                              <input
                                type="checkbox"
                                id="enableCut"
                                checked={enableCut}
                                onChange={handleCutToggle}
                              />
                              <div className="relative">
                                <input
                                  id="uiCutPercentage"
                                  type="number"
                                  inputMode="decimal"
                                  min="0.01"
                                  max="100"
                                  step="any"
                                  className="h-9 w-14 border-2 border-melon-300 bg-melon-25 pr-6 pl-2 hover:border-melon-400 focus:border-melon-600 focus:ring-0"
                                  value={String(uiCutPercentage)}
                                  onChange={(e) => setUiCutPercentage(Number(e.target.value))}
                                  required
                                />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none">
                                  %
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <label htmlFor="uiCutFrequency">every</label>
                                <div className="relative">
                                  <input
                                    id="uiCutFrequency"
                                    type="number"
                                    inputMode="decimal"
                                    min="0.042"
                                    step="any"
                                    className="h-9 w-25 border-2 border-melon-300 bg-melon-25 pr-10 pl-2 hover:border-melon-400 focus:border-melon-600 focus:ring-0"
                                    value={String(uiCutFrequency)}
                                    onChange={(e) => setUiCutFrequency(Number(e.target.value))}
                                    required
                                  />
                                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none">
                                    days
                                  </span>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                      <div>
                        <FieldArray
                          name="splits"
                          render={(arrayHelpers) => (
                            <div>
                              {values.splits.map((split, index) => (
                                <div key={`split-${index}`}>
                                  <div className="mt-4 flex flex-wrap items-start gap-2 text-md text-zinc-600">
                                    <label
                                      className="flex h-9 items-center whitespace-nowrap"
                                      htmlFor={`splits.${index}.amount`}
                                    >
                                      {index === 0 ? "split" : "... and"}
                                    </label>
                                    <Field
                                      id={`splits.${index}.percentage`}
                                      name={`splits.${index}.percentage`}
                                      type="number"
                                      min="0"
                                      max="100"
                                      className="h-9 pr-8 pl-2"
                                      width="w-20 shrink-0"
                                      suffix="%"
                                      required
                                      placeholder="100"
                                    />
                                    <label
                                      className="flex h-9 items-center"
                                      htmlFor={`splits.${index}.defaultBeneficiary`}
                                    >
                                      to
                                    </label>
                                    <select
                                      aria-label="Recipient type"
                                      value={isStickyRow(split) ? "hook" : "address"}
                                      onChange={(e) => {
                                        const hook = e.target.value === "hook";
                                        // A Sticky row's beneficiary is a token, never a wallet,
                                        // and it is the same token on every chain.
                                        setFieldValue(`splits.${index}`, {
                                          percentage: split.percentage,
                                          defaultBeneficiary: "",
                                          ...(hook
                                            ? {
                                                kind: "hook",
                                                hookKind: "sticky",
                                                ...stickyGroupOf({}),
                                              }
                                            : {}),
                                        });
                                      }}
                                      className="h-9 border-2 border-melon-300 bg-melon-25 px-2 py-0 pr-8 text-md hover:border-melon-400 focus:border-melon-600 focus:outline-none focus:ring-0"
                                    >
                                      <option value="address">Address</option>
                                      {!stickyReason || isStickyRow(split) ? (
                                        <option value="hook">Hook</option>
                                      ) : null}
                                    </select>
                                    {/* Phones keep the remove button on the row's first line. */}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      aria-label="Remove split"
                                      onClick={() => arrayHelpers.remove(index)}
                                      className="ml-auto h-9 shrink-0 px-0 sm:order-last sm:ml-0 sm:px-3"
                                    >
                                      <XIcon className="h-4 w-4" />
                                    </Button>
                                    {isStickyRow(split) ? (
                                      <span className="flex h-9 items-center">Sticky</span>
                                    ) : null}
                                    <div
                                      className={`flex min-w-40 flex-1 flex-col gap-2 ${
                                        isStickyRow(split) ? "" : "max-sm:basis-full"
                                      }`}
                                    >
                                      <Field
                                        id={`splits.${index}.defaultBeneficiary`}
                                        name={`splits.${index}.defaultBeneficiary`}
                                        aria-label={isStickyRow(split) ? "Sticky token" : undefined}
                                        className="h-9"
                                        width="w-full min-w-0"
                                        placeholder={
                                          isStickyRow(split) ? "0x… (Sticky token)" : "0x"
                                        }
                                        required
                                        defaultValue={
                                          isStickyRow(split) ? undefined : namedOperator
                                        }
                                      />
                                      {chainIds.length > 1 && !isStickyRow(split) && (
                                        <label
                                          className="flex w-fit items-center self-end gap-2 text-md italic text-zinc-400"
                                          htmlFor={`perChainBeneficiary-${index}`}
                                        >
                                          adjust per chain
                                          <input
                                            type="checkbox"
                                            id={`perChainBeneficiary-${index}`}
                                            checked={(split.beneficiary?.length ?? 0) > 0}
                                            onChange={(e) =>
                                              toggleSplitPerChain(index, e.target.checked)
                                            }
                                          />
                                        </label>
                                      )}
                                    </div>
                                  </div>
                                  {isStickyRow(split) && stickyReason ? (
                                    <p role="alert" className="mt-2 text-sm text-red-500">
                                      {stickyReason}
                                    </p>
                                  ) : isStickyRow(split) ? (
                                    <>
                                      <StickyGroupFields
                                        value={stickyGroupOf(split)}
                                        onChange={(patch) =>
                                          setFieldValue(`splits.${index}`, { ...split, ...patch })
                                        }
                                      />
                                      <StickyTokenStatus
                                        row={{
                                          ...stickyGroupOf(split),
                                          token: split.defaultBeneficiary,
                                        }}
                                        chainIds={sortedChainIds}
                                      />
                                    </>
                                  ) : null}
                                  {chainIds.length > 1 && !isStickyRow(split) && (
                                    <div className="mt-2">
                                      {(split.beneficiary?.length ?? 0) > 0 && (
                                        <div className="mt-2 space-y-2">
                                          {sortedChainIds.map((chainId) => {
                                            const entry = split.beneficiary?.find(
                                              (b) => Number(b.chainId) === Number(chainId),
                                            );
                                            return (
                                              <div
                                                key={chainId}
                                                className="flex items-center gap-2 text-md text-zinc-600"
                                              >
                                                <div className="flex w-28 shrink-0 items-center gap-2 text-sm sm:w-40">
                                                  <ChainLogo
                                                    chainId={chainId}
                                                    width={20}
                                                    height={20}
                                                  />
                                                  <span className="text-zinc-400">
                                                    {chainDisplayName(chainId)}
                                                  </span>
                                                </div>
                                                <input
                                                  aria-label={`${chainDisplayName(chainId)} recipient`}
                                                  className={perChainInputClassName}
                                                  placeholder="0x"
                                                  value={entry?.address ?? ""}
                                                  onChange={(e) =>
                                                    setSplitChainBeneficiary(
                                                      index,
                                                      chainId,
                                                      e.target.value,
                                                    )
                                                  }
                                                />
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                              <Button
                                type="button"
                                onClick={() =>
                                  arrayHelpers.push({
                                    percentage: "",
                                    defaultBeneficiary: "",
                                  })
                                }
                                className="h-7 mt-3 bg-zinc-100 border border-zinc-200 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900"
                              >
                                add split +
                              </Button>
                            </div>
                          )}
                        />
                        {values.splits.length > 0 && (
                          <div className="text-sm font-medium text-zinc-500 mt-4 border-l border-zinc-300 pl-2 py-1 px-1">
                            Split{" "}
                            {values.splits.reduce(
                              (sum, split) => sum + (Number(split.percentage) || 0),
                              0,
                            )}
                            % of tokens. The payer receives{" "}
                            {100 -
                              values.splits.reduce(
                                (sum, split) => sum + (Number(split.percentage) || 0),
                                0,
                              )}
                            %.
                          </div>
                        )}
                        {values.splits.length == 0 && (
                          <div className="text-sm font-medium text-zinc-500 mt-4 border-l border-zinc-300 pl-2 py-1 px-1">
                            With no tokens split, the payer receives them all.
                          </div>
                        )}
                      </div>
                      <NotesSection>
                        <div className="text-zinc-600 text-md mt-4 italic">
                          <ul className="list-disc list-inside space-y-2">
                            <li className="flex">
                              <span className="mr-2">•</span>A 50% cut creates half as many tokens
                              for the same payment, doubling the price to create each token.
                            </li>
                            <li className="flex">
                              <span className="mr-2">•</span>
                              If a configured Uniswap market offers more {revnetTokenSymbol} for the
                              payment, it can buy back existing tokens there instead of issuing new
                              ones. The money used goes to the market.
                            </li>
                            <li className="flex">
                              <span className="mr-2">•</span>
                              Token splits apply to both newly created tokens and buybacks.
                            </li>
                            <li className="flex">
                              <span className="mr-2">•</span>
                              <span>
                                A recipient can be a split hook that handles the tokens
                                automatically.
                              </span>
                            </li>
                            <li className="flex">
                              <span className="mr-2">•</span>
                              The operator can change who receives the split tokens at any time, but
                              cannot increase the total split for this stage.
                            </li>
                            <li className="flex">
                              <span className="mr-2">•</span>
                              The operator can be a wallet or a contract. Choose its address in the
                              Operator section.
                            </li>
                            <li className="flex">
                              <span className="mr-2">•</span>
                              The same operator serves every stage. It can pass the role to another
                              address or give it up.
                            </li>
                          </ul>
                        </div>
                      </NotesSection>
                      <FieldArray
                        name="autoIssuance"
                        render={(arrayHelpers) => (
                          <div>
                            <p className="text-md text-zinc-500 mt-10">
                              Optionally, issue {revnetTokenSymbol} automatically when the stage
                              starts, without a payment.
                            </p>
                            {values.autoIssuance?.map((autoissuance, index) => (
                              <div
                                key={`autoissuance-${index}`}
                                className="mt-4 flex flex-wrap items-start gap-2 text-md text-zinc-600"
                              >
                                <label
                                  className="flex h-9 items-center whitespace-nowrap"
                                  htmlFor={`autoIssuance.${index}.amount`}
                                >
                                  {index === 0 ? "Issue" : "... and"}
                                </label>
                                <div className="relative w-40 shrink-0">
                                  <Field
                                    id={`autoIssuance.${index}.amount`}
                                    name={`autoIssuance.${index}.amount`}
                                    type="number"
                                    min="0"
                                    step="any"
                                    className="h-9 w-full pr-16 pl-2"
                                    required
                                  />
                                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none">
                                    {revnetTokenSymbol}
                                  </span>
                                </div>
                                <label
                                  className="flex h-9 items-center"
                                  htmlFor={`autoIssuance.${index}.beneficiary`}
                                >
                                  to
                                </label>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  aria-label="Remove auto issuance"
                                  onClick={() => arrayHelpers.remove(index)}
                                  className="ml-auto h-9 shrink-0 px-0 sm:order-last sm:ml-0 sm:px-3"
                                >
                                  <XIcon className="h-4 w-4" />
                                </Button>
                                <div className="flex min-w-56 flex-1 flex-col gap-2 max-sm:basis-full">
                                  <Field
                                    id={`autoIssuance.${index}.beneficiary`}
                                    name={`autoIssuance.${index}.beneficiary`}
                                    className="h-9 w-full min-w-0"
                                    placeholder="0x"
                                    required
                                  />
                                  {chainIds.length > 1 && (
                                    <div className="flex items-center gap-2 self-end">
                                      <label>on</label>
                                      <ChainSelector
                                        value={
                                          (autoissuance.chainId ?? sortedChainIds[0]) as JBChainId
                                        }
                                        onChange={(chainId) =>
                                          setFieldValue(`autoIssuance.${index}.chainId`, chainId)
                                        }
                                        options={chainIds}
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                            <Button
                              type="button"
                              onClick={() => {
                                // New rows are homed on the first selected chain;
                                // the per-row picker re-homes them.
                                arrayHelpers.push({
                                  amount: "",
                                  beneficiary: "",
                                  chainId: sortedChainIds[0],
                                });
                              }}
                              className="h-7 mt-3 bg-zinc-100 border border-zinc-200 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900"
                            >
                              add auto issuance +
                            </Button>
                            {values.autoIssuance.length > 0 && (
                              <div className="text-sm font-medium text-zinc-500 mt-4 border-l border-zinc-300 pl-2 py-1 px-1">
                                Total issued at stage start:{" "}
                                {commaNumber(
                                  values.autoIssuance?.reduce(
                                    (sum, issuance) => sum + (Number(issuance.amount) || 0),
                                    0,
                                  ),
                                )}{" "}
                                {revnetTokenSymbol}.
                              </div>
                            )}
                          </div>
                        )}
                      />
                    </div>
                  </div>

                  <div className="pb-10">
                    <div
                      id="priceFloorTaxIntensity-group"
                      className="block text-md font-semibold leading-6"
                    >
                      2. {revnetTokenSymbol} cash outs
                    </div>
                    <p className="text-md text-zinc-500 mt-3">
                      Holders can cash out {revnetTokenSymbol} for a share of the revnet&apos;s{" "}
                      {reserveAsset}, or borrow against their tokens.
                    </p>
                    <p className="text-md text-zinc-500 mt-3">
                      A cash-out tax leaves some of that share in the revnet for remaining holders.
                      A higher tax leaves more behind and reduces how much holders can cash out or
                      borrow.
                    </p>
                    <p className="text-md text-zinc-500 mt-3">
                      Use the preview to compare what a holder receives with what remains in the
                      revnet.
                    </p>
                    <div className="space-y-2 mt-6">
                      <div className="flex justify-between relative w-full">
                        {steps.map((step) => (
                          <span
                            key={`${step}`}
                            className={
                              Number(step) === 0
                                ? "text-sm"
                                : Number(step) === 20
                                  ? "text-sm"
                                  : "text-sm"
                            }
                          >
                            {/* {Number(step) / 100} */}
                            {step}
                          </span>
                        ))}
                      </div>
                      {/* Styled slider for priceFloorTaxIntensity */}
                      <div className="flex flex-col justify-center w-full">
                        <Field
                          as="input"
                          type="range"
                          min={0}
                          max={80}
                          step={5}
                          name="priceFloorTaxIntensity"
                          className="h-2 w-full cursor-pointer appearance-none bg-gray-200 px-0 accent-teal-500"
                          aria-label="Cash-out tax"
                        />
                      </div>
                    </div>
                    <CashOutCurvePreview
                      taxRate={Number(values.priceFloorTaxIntensity)}
                      tokenSymbol={revnetTokenSymbol}
                      reserveAsset={reserveAsset}
                    />
                    <NotesSection>
                      <div className="text-zinc-600 text-md mt-4 italic">
                        <ul className="list-disc list-inside space-y-2">
                          <li className="flex">
                            <span className="mr-2">•</span>
                            The cash-out tax stays in the revnet.
                          </li>

                          <li className="flex">
                            <span className="mr-2">•</span>A higher cash-out tax reduces loan
                            capacity.
                          </li>
                          <li className="flex">
                            <span className="mr-2">•</span>
                            For example, with 100 {reserveAsset} in reserve and 100 total{" "}
                            {revnetTokenSymbol}, cashing out 10 tokens gives 10 {reserveAsset} at a
                            tax rate of 0, 8.2 at 0.2, 5.5 at 0.5, or 2.8 at 0.8. These examples
                            apply the cash-out tax. Check the final quote before confirming.
                          </li>
                          <li className="flex">
                            <span className="mr-2">•</span>
                            To calculate this amount, use `(ax/s) * ((1-r) + xr/s)`: `a` is the
                            available reserve, `x` the tokens being cashed out, `s` the total token
                            supply, and `r` the cash-out tax rate from 0 to 1.
                          </li>
                        </ul>
                      </div>
                    </NotesSection>
                  </div>
                  <StartTimeField stageIdx={stageIdx} stages={stages} />

                  <DialogFooter>
                    <div className="flex w-full flex-col items-end gap-3">
                      {submitCount > 0 && !isValid ? (
                        <div
                          className="w-full border-l-2 border-red-500 pl-3 text-left"
                          role="alert"
                        >
                          <p className="text-sm font-semibold text-red-700">
                            Please fix these stage details:
                          </p>
                          <p className="mt-1 whitespace-pre-line text-sm text-red-700">
                            {formatFormErrors(errors)}
                          </p>
                        </div>
                      ) : null}
                      <Button
                        type="submit"
                        className="bg-teal-500 text-melon-950 hover:bg-teal-600"
                      >
                        Save stage
                      </Button>
                    </div>
                  </DialogFooter>
                </Form>
              );
            }}
          </FormProvider>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The cut controls for a stage being edited, or the off state a new stage opens with. */
function cutControlsFrom(stage?: StageData) {
  const percentage = Number(stage?.priceCeilingIncreasePercentage) || 0;
  const frequency = Number(stage?.priceCeilingIncreaseFrequency) || 0;
  return {
    enabled: percentage !== 0 || frequency !== 0,
    percentage: percentage || 10,
    frequency: frequency || 30,
  };
}

function getDefaultStageData(stageIdx: number, stages: StageData[]) {
  if (stageIdx === 0) return defaultStageData;

  const previousStage = stages[stageIdx - 1];
  const previousStageHasCuts = Number(previousStage.priceCeilingIncreaseFrequency) > 0;

  if (previousStageHasCuts) {
    const daysPerCut = Number(previousStage.priceCeilingIncreaseFrequency);
    return {
      ...defaultStageData,
      stageStartCuts: "3",
      stageStart: String(3 * daysPerCut), // Default 3 cuts worth of days
    };
  }

  return defaultStageData;
}
