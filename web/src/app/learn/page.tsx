import { AgentSkillsNote } from "@/components/guides/AgentSkillsNote";
import { RevnetGuide } from "@/components/guides/RevnetGuide";
import { Nav } from "@/components/layout/Nav";
import { LEARN_GUIDE } from "@/lib/learn-guide";
import type { Metadata } from "next";
import Link from "next/link";

const description =
  "Tokenized incentives backed by a balance sheet, on a schedule fixed at launch. Learn how payments, stages, cash outs, and loans work.";

export const metadata: Metadata = {
  title: "Learn revnets",
  description,
  alternates: { canonical: "/learn" },
  openGraph: {
    title: "Learn revnets",
    description,
    url: "/learn",
    type: "website",
    images: [{ url: "/assets/img/revnet-social.png", width: 1428, height: 804, alt: "Revnet" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Learn revnets",
    description,
    images: ["/assets/img/revnet-social.png"],
  },
};

export default function LearnPage() {
  return (
    <>
      <Nav />
      <RevnetGuide
        eyebrow="Learn"
        {...LEARN_GUIDE}
        afterIntroduction={
          <>
            <nav aria-label="Choose a learning path" className="flex flex-wrap gap-3">
              {[
                { href: "#what-is-a-revnet", label: "Learn the basics" },
                { href: "#your-first-transaction", label: "Use a revnet" },
                { href: "#glossary", label: "Look up a term" },
                { href: "/build#launch-with-an-agent", label: "Launch a revnet" },
              ].map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="inline-flex min-h-11 items-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:border-melon-500 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900"
                >
                  {label}
                </Link>
              ))}
            </nav>
            <AgentSkillsNote />
          </>
        }
      />
    </>
  );
}
