import { chainDisplayName } from "@/app/constants";
import { ChainLogo } from "@/components/ChainLogo";
import { ChainSelector } from "@/components/ChainSelector";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Trash2 as TrashIcon } from "@/components/ui/icons";
import { toast } from "@/components/ui/use-toast";
import { withSchema } from "@/lib/formValidation";
import { FieldArray, Form, FormProvider } from "@/lib/forms";
import { commaNumber } from "@/lib/number";
import { cn, sortChains } from "@/lib/utils";
import { JBChainId } from "@bananapus/nana-sdk-core";
import { cloneElement, useState, useSyncExternalStore } from "react";
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

export function NotesSection({
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

const subscribeToHydration = () => () => {};
const clientIsHydrated = () => true;
const serverIsHydrated = () => false;

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
  const perChainInputClassName =
    "h-9 flex-1 border-2 border-melon-300 bg-melon-25 px-3 py-1.5 text-md placeholder:text-zinc-500 hover:border-melon-400 focus-visible:border-melon-600 focus-visible:outline-none focus-visible:ring-0";

  const [open, setOpen] = useState(false);
  // The server-rendered trigger cannot open a dialog until its handler is attached.
  const hydrated = useSyncExternalStore(subscribeToHydration, clientIsHydrated, serverIsHydrated);

  // The issuance denomination is a single global value (the ruleset's base
  // currency for the whole revnet), edited inline in the first stage's issuance
  // row and buffered like the operators. Later stages quote it, so they read
  // the parent's current value rather than a buffer of their own.
  const [draftBaseCurrency, setDraftBaseCurrency] = useState(issuanceBaseCurrency);
  const editsBaseCurrency = stageIdx === 0 && !customReserve;
  const baseCurrency = stageIdx === 0 ? draftBaseCurrency : issuanceBaseCurrency;
  const baseCurrencySymbol = customReserve ? reserveAssetSymbol : baseCurrency;

  // Move enableCut state to top level
  const [enableCut, setEnableCut] = useState(
    Boolean(
      initialValues &&
      (Number(initialValues.priceCeilingIncreasePercentage) !== 0 ||
        Number(initialValues.priceCeilingIncreaseFrequency) !== 0),
    ),
  );
  const [uiCutPercentage, setUiCutPercentage] = useState(
    initialValues && Number(initialValues.priceCeilingIncreasePercentage) !== 0
      ? Number(initialValues.priceCeilingIncreasePercentage)
      : 10,
  );
  const [uiCutFrequency, setUiCutFrequency] = useState(
    initialValues && Number(initialValues.priceCeilingIncreaseFrequency) !== 0
      ? Number(initialValues.priceCeilingIncreaseFrequency)
      : 30,
  );
  const [hasUserSetCut, setHasUserSetCut] = useState(false);

  // Discrete values matching your radio options
  const steps = ["no tax", "light", "medium", "heavy", "extreme"];

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        // (Re)start the buffers from the parent's current state on every open.
        if (nextOpen) {
          setDraftBaseCurrency(issuanceBaseCurrency);
        }
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        {cloneElement(children, { disabled: !hydrated || children.props.disabled })}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl p-4 sm:p-6">
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
              // Handler for checkbox toggle
              const handleCutToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
                const checked = e.target.checked;
                setEnableCut(checked);
                if (checked) {
                  if (!hasUserSetCut) {
                    setUiCutPercentage(10);
                    setUiCutFrequency(30);
                  }
                  // else: keep last user-entered values
                }
                // Do not reset values on uncheck, just hide the fields
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
                        How many {revnetTokenSymbol} to issue when receiving 1 {baseCurrencySymbol}.
                      </p>

                      <PickupFromPreviousStage
                        stageIdx={stageIdx}
                        values={values}
                        setFieldValue={setFieldValue}
                      />

                      <div className="mt-2 flex flex-col items-start gap-2 text-md text-zinc-600">
                        <div className="grid h-9 w-full min-w-0 grid-cols-[minmax(6rem,1fr)_max-content] items-center border-2 border-melon-300 bg-melon-25 hover:border-melon-400 focus-within:border-melon-600 sm:w-[260px]">
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
                                aria-label="Issuance currency"
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
                        <div className="flex w-full flex-wrap items-center gap-2">
                          {!enableCut ? (
                            <>
                              <label
                                htmlFor="enableCut"
                                className="whitespace-nowrap italic text-zinc-400"
                              >
                                add automatic cuts?
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
                                  onChange={(e) => {
                                    setUiCutPercentage(Number(e.target.value));
                                    setHasUserSetCut(true);
                                  }}
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
                                    className="h-9 w-28 border-2 border-melon-300 bg-melon-25 pr-10 pl-2 hover:border-melon-400 focus:border-melon-600 focus:ring-0"
                                    value={String(uiCutFrequency)}
                                    onChange={(e) => {
                                      setUiCutFrequency(Number(e.target.value));
                                      setHasUserSetCut(true);
                                    }}
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
                                  <div className="mt-4 flex flex-wrap items-center gap-2 text-md text-zinc-600">
                                    <label
                                      className="whitespace-nowrap"
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
                                    <label htmlFor={`splits.${index}.defaultBeneficiary`}>to</label>
                                    <Field
                                      id={`splits.${index}.defaultBeneficiary`}
                                      name={`splits.${index}.defaultBeneficiary`}
                                      className="h-9"
                                      width="min-w-40 flex-1"
                                      placeholder="0x"
                                      required
                                      defaultValue={namedOperator}
                                    />
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => arrayHelpers.remove(index)}
                                      className="h-9 px-0 sm:px-3"
                                    >
                                      <TrashIcon className="h-4 w-4" />
                                    </Button>
                                  </div>
                                  {chainIds.length > 1 && (
                                    <div className="mt-2">
                                      <label
                                        className="flex w-fit items-center gap-2 text-md italic text-zinc-400"
                                        htmlFor={`perChainBeneficiary-${index}`}
                                      >
                                        set beneficiary per chain?
                                        <input
                                          type="checkbox"
                                          id={`perChainBeneficiary-${index}`}
                                          checked={(split.beneficiary?.length ?? 0) > 0}
                                          onChange={(e) =>
                                            toggleSplitPerChain(index, e.target.checked)
                                          }
                                        />
                                      </label>
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
                                                <div className="flex w-40 shrink-0 items-center gap-2 text-sm">
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
                                                  aria-label={`${chainDisplayName(chainId)} beneficiary`}
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
                            Total split limit of{" "}
                            {values.splits.reduce(
                              (sum, split) => sum + (Number(split.percentage) || 0),
                              0,
                            )}
                            %, payer always receives{" "}
                            {100 -
                              values.splits.reduce(
                                (sum, split) => sum + (Number(split.percentage) || 0),
                                0,
                              )}
                            % of issuance.
                          </div>
                        )}
                        {values.splits.length == 0 && (
                          <div className="text-sm font-medium text-zinc-500 mt-4 border-l border-zinc-300 pl-2 py-1 px-1">
                            Without splits, the payer always receives 100% of issuance.
                          </div>
                        )}
                      </div>
                      <NotesSection>
                        <div className="text-zinc-600 text-md mt-4 italic">
                          <ul className="list-disc list-inside space-y-2">
                            <li className="flex">
                              <span className="mr-2">•</span>
                              Cutting issuance by 50% means to double the price – a halvening
                              effect.
                            </li>
                            <li className="flex">
                              <span className="mr-2">•</span>
                              If there's a market for {revnetTokenSymbol} / {reserveAsset} offering
                              a better price, all {reserveAsset} paid in will be used to buyback
                              instead of feeding the revnet. Uniswap is used as the market.
                            </li>
                            <li className="flex">
                              <span className="mr-2">•</span>
                              Splits apply to both issuance and buybacks.
                            </li>
                            <li className="flex">
                              <span className="mr-2">•</span>
                              <span>
                                You can write and deploy a custom split hook that automatically
                                receives and processes the split {revnetTokenSymbol}.
                              </span>
                            </li>
                            <li className="flex">
                              <span className="mr-2">•</span>
                              If there are splits, the revnet operator can change the distribution
                              of the split limit to new destinations at any time.
                            </li>
                            <li className="flex">
                              <span className="mr-2">•</span>
                              The revnet operator can be a multisig, a DAO, an LLC, a core team, an
                              airdrop stockpile, a staking rewards contract, or some other address.
                            </li>
                            <li className="flex">
                              <span className="mr-2">•</span>
                              The revnet operator is set once and is not bound by stages. The revnet
                              operator can hand off this responsibility to another address at any
                              time, or relinquish it altogether.
                            </li>
                          </ul>
                        </div>
                      </NotesSection>
                      <FieldArray
                        name="autoIssuance"
                        render={(arrayHelpers) => (
                          <div>
                            <p className="text-md text-zinc-500 mt-10">
                              Optionally, auto-issue {revnetTokenSymbol} when the stage starts.
                            </p>
                            {values.autoIssuance?.map((autoissuance, index) => (
                              <div
                                key={`autoissuance-${index}`}
                                className="mt-4 grid grid-cols-[auto_12rem_auto_minmax(0,1fr)_auto] items-center gap-2 text-md text-zinc-600 sm:flex"
                              >
                                <label
                                  className="whitespace-nowrap"
                                  htmlFor={`autoIssuance.${index}.amount`}
                                >
                                  {index === 0 ? "Issue" : "... and"}
                                </label>
                                <div className="relative w-48 sm:w-40">
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
                                <label htmlFor={`autoIssuance.${index}.beneficiary`}>to</label>
                                <Field
                                  id={`autoIssuance.${index}.beneficiary`}
                                  name={`autoIssuance.${index}.beneficiary`}
                                  className="col-span-3 col-start-2 row-start-2 h-9 w-full min-w-0 sm:col-auto sm:row-auto sm:flex-1"
                                  placeholder="0x"
                                  required
                                />
                                {chainIds.length > 1 && (
                                  <>
                                    <label className="col-start-1 row-start-3 whitespace-nowrap sm:col-auto sm:row-auto">
                                      on
                                    </label>
                                    <div className="col-span-3 col-start-2 row-start-3 sm:col-auto sm:row-auto">
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
                                  </>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => arrayHelpers.remove(index)}
                                  className="col-start-5 row-span-2 row-start-1 h-9 justify-self-end self-center pr-0 pl-2 sm:col-auto sm:row-auto sm:px-3"
                                >
                                  <TrashIcon className="h-4 w-4" />
                                </Button>
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
                                Total auto issuance of{" "}
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
                      The only way for anyone to access the {reserveAsset} used to issue{" "}
                      {revnetTokenSymbol} is by cashing out or taking out a loan from the revnet
                      using their {revnetTokenSymbol}.
                    </p>
                    <p className="text-md text-zinc-500 mt-3">
                      A tax can be added that makes cashing out and loans more expensive, while
                      rewarding {revnetTokenSymbol} holders who stick around as others cash out.
                    </p>
                    <p className="text-md text-zinc-500 mt-3">
                      A light tax is recommended to add an incentive while maintaining liquidity for{" "}
                      {revnetTokenSymbol} holders.
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
                          aria-label="Exit tax percentage"
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
                            The heavier the tax, the less that can be accessed by cashing out or
                            taking out a loan at any given time, and the more that is left to share
                            between remaining holders who cash out later.
                          </li>

                          <li className="flex">
                            <span className="mr-2">•</span>
                            Loans are an automated source of revenue for {revnetTokenSymbol}. By
                            making loans more expensive, a heavier cash out tax reduces potential
                            loan revenue.
                          </li>
                          <li className="flex">
                            <span className="mr-2">•</span>
                            Given 100 {reserveAsset} in the revnet, 100 total supply of{" "}
                            {revnetTokenSymbol}, and 10 {revnetTokenSymbol} being cashed out, a tax
                            rate of 0 would yield a cash out value of 10 {reserveAsset}, 0.2 would
                            yield 8.2 {reserveAsset}, 0.5 would yield 5.5 {reserveAsset}, and 0.8
                            would yield 2.8 {reserveAsset}.
                          </li>
                          <li className="flex">
                            <span className="mr-2">•</span>
                            The formula for the amount of {reserveAsset} received when cashing out
                            is `(ax/s) * ((1-r) + xr/s)` where: `r` is the cash out tax rate, `a` is
                            the amount in the revnet being accessed, `s` is the current token supply
                            of {revnetTokenSymbol}, `x` is the amount of {revnetTokenSymbol} being
                            cashed out.
                          </li>
                        </ul>
                      </div>
                    </NotesSection>
                  </div>
                  <StartTimeField stageIdx={stageIdx} stages={stages} />

                  <DialogFooter>
                    <div className="flex w-full flex-col items-end gap-3">
                      <Button
                        type="submit"
                        className="bg-teal-500 text-melon-950 hover:bg-teal-600"
                      >
                        Save stage
                      </Button>
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
