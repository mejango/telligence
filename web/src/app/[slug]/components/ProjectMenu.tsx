"use client";

import { decodeProjectRouteSlug } from "@/lib/slug";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useParams, useSelectedLayoutSegment } from "next/navigation";
import { PropsWithChildren, useState } from "react";
import { ProjectOverflowIcon, ProjectTabIcon } from "./ProjectTabIcon";

export function ProjectMenu({
  mobileActivityActive = false,
  onMobileActivityChange,
}: {
  mobileActivityActive?: boolean;
  onMobileActivityChange?: (active: boolean) => void;
}) {
  const [overflowExpanded, setOverflowExpanded] = useState(false);

  return (
    <div className="flex border-b border-zinc-200">
      <ul
        data-project-tab-scroll
        className="scrollbar-none flex min-w-0 flex-1 touch-pan-x gap-4 overflow-x-auto overflow-y-hidden overscroll-x-contain sm:gap-6"
      >
        <MobileActivityOption
          active={mobileActivityActive}
          onSelect={() => onMobileActivityChange?.(true)}
        />
        <MenuOption
          href=""
          forceInactive={mobileActivityActive}
          onSelect={() => onMobileActivityChange?.(false)}
        >
          <ProjectTabIcon label="Overview" />
          Overview
        </MenuOption>
        <MenuOption
          href="terms"
          forceInactive={mobileActivityActive}
          onSelect={() => onMobileActivityChange?.(false)}
        >
          <ProjectTabIcon label="Terms" />
          Terms
        </MenuOption>
        <MenuOption
          href="owners"
          forceInactive={mobileActivityActive}
          onSelect={() => onMobileActivityChange?.(false)}
        >
          <ProjectTabIcon label="Owners" />
          Owners
        </MenuOption>
        <MenuOption
          href="shop"
          forceInactive={mobileActivityActive}
          onSelect={() => onMobileActivityChange?.(false)}
        >
          <ProjectTabIcon label="Shop" />
          Shop
        </MenuOption>
        {overflowExpanded ? (
          <>
            <MenuOption
              href="extras"
              forceInactive={mobileActivityActive}
              onSelect={() => onMobileActivityChange?.(false)}
            >
              <ProjectTabIcon label="Extras" />
              Extras
            </MenuOption>
            <MenuOption
              href="operator"
              forceInactive={mobileActivityActive}
              onSelect={() => onMobileActivityChange?.(false)}
            >
              <ProjectTabIcon label="Operator" />
              Operator
            </MenuOption>
          </>
        ) : null}
        <li className="flex shrink-0 items-start">
          <MoreProjectOptions
            forceInactive={mobileActivityActive}
            expanded={overflowExpanded}
            onToggle={() => setOverflowExpanded((current) => !current)}
          />
        </li>
      </ul>
    </div>
  );
}

function MoreProjectOptions({
  forceInactive,
  expanded,
  onToggle,
}: {
  forceInactive: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const segment = useSelectedLayoutSegment();
  const options = [
    { href: "extras", label: "Extras" },
    { href: "operator", label: "Operator" },
  ];
  const active = forceInactive ? undefined : options.find((option) => option.href === segment);

  return (
    <button
      type="button"
      aria-label={`More project sections${active ? `, current: ${active.label}` : ""}`}
      aria-expanded={expanded}
      onClick={onToggle}
      className={cn(
        "-mb-px flex min-h-11 min-w-11 shrink-0 items-center justify-center border-b-2 px-3 pb-2 text-2xl leading-none transition-all",
        active && !expanded
          ? "border-teal-500 text-black"
          : "border-transparent text-zinc-500 hover:text-zinc-800",
      )}
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

function MobileActivityOption({ active, onSelect }: { active: boolean; onSelect: () => void }) {
  const params = useParams<{ slug: string }>();
  const slug = decodeProjectRouteSlug(params.slug) ?? params.slug;
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
      {slug.startsWith("@") ? (
        <a
          href={`/${slug}`}
          onClick={onSelect}
          className={className}
          data-project-navigation="document"
        >
          {contents}
        </a>
      ) : (
        <button type="button" onClick={onSelect} className={className}>
          {contents}
        </button>
      )}
    </li>
  );
}

function MenuOption({
  href,
  children,
  badge,
  forceInactive = false,
  onSelect,
}: PropsWithChildren<{
  href: string;
  badge?: string;
  forceInactive?: boolean;
  onSelect?: () => void;
}>) {
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
      {isMutableHandle ? (
        // A handle can be rebound while this layout is mounted. Native
        // navigation forces the server to rebuild providers for its new pair.
        <a
          href={route}
          onClick={onSelect}
          className={linkClassName}
          data-project-navigation="document"
        >
          {children}
        </a>
      ) : (
        <Link
          href={route}
          onClick={onSelect}
          className={linkClassName}
          data-project-navigation="client"
        >
          {children}
        </Link>
      )}
      {badge && (
        <span className="rounded-xl border border-teal-400 text-teal-500 font-medium text-[13px] px-2 py-1">
          {badge}
        </span>
      )}
    </li>
  );
}
