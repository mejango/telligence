import { ComputeNav } from "@/components/telligence/ComputeNav";
import { ComputeProjectPage } from "@/components/telligence/ComputeProjectPage";
import { readComputeProject, readComputeProjectRecord } from "@/lib/telligence/project.server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): Promise<Metadata> {
  const { projectId } = await params;
  const project = await readComputeProject(projectId);
  if (!project) return { title: "A purpose worth funding · Telligence" };
  return {
    title: `${project.name} · Telligence`,
    description: project.purpose.slice(0, 180),
    alternates: { canonical: `/compute/${encodeURIComponent(project.id)}` },
  };
}

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(projectId)) notFound();
  // The server's copy keeps the purpose readable if the live gateway read fails.
  const saved = await readComputeProjectRecord(projectId);
  return (
    <>
      <ComputeNav />
      <div id="compute-content" className="compute-container pb-20 pt-6">
        <ComputeProjectPage
          projectId={projectId}
          initialProject={saved ? { project: saved.project, at: saved.at } : null}
        />
      </div>
    </>
  );
}
