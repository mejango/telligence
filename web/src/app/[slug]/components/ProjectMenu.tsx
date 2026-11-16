"use client";

import { decodeProjectRouteSlug } from "@/lib/slug";
import { cn } from "@/lib/utils";
import Link, { useLinkStatus } from "next/link";
import { useParams, useRouter, useSelectedLayoutSegment } from "next/navigation";
import { PropsWithChildren, useEffect, useId, useRef, useState, useTransition } from "react";
import { useProjectNavigation } from "../ProjectRouteContext";
import { ProjectOverflowIcon, ProjectTabIcon } from "./ProjectTabIcon";

export function ProjectMenu({
  mobileActivityActive = false,
  onMobileActivityChange,
}: {
  mobileActivityActive?: boolean;
  onMobileActivityChange?: (active: boolean) => void;
}) {
  const [overflowExpanded, setOverflowExpanded] = useState(false);
  const [pendingAliasHref, setPendingAliasHref] = useState<string | null>(null);
  const [aliasPending, startAliasTransition] = useTransition();
  const navigate = useProjectNavigation();
  const router = useRouter();
  const segment = useSelectedLayoutSegment();
  const tabRow = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const row = tabRow.current;
    const active = row?.querySelector('[aria-current="page"]');
    if (!row || !active) return;
    const rowBox = row.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    if (box.left >= rowBox.left && box.right <= rowBox.right) return;
    // Only the row moves: scrollIntoView would also scroll the page to the tabs.
    row.scrollLeft += box.left + box.width / 2 - (rowBox.left + rowBox.width / 2);
  }, [segment, mobileActivityActive]);
  const aliasNavigation: AliasNavigation = {
    pendingHref: aliasPending ? pendingAliasHref : null,
    navigate: (route, onSelect) => {
      // The existing proof gate owns ordering and its Checking feedback.
      setPendingAliasHref(null);
      navigate(() => {
        setPendingAliasHref(route);
        startAliasTransition(() => {
          onSelect?.();
          router.push(route, { scroll: false });
        });
      }, route);
    },
  };

  return (
    <div className="flex border-b border-zinc-200">
      <ul
        ref={tabRow}
        data-project-tab-scroll
        className="scrollbar-none flex min-w-0 flex-1 touch-pan-x gap-4 overflow-x-auto overflow-y-hidden overscroll-x-contain sm:gap-6"
      >
        <MobileActivityOption
          active={mobileActivityActive}
          onIntent={() => setPendingAliasHref(null)}
          onSelect={() => onMobileActivityChange?.(true)}
        />
        <MenuOption
          aliasNavigation={aliasNavigation}
          href=""
          forceInactive={mobileActivityActive}
          onSelect={() => onMobileActivityChange?.(false)}
        >
          <ProjectTabIcon label="Overview" />
          Overview
        </MenuOption>
        <MenuOption
          aliasNavigation={aliasNavigation}
          href="terms"
          forceInactive={mobileActivityActive}
          onSelect={() => onMobileActivityChange?.(false)}
        >
          <ProjectTabIcon label="Terms" />
          Terms
        </MenuOption>
        <MenuOption
          aliasNavigation={aliasNavigation}
          href="owners"
          forceInactive={mobileActivityActive}
          onSelect={() => onMobileActivityChange?.(false)}
        >
          <ProjectTabIcon label="Owners" />
          Owners
        </MenuOption>
        <MenuOption
          aliasNavigation={aliasNavigation}
          href="shop"
          forceInactive={mobileActivityActive}
          onSelect={() => onMobileActivityChange?.(false)}
        >
          <ProjectTabIcon label="Shop" />
          Shop
        </MenuOption>
        {OVERFLOW_TABS.filter(
          (tab) => overflowExpanded || (!mobileActivityActive && segment === tab.href),
        ).map((tab) => (
          <MenuOption
            key={tab.href}
            aliasNavigation={aliasNavigation}
            href={tab.href}
            forceInactive={mobileActivityActive}
            onSelect={() => onMobileActivityChange?.(false)}
          >
            <ProjectTabIcon label={tab.label} />
            {tab.label}
          </MenuOption>
        ))}
        <li className="-ml-5 flex shrink-0 items-start">
          <MoreProjectOptions
            expanded={overflowExpanded}
            onToggle={() => setOverflowExpanded((current) => !current)}
          />
        </li>
      </ul>
    </div>
  );
}

