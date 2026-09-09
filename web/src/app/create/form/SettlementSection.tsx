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
        <h2 className="mb-4 text-lg font-bold md:mb-2">2. Settlement</h2>
        <p className="text-lg text-zinc-600">
          Pick which chains your revnet will accept money on and issue {revnetTokenSymbol} from, and
          which reserve asset will back the value of {revnetTokenSymbol}.
        </p>
        <p className="mt-2 text-lg text-zinc-600">
          Holders of {revnetTokenSymbol} can cash out on any of the selected chains for the reserve
          token(s), and can move their {revnetTokenSymbol} between chains at any time, which moves
          proportional reserved tokens alongside.
        </p>
      </div>
      <div className="mt-6 md:col-span-2 md:mt-0">
        <ChainSelect disabled={disabled} />
        <ReserveAssetFields disabled={disabled} />
      </div>
    </>
  );
}
