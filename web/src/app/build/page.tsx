import { AgentSkillsNote } from "@/components/guides/AgentSkillsNote";
import { CopyRevnetBuildPrompt } from "@/components/guides/CopyRevnetBuildPrompt";
import { RevnetGuide } from "@/components/guides/RevnetGuide";
import { Nav } from "@/components/layout/Nav";
import { BUILD_GUIDE } from "@/lib/build-guide";
import type { Metadata } from "next";
import Link from "next/link";

const DESCRIPTION =
  "Launch a revnet without code, connect an app, or write a contract integration. Covers stages, splits, loans, and the operator; shared Juicebox topics link to the Juicebox build guide.";

export const metadata: Metadata = {
  title: "Build with revnets",
  description: DESCRIPTION,
  alternates: { canonical: "/build" },
  openGraph: {
    title: "Build with revnets",
    description: DESCRIPTION,
    url: "/build",
    type: "website",
    images: [{ url: "/assets/img/revnet-social.png", width: 1428, height: 804, alt: "Revnet" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Build with revnets",
    description: DESCRIPTION,
    images: ["/assets/img/revnet-social.png"],
  },
};

export default function BuildPage() {
  return (
    <>
      <Nav />
      <RevnetGuide
        eyebrow="Build"
        {...BUILD_GUIDE}
        afterIntroduction={
          <>
            <nav
              aria-label="Choose a building path"
              className="flex flex-wrap gap-3 sm:grid sm:grid-cols-3"
            >
              {[
                {
                  href: "#launch-with-an-agent",
                  title: "Launch a revnet",
                  description: "With an AI assistant or the launch form. No code needed.",
                },
                {
                  href: "#shared-with-juicebox",
                  title: "Connect an app",
                  description: "Read a revnet, accept payments, and add loans and operator tools.",
                },
                {
                  href: "#extension-points",
                  title: "Write a contract",
                  description: "Add behavior and test it against the V6 contracts.",
                },
              ].map(({ href, title, description }) => (
                <Link
                  key={href}
                  href={href}
                  className="inline-flex min-h-11 items-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-900 hover:border-melon-500 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900 sm:block sm:p-4 sm:text-base"
                >
                  <span className="block font-semibold">{title}</span>
                  <span className="mt-2 hidden text-sm leading-relaxed text-zinc-700 sm:block">
                    {description}
                  </span>
                </Link>
              ))}
            </nav>
            <AgentSkillsNote
              skills={[
                "jb-deploy-ui",
                "revnet-economics",
                "jb-revloans",
                "jb-suckers",
                "jb-bendystraw",
                "jb-interact-ui",
              ]}
              prompt={<CopyRevnetBuildPrompt />}
            />
          </>
        }
        afterSections={
          <p className="leading-relaxed text-zinc-700">
            Start from the smallest operation your product needs and keep the fresh read, builder,
            simulation, review, and confirmation on one path. The complete working client is the{" "}
            <Link
              href="https://github.com/mejango/revnet-money"
              className="underline decoration-melon-400 underline-offset-4"
            >
              Revnet Money repository
            </Link>
            .
          </p>
        }
      />
    </>
  );
}