/** The sections behind More. The current one stays in the row while the rest are hidden. */
const OVERFLOW_TABS = [
  { href: "extras", label: "Extras" },
  { href: "operator", label: "Operator" },
] as const;

function MoreProjectOptions({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label="More project sections"
      aria-expanded={expanded}
      onClick={onToggle}
      className="-mb-px flex min-h-11 min-w-11 shrink-0 items-center justify-center border-b-2 border-transparent px-3 pb-2 text-2xl leading-none text-zinc-500 transition-all hover:text-zinc-800"
    >
      <span
        data-overflow-orientation={expanded ? "horizontal" : "vertical"}
        className={cn("transition-transform", expanded && "rotate-90")}
      >
        <ProjectOverflowIcon />
      </span>
    </button>
  );
}

function MobileActivityOption({
  active,
  onIntent,
  onSelect,
}: {
  active: boolean;
  onIntent: () => void;
  onSelect: () => void;
}) {
  const navigate = useProjectNavigation();
  const className = cn(
    "-mb-px flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 pb-2 text-base font-medium uppercase transition-all",
    active ? "border-teal-500 text-black" : "border-transparent text-zinc-500 hover:text-zinc-800",
  );
  const contents = (
    <>
      <ProjectTabIcon label="Activity" />
      Latest
    </>
  );

  return (
    <li className="flex items-start min-[801px]:hidden">
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        data-project-navigation="local"
        onClick={() => {
          onIntent();
          const url = new URL(window.location.href);
          url.searchParams.set("view", "latest");
          navigate(() => {
            window.history.replaceState(null, "", url);
            onSelect();
          }, url.href);
        }}
        className={className}
      >
        {contents}
      </button>
    </li>
  );
}

type AliasNavigation = {
  pendingHref: string | null;
  navigate: (route: string, onSelect?: () => void) => void;
};

function MenuOption({
  aliasNavigation,
  href,
  children,
  badge,
  forceInactive = false,
  onSelect,
}: PropsWithChildren<{
  aliasNavigation: AliasNavigation;
  href: string;
  badge?: string;
  forceInactive?: boolean;
  onSelect?: () => void;
}>) {
  const labelId = useId();
  const params = useParams<{ slug: string }>();
  const segment = useSelectedLayoutSegment();
  const isSelected = !forceInactive && (segment || "") === href;
  const slug = decodeProjectRouteSlug(params.slug) ?? params.slug;
  const isMutableHandle = slug.startsWith("@");
  const route = isMutableHandle && !href ? `/${slug}?view=overview` : `/${slug}/${href}`;
  const linkClassName = cn(
    // -mb-px drops the active border onto the row's persistent baseline.
    "-mb-px flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 pb-2 text-base font-medium uppercase transition-all sm:text-lg",
    {
      "text-black border-teal-500": isSelected,
      "text-zinc-500 hover:text-zinc-800 border-transparent": !isSelected,
    },
  );
  return (
    <li className="flex shrink-0 items-start gap-2">
      <Link
        href={route}
        aria-labelledby={labelId}
        aria-current={isSelected ? "page" : undefined}
        prefetch={isMutableHandle ? false : undefined}
        onNavigate={
          isMutableHandle
            ? (event) => {
                event.preventDefault();
                aliasNavigation.navigate(route, onSelect);
              }
            : undefined
        }
        onClick={isMutableHandle ? undefined : onSelect}
        className={linkClassName}
        data-project-navigation="client"
      >
        <MenuOptionContent
          labelId={labelId}
          aliasPending={aliasNavigation.pendingHref === route && !isSelected}
        >
          {children}
        </MenuOptionContent>
      </Link>
      {badge && (
        <span className="rounded-xl border border-teal-400 text-teal-500 font-medium text-[13px] px-2 py-1">
          {badge}
        </span>
      )}
    </li>
  );
}

function MenuOptionContent({
  labelId,
  aliasPending,
  children,
}: PropsWithChildren<{ labelId: string; aliasPending: boolean }>) {
  const { pending: linkPending } = useLinkStatus();
  const pending = aliasPending || linkPending;
  return (
    <>
      <span id={labelId} aria-busy={pending} className="inline-flex items-center gap-2">
        {children}
      </span>
      <span role="status" className="inline-flex size-3 shrink-0 items-center justify-center">
        {pending ? (
          <>
            <span aria-hidden="true" className="block size-2 rounded-full bg-teal-600" />
            <span className="sr-only">Loading section</span>
          </>
        ) : null}
      </span>
    </>
  );
}
