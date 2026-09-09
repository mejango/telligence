"use client";

import { Input } from "@/components/ui/input";
import { capacityPresentation } from "@/lib/telligence/presentation";
import { parseProjectsResponse } from "@/lib/telligence/project-data";
import { useGatewayResource } from "@/lib/telligence/useGatewayResource";
import Link from "next/link";
import { useState } from "react";
import { CapacityStatus } from "./CapacityStatus";
import { ComputeLoading, GatewayFeedback } from "./GatewayFeedback";

export function ProjectDirectory() {
  const {
    data: projects,
    loading,
    error,
    retry,
  } = useGatewayResource("/v1/projects", parseProjectsResponse);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "humming" | "starting">("all");
  const displayed = projects?.filter((project) => {
    const matches = `${project.name} ${project.purpose} ${project.workload}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase());
    const usable = capacityPresentation(project).usable;
    return (
      matches &&
      (filter === "all" || (filter === "humming" ? usable : project.status === "accumulating"))
    );
  });
  return (
    <section id="projects" aria-labelledby="projects-heading" className="scroll-mt-8">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-melon-300 pb-6">
        <div>
          <p className="compute-eyebrow mb-3">An open invitation</p>
          <h2 id="projects-heading" className="text-3xl tracking-[-0.05em] sm:text-4xl">
            Find a purpose you believe in.
          </h2>
        </div>
        <p className="max-w-[29ch] text-sm leading-6 text-melon-800">
          Small contributions. A little more room to think, every day.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 py-5">
        <div aria-label="Filter projects" className="flex gap-1 text-xs sm:text-sm">
          {(
            [
              ["all", "All purposes"],
              ["humming", "Humming"],
              ["starting", "Getting started"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className="min-h-11 px-3 text-melon-800 hover:bg-melon-100 aria-pressed:bg-melon-200 aria-pressed:text-melon-950"
            >
              {label}
            </button>
          ))}
        </div>
        <Input
          type="search"
          aria-label="Find a purpose"
          placeholder="Find a purpose…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-11 w-full border sm:w-64"
        />
      </div>
      {loading ? (
        <ComputeLoading label="Loading projects" />
      ) : error ? (
        <GatewayFeedback error={error} retry={retry} />
      ) : projects?.length === 0 ? (
        <div className="border-y border-melon-300 py-14 sm:py-20">
          <p className="text-2xl tracking-[-0.04em]">Be the first to put an idea to work.</p>
          <p className="mt-4 max-w-[56ch] text-sm leading-6 text-melon-800">
            Projects appear here after their revnet is deployed and verified. Give people a reason
            to help, and give your idea a place to grow.
          </p>
          <Link
            href="/create"
            className="compute-text-link mt-6 inline-flex min-h-11 items-center gap-3"
          >
            Start a project <span aria-hidden="true">↗</span>
          </Link>
        </div>
      ) : displayed?.length === 0 ? (
        <p role="status" className="border-y border-melon-300 py-12 text-sm">
          No projects match this search.
        </p>
      ) : (
        <div className="border-t border-melon-300">
          {displayed?.map((project, index) => (
            <Link
              key={project.id}
              href={`/compute/${encodeURIComponent(project.id)}`}
              prefetch={false}
              className="compute-project-row group grid gap-5 border-b border-melon-300 py-7 sm:grid-cols-[2rem_minmax(0,1fr)_10rem] sm:gap-6 sm:py-9"
            >
              <span aria-hidden="true" className="hidden pt-1 text-xs text-melon-700 sm:block">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <h3 className="text-xl font-medium tracking-[-0.04em] group-hover:underline group-hover:underline-offset-4 sm:text-2xl">
                    {project.name}
                  </h3>
                  <CapacityStatus project={project} />
                </div>
                <p className="mt-3 line-clamp-2 max-w-[72ch] text-sm leading-6 text-melon-800">
                  {project.purpose}
                </p>
                <p className="mt-3 text-xs text-melon-700">{project.workload}</p>
              </div>
              <div className="flex items-center justify-between sm:block sm:text-right">
                <div>
                  <p className="text-2xl tracking-[-0.05em] tabular-nums">
                    {capacityPresentation(project).daily}
                  </p>
                  <p className="mt-1 text-xs text-melon-700">verified credit / day</p>
                </div>
                <span
                  aria-hidden="true"
                  className="mt-3 inline-block text-xl transition-transform group-hover:translate-x-1"
                >
                  ↗
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
