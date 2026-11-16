import { ChainSelect } from "./ChainSelect";
import { ReserveAssetFields } from "./ReservedAssets";
import { useCreateForm } from "./useCreateForm";

// Chains and the reserve asset settle together: both decide where and in what
// the revnet accepts money, and both must be chosen before any chain-dependent
// input below (per-chain operators, split beneficiaries, auto-issuance rows).
export function SettlementSection({ disabled = false }: { disabled?: boolean }) {
  const { revnetTokenSymbol } = useCreateForm();

  return (
    <>
      <div className="md:col-span-1">
        <h2 className="mb-4 text-lg font-bold md:mb-2">2. Money and chains</h2>
        <p className="text-lg text-zinc-600">
          Choose where your revnet runs and which tokens its reserve accepts. Holders can cash out{" "}
          {revnetTokenSymbol} for a share of that reserve.
        </p>
        <p className="mt-2 text-lg text-zinc-600">
          Holders can cash out on a selected chain if it has enough reserves. They can also move
          their {revnetTokenSymbol} between linked chains. The matching share of tokens set aside
          for other recipients moves with them.
        </p>
      </div>
      <div className="mt-6 md:col-span-2 md:mt-0">
        <ChainSelect disabled={disabled} />
        <ReserveAssetFields disabled={disabled} />
      </div>
    </>
  );
}
