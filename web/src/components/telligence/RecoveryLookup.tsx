"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  configuredRecoveryFactory,
  lookupRecoveryProject,
  parseRecoveryProjectId,
  type RecoveryProject,
} from "@/lib/telligence/recovery-lookup";
import { getViemPublicClient } from "@/lib/wagmiTransports";
import { useEffect, useRef, useState } from "react";
import { ProjectRecoveryControls } from "./ProjectRecoveryControls";

export function RecoveryLookup({ initialProjectId = "" }: { initialProjectId?: string }) {
  const [projectId, setProjectId] = useState(initialProjectId);
  const [project, setProject] = useState<RecoveryProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(0);
  useEffect(
    () => () => {
      operation.current += 1;
    },
    [],
  );

  async function lookup(event: React.FormEvent) {
    event.preventDefault();
    const current = ++operation.current;
    setProject(null);
    setError(null);
    setLoading(true);
    try {
      const id = parseRecoveryProjectId(projectId.trim());
      const factory = configuredRecoveryFactory();
      const found = await lookupRecoveryProject(getViemPublicClient(8453), factory, id);
      if (operation.current === current) setProject(found);
    } catch (failure) {
      if (operation.current === current)
        setError(
          failure instanceof Error
            ? failure.message
            : "The recovery registry could not be read. Try again.",
        );
    } finally {
      if (operation.current === current) setLoading(false);
    }
  }
  return (
    <div className="max-w-[56rem]">
      <p className="compute-eyebrow">The way out stays open</p>
      <h1 className="mt-5 text-4xl leading-[1.1] tracking-[-0.06em] sm:text-5xl">
        Recover compute backing.
      </h1>
      <p className="mt-6 max-w-[68ch] text-sm leading-7 text-melon-800">
        Look up your project directly on Base. This route uses the deployed contracts and remains
        available when the compute gateway is offline. The project&apos;s policy determines who can
        begin recovery and when each step can proceed.
      </p>
      <form onSubmit={lookup} className="mt-10 border-y border-melon-300 py-7">
        <label htmlFor="recovery-project-id" className="text-sm">
          Base project number
        </label>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <Input
            id="recovery-project-id"
            value={projectId}
            onChange={(event) => {
              operation.current += 1;
              setProjectId(event.target.value);
              setProject(null);
              setError(null);
              setLoading(false);
            }}
            inputMode="numeric"
            placeholder="For example: 12"
            aria-describedby="recovery-id-help"
            className="h-12 sm:max-w-60"
          />
          <Button type="submit" size="lg" loading={loading} className="h-12">
            Look up recovery{" "}
            <span aria-hidden="true" className="ml-5">
              →
            </span>
          </Button>
        </div>
        <p id="recovery-id-help" className="mt-3 text-xs leading-6 text-melon-700">
          Find this number in your project&apos;s Base / Project label or its launch transaction.
        </p>
      </form>
      {error && (
        <p role="alert" className="mt-6 border border-melon-300 p-5 text-sm leading-7">
          {error}
        </p>
      )}
      {loading && (
        <p role="status" className="mt-6 text-xs text-melon-700">
          Reading the Base factory and recovery contracts…
        </p>
      )}
      {project && (
        <section className="mt-10">
          <h2 className="text-xl tracking-[-0.03em]">Base project {project.revnetId.toString()}</h2>
          <p className="mt-3 break-all text-xs leading-6 text-melon-700">
            Registered vault:{" "}
            <a
              className="compute-text-link"
              href={`https://basescan.org/address/${project.vaultAddress}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {project.vaultAddress}
            </a>
          </p>
          <div className="mt-7">
            <ProjectRecoveryControls
              key={`${project.factoryAddress}:${project.revnetId}`}
              revnetId={project.revnetId}
              policyAddress={project.policyAddress}
              vaultAddress={project.vaultAddress}
            />
          </div>
        </section>
      )}
    </div>
  );
}
