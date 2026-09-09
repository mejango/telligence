"use client";

import { ChainLogo } from "@/components/ChainLogo";
import EtherscanLink from "@/components/EtherscanLink";
import { ImageWithFallback, IpfsImage } from "@/components/IpfsImage";
import { ProjectLink } from "@/components/ProjectLink";
import { FastForward as ForwardIcon } from "@/components/ui/icons";
import { Revalidating } from "@/components/ui/Revalidating";
import { useCompleteParticipants } from "@/hooks/useCompleteBendystrawLists";
import type { Project } from "@/lib/bendystraw/types";
import { formatShortDate } from "@/lib/date";
import {
  useJBChainId,
  useJBProject,
  useJBProjectMetadataContext,
  useJBTokenContext,
} from "@/lib/nana/project";
import { useSuckers } from "@/lib/nana/suckers";
import type { JBChainId } from "@/lib/nana/types";
import { Profile } from "@/lib/profile";
import { getProjectLinks } from "@/lib/projectLinks";
import { formatTokenSymbol } from "@/lib/utils";
import { JB_CHAINS } from "@bananapus/nana-sdk-core";
import Link from "next/link";
import { Suspense, use, useLayoutEffect, useMemo, useRef, useState } from "react";
import { participantCountSummary } from "../v6/owners/accounts/participantsAggregate";
import { TvlDatum } from "./TvlDatum";

interface Props {
  isRevnet: boolean;
  createdAt: number;
  /** `null` = no operator holds the role; `undefined` = the read failed. */
  operatorPromise: Promise<Profile | null | undefined>;
  projects: Array<
    Pick<
      Project,
      "chainId" | "projectId" | "token" | "decimals" | "balance" | "suckerGroupId" | "tokenSymbol"
    >
  >;
}

