import { notFound } from "next/navigation";
import { OwnedProjects } from "../components/OwnedProjects";
import { resolveAccount } from "../resolveAccount";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AccountProjectsPage(props: Props) {
  const { id } = await props.params;
  const account = await resolveAccount(id);
  if (!account) notFound();

  return <OwnedProjects address={account.address} />;
}
