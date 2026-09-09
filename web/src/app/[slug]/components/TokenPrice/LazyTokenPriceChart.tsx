"use client";

import { ChartSkeleton } from "@/components/loading/LoadingSkeletons";
import dynamic from "next/dynamic";

export const LazyTokenPriceChart = dynamic(
  () => import("./TokenPriceChart").then((module) => module.TokenPriceChart),
  {
    ssr: false,
    loading: () => (
      <ChartSkeleton className="mt-6 aspect-[4/3] w-full sm:aspect-[2/1] lg:aspect-[5/2]" />
    ),
  },
);