export function Header(props: Props) {
  const { isRevnet, operatorPromise, projects, createdAt } = props;
  const operator = use(operatorPromise);
  const chainId = useJBChainId();
  const project = useJBProject();
  const { metadata } = useJBProjectMetadataContext();
  const { token: tokenContext } = useJBTokenContext();

  const participantsQuery = useCompleteParticipants(
    {
      suckerGroupId: projects[0].suckerGroupId,
      balance_gt: "0",
    },
    Number(chainId),
    Boolean(projects[0].suckerGroupId),
  );

  const holderSummary = useMemo(
    () => participantCountSummary(participantsQuery.data, participantsQuery.data?.length),
    [participantsQuery.data],
  );
  const holderValue = participantsQuery.isError
    ? "—"
    : participantsQuery.isLoading
      ? "…"
      : `${holderSummary.count}${holderSummary.exact ? "" : "+"}`;
  // Restored from the last session: show the count now, mark it unconfirmed
  // until the 15s poll answers.
  const holdersPending = participantsQuery.isFetching && !participantsQuery.isLoading;
  const { data: suckers } = useSuckers();
  const { name: projectName, logoUri } = metadata?.data ?? {};
  const tokenSymbol = tokenContext?.data ? formatTokenSymbol(tokenContext) : undefined;
  const showProjectName =
    Boolean(projectName) &&
    (!tokenSymbol ||
      projectName?.normalize("NFKC").trim().toLocaleLowerCase() !==
        tokenSymbol.normalize("NFKC").trim().toLocaleLowerCase());

  // const totalSupply = useTotalOutstandingTokens();
  // const totalSupplyFormatted =
  //   totalSupply && token?.data
  //     ? formatUnits(totalSupply, token.data.decimals)
  //     : null;

  const links = getProjectLinks(metadata?.data);
  const website = links.find((link) => link.type === "infoUri");
  const metadataRef = useRef<HTMLDivElement>(null);
  // The metadata row lives inside a Suspense boundary, which can commit AFTER
  // the measuring layout effect first ran (against null refs, observing
  // nothing). Flipping this state when the row actually mounts re-runs the
  // effect with live elements — without it the separators never appear.
  const [metadataMounted, setMetadataMounted] = useState(false);
  const operatorRef = useRef<HTMLSpanElement>(null);
  const websiteRef = useRef<HTMLSpanElement>(null);
  const createdRef = useRef<HTMLSpanElement>(null);
  const chainsRef = useRef<HTMLSpanElement>(null);
  const [joinedMetadata, setJoinedMetadata] = useState({
    website: false,
    created: false,
    chains: false,
  });
  const operatorUnavailable = operator === undefined;
  const hasOperator = operator != null || operatorUnavailable;
  const hasWebsite = website != null;
  const hasCreated = Number(createdAt) > 0;
  const hasSuckers = Boolean(suckers?.length);

  useLayoutEffect(() => {
    const updateSeparators = () => {
      const operatorElement = operatorRef.current;
      const websiteElement = websiteRef.current;
      const createdElement = createdRef.current;
      const chainsElement = chainsRef.current;
      const previousCreatedElement = websiteElement ?? operatorElement;
      const previousChainsElement = createdElement ?? previousCreatedElement;
      // Compare vertical centres, not top edges. These items are not the same
      // height — the operator's link carries a touch-target minimum — so on a
      // single line their tops differ and an offsetTop check reads as
      // "wrapped", quietly hiding every separator.
      const onSameLine = (a: HTMLElement | null, b: HTMLElement | null) => {
        if (!a || !b) return false;
        const first = a.getBoundingClientRect();
        const second = b.getBoundingClientRect();
        const apart = Math.abs((first.top + first.bottom) / 2 - (second.top + second.bottom) / 2);
        return apart < Math.min(first.height, second.height) / 2;
      };
      const nextJoinedMetadata = {
        website: onSameLine(operatorElement, websiteElement),
        created: onSameLine(previousCreatedElement, createdElement),
        chains: onSameLine(previousChainsElement, chainsElement),
      };

      setJoinedMetadata((current) =>
        current.website === nextJoinedMetadata.website &&
        current.created === nextJoinedMetadata.created &&
        current.chains === nextJoinedMetadata.chains
          ? current
          : nextJoinedMetadata,
      );
    };

    updateSeparators();
    const observer = new ResizeObserver(updateSeparators);
    // Watch the items, not just the row. The row is full-width, so it does
    // not resize when an operator's ENS name resolves — but the items do, and
    // that reflow is exactly what decides whether they still share a line.
    for (const element of [
      metadataRef.current,
      operatorRef.current,
      websiteRef.current,
      createdRef.current,
      chainsRef.current,
    ]) {
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [hasOperator, hasWebsite, hasCreated, hasSuckers, metadataMounted]);

  return (
    <header>
      <div className="flex flex-col items-start gap-4 sm:mb-6 sm:flex-row sm:items-center sm:gap-6 mb-4">
        <IpfsImage
          src={logoUri}
          className="block size-[120px] overflow-hidden border border-zinc-200 object-cover sm:size-36"
          alt={`${projectName || "Project"} logo`}
          width={144}
          height={144}
          fallback={
            <ImageWithFallback
              src={chainId && project ? `/api/project-image/${chainId}/${project.projectId}` : null}
              className="block size-[120px] overflow-hidden border border-zinc-200 object-cover sm:size-36"
              alt={`${projectName || "Project"} logo`}
              width={144}
              height={144}
              fallback={
                <div className="flex h-[120px] w-[120px] items-center justify-center rounded bg-zinc-100 sm:size-36">
                  <ForwardIcon className="h-5 w-5 text-black" />
                </div>
              }
            />
          }
        />

        <div className="min-w-0 flex-1">
          <h1 className="mb-2 flex flex-row flex-wrap items-baseline gap-x-[1ch] gap-y-1 font-mono text-3xl">
            <span className="font-bold">
              {tokenContext?.data ? (
                <EtherscanLink
                  value={tokenContext.data.address}
                  type="token"
                  chain={chainId ? JB_CHAINS[chainId].chain : undefined}
                  className="inline-flex min-h-11 items-center sm:min-h-0"
                >
                  {tokenSymbol}
                </EtherscanLink>
              ) : null}
            </span>
            {showProjectName ? <span className="font-medium">{projectName}</span> : null}
          </h1>
          {!isRevnet ? (
            <p className="text-base leading-relaxed text-zinc-700">
              This project isn&apos;t a revnet. Try looking for it on{" "}
              <Link className="underline underline-offset-4" href="https://juicebox.money">
                https://juicebox.money
              </Link>
              .
            </p>
          ) : null}
          {isRevnet ? (
            <>
              <div className="flex flex-row flex-wrap items-center gap-x-4 gap-y-1">
                <TvlDatum projects={projects} />
                <span aria-hidden className="text-lg text-zinc-300 sm:text-xl">
                  |
                </span>
                <div className="sm:text-xl text-lg">
                  <span
                    className="font-medium text-black-500"
                    title={
                      participantsQuery.isError
                        ? "Owner data is unavailable."
                        : holderSummary.exact
                          ? undefined
                          : "At least this many unique owners were found before the indexer result cap."
                    }
                  >
                    <Revalidating pending={holdersPending}>{holderValue}</Revalidating>
                  </span>{" "}
                  <span className="text-zinc-500">
                    {holderSummary.exact && holderSummary.count === 1 ? "owner" : "owners"}
                  </span>
                </div>
                {/* <div className="sm:text-xl text-lg">
              <span className="font-medium text-black-500">
                {`${prettyNumber(totalSupplyFormatted ?? 0)}`}
              </span>{" "}
              <span className="text-zinc-500">{formatTokenSymbol(token)} outstanding</span>
            </div> */}
                {/* <div className="sm:text-xl text-lg">
              <span className="font-medium text-black-500">
                {!cashOutLoading
                  ? `$${Number(cashOutValue).toFixed(4)}`
                  : "..."}
              </span>{" "}
              <span className="text-zinc-500">cash out value</span>
            </div> */}
              </div>
              <Suspense>
                {(hasOperator || website || hasCreated || suckers?.length) && (
                  <div
                    ref={(node) => {
                      metadataRef.current = node;
                      setMetadataMounted(!!node);
                    }}
                    className="mt-1.5 flex flex-wrap items-center gap-x-5 text-[15px] text-zinc-700"
                  >
                    {hasOperator && (
                      <span
                        ref={operatorRef}
                        className="inline-flex max-w-full min-w-0 items-center"
                      >
                        <span className="text-zinc-500">Operator:</span>
                        {operator ? (
                          <EtherscanLink
                            value={operator.address}
                            className="ml-1 inline-block min-h-11 min-w-0 break-all font-medium text-zinc-900 sm:min-h-0"
                          >
                            {operator.displayName}
                          </EtherscanLink>
                        ) : (
                          <span
                            className="ml-1 font-medium text-zinc-500"
                            title="The operator could not be read. This does not mean the revnet has no operator."
                          >
                            unavailable
                          </span>
                        )}
                      </span>
                    )}
                    {website && (
                      <span ref={websiteRef} className="relative inline-flex items-center">
                        {joinedMetadata.website ? (
                          <span
                            aria-hidden
                            className="absolute -left-2.5 top-1/2 h-4 w-px -translate-y-1/2 bg-zinc-300"
                          />
                        ) : null}
                        <span className="text-zinc-500">Site:</span>
                        <a
                          href={website.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-1 inline-flex min-h-11 items-center font-medium text-zinc-900 hover:underline sm:min-h-0"
                        >
                          {website.url.replace(/^https?:\/\//, "")}
                        </a>
                      </span>
                    )}
                    {hasCreated ? (
                      <span ref={createdRef} className="relative inline-flex items-center">
                        {joinedMetadata.created ? (
                          <span
                            aria-hidden
                            className="absolute -left-2.5 top-1/2 h-4 w-px -translate-y-1/2 bg-zinc-300"
                          />
                        ) : null}
                        <span className="text-zinc-500">Created:</span>
                        {/* Formatted in the reader's time zone, which the server cannot
                            know: keep the client's date rather than flag a mismatch. */}
                        <span className="ml-1 font-medium text-zinc-900" suppressHydrationWarning>
                          {formatShortDate(new Date(createdAt * 1000))}
                        </span>
                      </span>
                    ) : null}
                    {suckers?.length ? (
                      <span ref={chainsRef} className="relative inline-flex items-baseline">
                        {joinedMetadata.chains ? (
                          <span
                            aria-hidden
                            className="absolute -left-2.5 top-1/2 h-4 w-px -translate-y-1/2 bg-zinc-300"
                          />
                        ) : null}
                        <span className="text-zinc-500">On:</span>
                        <span className="ml-0.5 inline-flex">
                          {suckers.map((pair) => {
                            const networkSlug = JB_CHAINS[pair.peerChainId].slug;
                            return (
                              <ProjectLink
                                key={networkSlug}
                                href={`/${networkSlug}:${pair.projectId}`}
                                projectHint={{
                                  name: projectName ?? tokenSymbol ?? `Project ${pair.projectId}`,
                                  logoUri: logoUri ?? null,
                                }}
                                className="relative inline-flex translate-y-[2px] px-1 transition-opacity before:absolute before:-inset-x-1 before:-inset-y-3 before:content-[''] hover:opacity-70"
                              >
                                <ChainLogo
                                  chainId={pair.peerChainId as JBChainId}
                                  width={18}
                                  height={18}
                                  standalone
                                />
                              </ProjectLink>
                            );
                          })}
                        </span>
                      </span>
                    ) : null}
                  </div>
                )}
              </Suspense>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
