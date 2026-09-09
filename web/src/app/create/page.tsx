import { ComputeCreateForm } from "@/components/telligence/ComputeCreateForm";
import { ComputeNav } from "@/components/telligence/ComputeNav";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Raise for compute · Telligence",
  description:
    "Give people a purpose to believe in. Raise backing for recurring inference on Base.",
};

export default function Page() {
  return (
    <>
      <ComputeNav />
      <div id="compute-content" className="compute-container py-12 sm:py-20">
        <ComputeCreateForm />
      </div>
    </>
  );
}
