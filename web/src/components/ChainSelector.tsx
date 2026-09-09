import { chainDisplayName } from "@/app/constants";
import type { JBChainId } from "@/lib/nana/types";
import { sortChains } from "@/lib/utils";
import { ChainLogo } from "./ChainLogo";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

interface ChainSelectorProps {
  value: JBChainId;
  onChange: (chainId: JBChainId) => void;
  disabled?: boolean;
  options: JBChainId[];
}

export const ChainSelector = ({ value, onChange, disabled, options }: ChainSelectorProps) => {
  const chainOptions = sortChains(options);

  return (
    <Select
      onValueChange={(value) => {
        onChange(Number(value) as JBChainId);
      }}
      disabled={disabled}
      defaultValue={String(value)}
    >
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="Select chain">
          {value ? (
            <div className="flex items-center gap-2">
              <ChainLogo chainId={Number(value) as JBChainId} />
              <span>{chainDisplayName(value)}</span>
            </div>
          ) : (
            <span>Select chain</span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {chainOptions.map((chainId) => (
          <SelectItem key={chainId} value={chainId.toString()} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <ChainLogo chainId={chainId as JBChainId} />
              <span>{chainDisplayName(chainId as JBChainId)}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
