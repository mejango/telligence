import { notFound } from "next/navigation";
import { OperatedProjects } from "../components/OperatedProjects";
import { resolveAccount } from "../resolveAccount";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AccountRolesPage(props: Props) {
  const { id } = await props.params;
  const account = await resolveAccount(id);
  if (!account) notFound();

  return <OperatedProjects address={account.address} />;
}
