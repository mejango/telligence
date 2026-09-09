import { ComputeNav } from "@/components/telligence/ComputeNav";
import { Button } from "@/components/ui/button";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How compute fundraising works · Telligence",
  description:
    "Follow a contribution from a purpose to recurring inference. Understand capacity, supporter rights, and the contracts underneath.",
};

export default function Page() {
  return (
    <>
      <ComputeNav />
      <article id="compute-content" className="compute-container py-14 sm:py-20">
        <div className="max-w-[52rem]">
          <p className="compute-eyebrow">From belief to useful work</p>
          <h1 className="mt-6 text-4xl leading-[1.1] tracking-[-0.06em] sm:text-6xl">
            A purpose on the surface.
            <br />
            Clear rules underneath.
          </h1>
          <p className="mt-8 max-w-[64ch] text-lg leading-8 text-melon-800">
            Telligence helps people fund recurring AI inference for a project. A revnet coordinates
            the support. A dedicated vault holds the compute backing. The creator puts an API key to
            work.
          </p>
        </div>
        <div className="mt-14 grid gap-10 border-y border-melon-300 py-8 md:grid-cols-4">
          {[
            ["01", "Support", "People contribute to the project’s revnet."],
            ["02", "Activate", "Its compute allocation is converted into backing."],
            ["03", "Think", "Verified backing provides a daily inference allowance."],
            [
              "04",
              "Keep going",
              "The allowance renews each day while the backing and service are available.",
            ],
          ].map(([step, title, detail]) => (
            <div key={step}>
              <p className="compute-eyebrow">{step}</p>
              <h2 className="mt-4 text-lg">{title}</h2>
              <p className="mt-3 text-sm leading-7 text-melon-800">{detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-16 grid gap-16 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="space-y-12 text-sm leading-7 text-melon-800">
            <section id="economics" className="scroll-mt-8">
              <h2 className="text-2xl tracking-[-0.04em] text-melon-950">
                What your contribution does
              </h2>
              <p className="mt-5">
                The revnet accepts funding on Base, with VVV as its accounting and reserve asset.
                Normal Revnet issuance and market buybacks stay in place. Supporters receive
                participation in the revnet; a fixed production split goes to the project&apos;s
                policy wrapper.
              </p>
              <p className="mt-4">
                The wrapper can cash out its production allocation for VVV and send the proceeds to
                the compute vault. Cash-out taxes, available reserves, market routing, and execution
                affect how much VVV arrives. A 40% production split is a share of tokens produced,
                not a promise that 40% of money contributed becomes compute.
              </p>
              <p className="mt-4">
                The vault stakes VVV, locks the resulting sVVV for DIEM, and stakes that DIEM. It
                owns every part of this position. The website shows provider credit only after it
                has been observed and verified.
              </p>
              <p className="mt-4">
                Supporting a purpose does not enforce how its creator uses inference, and it does
                not automatically share the creator&apos;s future revenue. Project revenue reaches
                the revnet only if someone pays it in.
              </p>
            </section>
            <section>
              <h2 className="text-2xl tracking-[-0.04em] text-melon-950">What “humming” means</h2>
              <p className="mt-5">
                A project is humming when its backing has been activated, the service is enabled,
                and a recent provider observation shows spendable daily credit. Its key may remain
                useful without new contributions. Fundraising activity and token prices are not a
                measure of available inference.
              </p>
              <p className="mt-4">
                Venice credit renews at 00:00 UTC. Unused daily credit does not roll over. Different
                models consume it at different rates. The API can pause when the day&apos;s
                allowance is exhausted, during a provider outage, or while backing is being
                recovered.
              </p>
              <p className="mt-4">
                The dashboard shows verified capacity and today&apos;s remaining credit. Missing
                observations stay unknown.
              </p>
            </section>
            <section>
              <h2 className="text-2xl tracking-[-0.04em] text-melon-950">
                A useful key, a separate vault
              </h2>
              <p className="mt-5">
                The creator signs in to create, limit, and revoke project API keys. Applications use
                a compatible inference endpoint. A hosted authentication signer connects to Venice
                as the vault; it has no authority to withdraw the vault&apos;s backing.
              </p>
              <p className="mt-4">
                Key limits and verified provider credit constrain API usage, along with any existing
                project cap. Compromise of the upstream signer can still consume the project&apos;s
                provider-visible credit until it is effectively revoked. Compute access and asset
                authority are separate, but both need care.
              </p>
            </section>
            <section>
              <h2 className="text-2xl tracking-[-0.04em] text-melon-950">Understand the way out</h2>
              <p className="mt-5">
                Compute backing is not part of the liquid reserve supporters can immediately cash
                out. Unwinding a position follows the provider&apos;s sequential cooldowns and the
                vault&apos;s recovery policy. Cooldowns can change; recovery is not instant.
              </p>
              <p className="mt-4">
                Recovered VVV returns to the revnet through its balance-return path. That benefits
                current holders according to the revnet&apos;s rules, rather than promising a refund
                to the original contributors. Every project links to its revnet, wrapper, and vault
                for inspection.
              </p>
              <p className="mt-4">
                The compute service depends on Venice, including its accounts, model availability,
                credit accounting, and upgradeable staking infrastructure. Fixed Revnet terms do not
                remove those dependencies.
              </p>
            </section>
          </div>
          <aside className="self-start border border-melon-300 bg-melon-50 p-7 lg:sticky lg:top-8">
            <p className="compute-eyebrow">Open by construction</p>
            <p className="mt-5 text-sm leading-7">
              The normal journey is a purpose, a contribution, and an API key. The funding terms and
              custody are there to inspect whenever you need them.
            </p>
            <div className="mt-6 space-y-2 text-xs">
              <a
                href="https://github.com/Bananapus/version-6"
                target="_blank"
                rel="noopener noreferrer"
                className="compute-text-link flex min-h-11 items-center"
              >
                Juicebox V6 contracts ↗
              </a>
              <a
                href="https://revnet.money"
                target="_blank"
                rel="noopener noreferrer"
                className="compute-text-link flex min-h-11 items-center"
              >
                Explore Revnets ↗
              </a>
              <a
                href="https://docs.venice.ai/overview/vvv-diem"
                target="_blank"
                rel="noopener noreferrer"
                className="compute-text-link flex min-h-11 items-center"
              >
                Venice compute economics ↗
              </a>
            </div>
            <Button asChild className="mt-6 w-full">
              <Link href="/create">Start a project ↗</Link>
            </Button>
          </aside>
        </div>
      </article>
    </>
  );
}
