import { AuditPromptActions } from "@/components/AuditPromptActions";
import { Nav } from "@/components/layout/Nav";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Audit Revnet",
  description: "Inspect the Revnet V6 contracts, Juicebox V6 protocol, and Revnet Money webclient.",
};

const CODE_LINKS = [
  { label: "Revnet contracts", href: "https://github.com/rev-net/revnet-core-v6" },
  { label: "Complete Juicebox V6 source index", href: "https://github.com/Bananapus/version-6" },
  { label: "Juicebox core protocol", href: "https://github.com/Bananapus/nana-core-v6" },
  { label: "Deployments", href: "https://github.com/Bananapus/deploy-all-v6" },
  { label: "Cross-chain settlement", href: "https://github.com/Bananapus/nana-suckers-v6" },
  { label: "Buyback hook", href: "https://github.com/Bananapus/nana-buyback-hook-v6" },
  { label: "Shop hook", href: "https://github.com/Bananapus/nana-721-hook-v6" },
  { label: "Revnet Money webclient", href: "https://github.com/mejango/revnet-money" },
] as const;

export default function AuditPage() {
  return (
    <>
      <Nav />
      <div className="mx-auto w-full max-w-4xl px-6 py-14 sm:px-8 sm:py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Audit</p>
        <h1 className="mt-3 text-5xl font-bold leading-[0.95] sm:text-7xl">Verify Revnet.</h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-zinc-600">
          Read the code directly, then use a prompt to review the whole system or one exact
          transaction.
        </p>
        <p className="mt-4 max-w-2xl leading-relaxed text-zinc-600">
          Revnets are built on Juicebox, so a review covers both. The protocol&apos;s own audits and
          prompts are on the{" "}
          <Link
            href="https://juicebox.money/audit"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-melon-400 underline-offset-4"
          >
            Juicebox audit page
          </Link>
          .
        </p>
        <p className="mt-4 max-w-2xl leading-relaxed text-zinc-600">
          Defenders who manage to steal funds and return them are encouraged to keep 10% as a
          reward, paid by all projects together.
        </p>

        <section className="mt-14" aria-labelledby="audit-code">
          <h2 id="audit-code" className="text-2xl font-semibold">
            Code
          </h2>
          <div className="mt-4 divide-y divide-teal-100 border-y border-teal-200">
            {CODE_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-14 items-center justify-between gap-5 py-3 text-sm hover:text-teal-700"
              >
                <span>{link.label}</span>
                <span aria-hidden className="shrink-0 text-zinc-400">
                  ↗
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-14" aria-labelledby="audit-prompts">
          <h2 id="audit-prompts" className="text-2xl font-semibold">
            Audit prompts
          </h2>
          <div className="mt-4">
            <AuditPromptActions />
          </div>
        </section>
      </div>
    </>
  );
}
