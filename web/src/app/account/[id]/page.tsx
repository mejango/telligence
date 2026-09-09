import { notFound } from "next/navigation";
import { AccountActivity } from "./components/AccountActivity";
import { resolveAccount } from "./resolveAccount";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AccountActivityPage(props: Props) {
  const { id } = await props.params;
  const account = await resolveAccount(id);
  if (!account) notFound();

  return <AccountActivity address={account.address} />;
}
