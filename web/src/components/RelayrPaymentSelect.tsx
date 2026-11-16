"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FundingChainOption } from "@/lib/transaction-review";
import { useId } from "react";

interface Props {
  options: readonly FundingChainOption[];
  value: number | null;
  onValueChange: (chainId: number) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function RelayrPaymentSelect(props: Props) {
  const {
    options,
    value,
    onValueChange,
    label = "How would you like to pay?",
    placeholder = "Select chain",
    disabled = false,
  } = props;
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-left text-black-500 font-semibold mb-2 block">
        {label}
      </label>
      <div className="max-w-sm">
        <Select
          onValueChange={(chainId) => onValueChange(Number(chainId))}
          value={value?.toString()}
          disabled={disabled}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem value={option.chainId.toString()} key={option.chainId}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
