import { ComputeNav } from "@/components/telligence/ComputeNav";
import { RecoveryLookup } from "@/components/telligence/RecoveryLookup";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Recover compute backing · Telligence",
  description:
    "Read and recover your compute position directly from its Base contracts, even when the gateway is unavailable.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  const initialProjectId =
    typeof project === "string" && /^[1-9]\d{0,77}$/.test(project) ? project : "";
  return (
    <>
      <ComputeNav />
      <div id="compute-content" className="compute-container py-14 sm:py-20">
        <RecoveryLookup initialProjectId={initialProjectId} />
      </div>
    </>
  );
}
