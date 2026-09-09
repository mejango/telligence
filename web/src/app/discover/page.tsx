import { ComputeNav } from "@/components/telligence/ComputeNav";
import { ProjectDirectory } from "@/components/telligence/ProjectDirectory";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Find a purpose · Telligence",
  description: "Find work you believe in and help fund the compute to keep it going.",
};

export default function Page() {
  return (
    <>
      <ComputeNav />
      <div id="compute-content" className="compute-container py-14 sm:py-20">
        <h1 className="sr-only">Find a purpose</h1>
        <ProjectDirectory />
      </div>
    </>
  );
}
