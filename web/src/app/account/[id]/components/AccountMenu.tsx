"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { useParams, useSelectedLayoutSegment } from "next/navigation";
import { PropsWithChildren } from "react";

/** The account page's tab bar — same route-segment idiom as ProjectMenu. */
export function AccountMenu() {
  return (
    <div className="touch-pan-x overflow-x-auto overflow-y-hidden overscroll-x-contain">
      <ul className="flex w-max min-w-full gap-4 border-b border-zinc-200 sm:gap-6">
        <MenuOption href="">Activity</MenuOption>
        <MenuOption href="holdings">Holdings</MenuOption>
        <MenuOption href="projects">Projects</MenuOption>
        <MenuOption href="roles">Roles</MenuOption>
      </ul>
    </div>
  );
}

function MenuOption({ href, children }: PropsWithChildren<{ href: string }>) {
  const params = useParams<{ id: string }>();
  const segment = useSelectedLayoutSegment();
  const isSelected = (segment || "") === href;

  return (
    <li className="flex items-start">
      <Link
        href={`/account/${decodeURIComponent(params.id)}/${href}`}
        aria-current={isSelected ? "page" : undefined}
        className={cn(
          // -mb-px drops the active border onto the row's persistent baseline.
          "-mb-px flex min-h-11 items-center whitespace-nowrap border-b-2 pb-2 text-base font-medium uppercase transition-all sm:text-lg",
          {
            "text-black border-teal-500": isSelected,
            "text-zinc-500 hover:text-zinc-800 border-transparent": !isSelected,
          },
        )}
      >
        {children}
      </Link>
    </li>
  );
}
