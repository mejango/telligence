import { Nav } from "@/components/layout/Nav";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PropsWithChildren } from "react";
import { AccountHeader } from "./components/AccountHeader";
import { AccountMenu } from "./components/AccountMenu";
import { resolveAccount } from "./resolveAccount";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Account | Revnet" };
}

export default async function AccountLayout({ children, params }: PropsWithChildren<Props>) {
  const { id } = await params;
  const account = await resolveAccount(id);
  if (!account) notFound();

  return (
    <>
      <Nav />
      <div className="w-full px-4 pb-16 pt-6 sm:container">
        <div className="flex flex-col gap-6">
          <AccountHeader address={account.address} ensName={account.ensName} />
          <AccountMenu />
          <div>{children}</div>
        </div>
      </div>
    </>
  );
}
