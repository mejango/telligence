import { chainDisplayName, MAINNET_CHAIN_IDS, TESTNET_CHAIN_IDS } from "@/app/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormField } from "@/lib/forms";
import { JB_CHAINS, JBChainId } from "@bananapus/nana-sdk-core";
import { useEffect, useState } from "react";
import {
  pruneDeselectedChain,
  pruneHiddenEnvironmentChains,
} from "../helpers/pruneDeselectedChain";
import { useCreateForm } from "./useCreateForm";

export function ChainSelect({ disabled = false }: { disabled?: boolean }) {
  const [environment, setEnvironment] = useState("production");

  const { values, setFieldValue } = useCreateForm();

  // A revnet has to launch somewhere, so the form opens with one chain already chosen rather
  // than in a state it cannot act on. Ethereum leads MAINNET_CHAIN_IDS.
  useEffect(() => {
    if (values.chainIds.length > 0) return;
    const visible = environment === "production" ? MAINNET_CHAIN_IDS : TESTNET_CHAIN_IDS;
    if (visible.length > 0) setFieldValue("chainIds", [visible[0]]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.chainIds.length, environment]);

  // Clearing the last one silently drops every per-chain value with it.
  const isOnlySelection = (chainId: JBChainId) =>
    values.chainIds.length === 1 && values.chainIds[0] === chainId;

  const handleChainSelect = (chainId: JBChainId, checked: boolean) => {
    if (!checked && isOnlySelection(chainId)) return;
    setFieldValue(
      "chainIds",
      checked ? [...values.chainIds, chainId] : values.chainIds.filter((id) => id !== chainId),
    );

    // If removed, drop that chain's per-chain overrides so nothing is orphaned.
    if (!checked) {
      const pruned = pruneDeselectedChain(values, chainId);
      setFieldValue("operator", pruned.operator);
      setFieldValue("stages", pruned.stages);
    }
  };

  // With one chain selected, every auto-issuance row must target it — a row pointed at a chain
  // the project will not launch on cannot be issued. The reassignment is therefore correct, but
  // it used to happen with only a `console.debug`: the user's earlier per-chain intent
  // disappeared silently, and re-adding chains did not bring it back. Count the rows moved so
  // the UI can say so.
  const [reassignedRows, setReassignedRows] = useState(0);

  useEffect(() => {
    if (values.chainIds.length > 1) {
      setReassignedRows(0);
      return;
    }

    const chainId = values.chainIds[0];
    if (!chainId) return;

    let moved = 0;
    values.stages.forEach((stage, stageIndex) => {
      stage.autoIssuance.forEach((issuance, index) => {
        if (issuance.chainId !== chainId && issuance.amount && issuance.beneficiary) {
          moved += 1;
          setFieldValue(`stages.${stageIndex}.autoIssuance.${index}.chainId`, chainId);
        }
      });
    });
    if (moved) setReassignedRows((previous) => previous + moved);
  }, [values.chainIds, values.stages, setFieldValue]);

  return (
    <div className="flex flex-col gap-4">
      <div className="text-black-500 text-left font-semibold">Choose your chains</div>
      {reassignedRows > 0 ? (
        <p className="text-xs text-amber-700">
          {reassignedRows} auto-issuance {reassignedRows === 1 ? "row was" : "rows were"} moved to
          the only selected chain. Re-adding chains will not restore the previous targets — set them
          again on the stage.
        </p>
      ) : null}
      <div className="max-w-56">
        <Select
          onValueChange={(v) => {
            setEnvironment(v);
            // The other environment's chains are no longer visible; drop
            // their selections and per-chain rows so nothing hidden stays
            // part of the deployment.
            const pruned = pruneHiddenEnvironmentChains(
              values,
              v === "production" ? MAINNET_CHAIN_IDS : TESTNET_CHAIN_IDS,
            );
            // Switching environments prunes every selection, which would leave the revnet with
            // no chain at all. Fall back to the new environment's first chain.
            const visible = v === "production" ? MAINNET_CHAIN_IDS : TESTNET_CHAIN_IDS;
            setFieldValue("chainIds", pruned.chainIds.length > 0 ? pruned.chainIds : [visible[0]]);
            setFieldValue("operator", pruned.operator);
            setFieldValue("stages", pruned.stages);
          }}
          defaultValue="production"
          disabled={disabled}
        >
          <SelectTrigger
            aria-label="Deployment environment"
            className="col-span-1 border-2 border-melon-300 bg-melon-25 hover:border-melon-400 focus:border-melon-600 focus:ring-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="production" key="production">
              Production
            </SelectItem>
            <SelectItem value="testing" key="testing">
              Testnets
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="mt-4 flex flex-wrap gap-6">
        {Object.values(JB_CHAINS)
          .filter(({ chain }) =>
            (environment === "production" ? MAINNET_CHAIN_IDS : TESTNET_CHAIN_IDS).includes(
              chain.id as JBChainId,
            ),
          )
          .map(({ chain }) => (
            <label key={chain.id} className="flex items-center gap-2">
              <FormField
                type="checkbox"
                name="chainIds"
                value={chain.id}
                disabled={disabled}
                className="disabled:opacity-50"
                checked={values.chainIds.includes(Number(chain.id) as JBChainId)}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  handleChainSelect(chain.id as JBChainId, e.target.checked);
                }}
              />
              {chainDisplayName(chain.id)}
            </label>
          ))}
      </div>
    </div>
  );
}
