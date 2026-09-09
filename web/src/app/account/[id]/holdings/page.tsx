import { notFound } from "next/navigation";
import { StoreItemHoldings } from "../components/StoreItemHoldings";
import { TokenHoldings } from "../components/TokenHoldings";
import { resolveAccount } from "../resolveAccount";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AccountHoldingsPage(props: Props) {
  const { id } = await props.params;
  const account = await resolveAccount(id);
  if (!account) notFound();

  return (
    <div className="flex flex-col gap-8">
      <TokenHoldings address={account.address} />
      <StoreItemHoldings address={account.address} />
    </div>
  );
}
