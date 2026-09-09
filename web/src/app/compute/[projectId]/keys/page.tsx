import { ComputeNav } from "@/components/telligence/ComputeNav";
import { KeyConsole } from "@/components/telligence/KeyConsole";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "API keys · Telligence",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(projectId)) notFound();
  return (
    <>
      <ComputeNav />
      <div id="compute-content" className="compute-container py-8 sm:py-12">
        <Link
          href={`/compute/${encodeURIComponent(projectId)}`}
          className="compute-text-link mb-9 inline-flex min-h-11 items-center text-xs"
        >
          ← Back to the purpose
        </Link>
        <h1 className="mb-8 text-3xl tracking-[-0.05em] sm:text-4xl">Put your compute to work.</h1>
        <KeyConsole projectId={projectId} />
      </div>
    </>
  );
}
