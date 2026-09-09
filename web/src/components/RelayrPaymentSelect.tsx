"use client";

import { chainDisplayName } from "@/app/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChainPayment } from "@/lib/nana/types";
import { formatHexEther } from "@/lib/utils";
import { JBChainId } from "@bananapus/nana-sdk-core";

interface Props {
  payments: ChainPayment[];
  tokenSymbol: string;
  selectedPayment: ChainPayment | null;
  onSelectPayment: (payment: ChainPayment) => void;
  disabled?: boolean;
}

export function RelayrPaymentSelect(props: Props) {
  const { payments, tokenSymbol, selectedPayment, onSelectPayment, disabled = false } = props;
  return (
    <div>
      <div className="text-left text-black-500 font-semibold mb-2">How would you like to pay?</div>
      <div className="max-w-sm">
        <Select
          onValueChange={(v) => onSelectPayment(payments.find((p) => p.chain === Number(v))!)}
          value={selectedPayment?.chain.toString()}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select chain" />
          </SelectTrigger>
          <SelectContent>
            {payments.map((payment) => {
              return (
                <SelectItem value={payment.chain.toString()} key={payment.chain}>
                  {formatHexEther(payment.amount)} {tokenSymbol} on{" "}
                  {chainDisplayName(payment.chain as JBChainId)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
