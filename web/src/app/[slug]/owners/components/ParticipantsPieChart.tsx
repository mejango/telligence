"use client";

import { EthereumAddress } from "@/components/EthereumAddress";
import type { ProjectTokenData } from "@/lib/nana/types";
import { formatPortion } from "@/lib/utils";
import { JBProjectToken } from "@bananapus/nana-sdk-core";
import { useMemo, useState } from "react";
import { Address } from "viem";
import type { ParticipantRow } from "./ParticipantsTable";

const OWNER_COLOR = "#EE6F3A"; // peel-400
const OWNER_HOVER_COLOR = "#BD4513"; // peel-600

function polarPoint(cx: number, cy: number, radius: number, angle: number) {
  return {
    x: (cx + Math.cos(angle) * radius).toFixed(3),
    y: (cy + Math.sin(angle) * radius).toFixed(3),
  };
}

/** A closed donut wedge whose separators are straight radial lines. */
export function donutSlicePath(start: number, end: number): string {
  const cx = 120;
  const cy = 112;
  const outer = 92;
  const inner = 54;
  const largeArc = end - start > Math.PI ? 1 : 0;
  const p1 = polarPoint(cx, cy, outer, start);
  const p2 = polarPoint(cx, cy, outer, end);
  const p3 = polarPoint(cx, cy, inner, end);
  const p4 = polarPoint(cx, cy, inner, start);
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${outer} ${outer} 0 ${largeArc} 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${inner} ${inner} 0 ${largeArc} 0 ${p4.x} ${p4.y}`,
    "Z",
  ].join(" ");
}

export function donutSliceRanges(balances: readonly bigint[]) {
  const total = balances.reduce((sum, balance) => sum + balance, 0n);
  if (total === 0n) return [];

  const drawable = balances
    .map((balance, index) => ({ balance, index }))
    .filter(({ balance }) => balance > 0n)
    .reverse();
  let angle = 0;
  return drawable.map(({ balance, index }) => {
    const share = Number((balance * 1_000_000_000_000n) / total) / 1_000_000_000_000;
    const start = angle;
    const end = angle + share * Math.PI * 2;
    angle = end;
    return { index, start, end };
  });
}

const OwnerTooltip = ({
  item,
  totalSupply,
}: {
  item: { address: Address; balance: JBProjectToken };
  totalSupply: bigint;
}) => {
  const portion = formatPortion(item.balance.value, totalSupply);

  return (
    <>
      <EthereumAddress address={item.address} short />
      <div className="text-zinc-500">
        {item.balance.format()} tokens ({portion}%)
      </div>
    </>
  );
};

export function ParticipantsPieChart({
  totalSupply,
  participants,
  showOwnerCount = false,
}: {
  token: ProjectTokenData | null | undefined;
  totalSupply: bigint;
  participants: ParticipantRow[];
  showOwnerCount?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // TODO maybe can remove this when balance=0 bug fixed in subgraph
  const totalBalance = useMemo(
    () => participants?.reduce((acc, participant) => acc + BigInt(participant?.balance), BigInt(0)),
    [participants],
  );

  const pieChartData = useMemo(() => {
    if (totalBalance === 0n) return [];
    const ranges = donutSliceRanges(participants.map((participant) => BigInt(participant.balance)));
    return ranges.map(({ index, start, end }) => {
      const participant = participants[index];
      const balance = new JBProjectToken(BigInt(participant?.balance));
      return {
        address: participant?.address as Address,
        balance,
        path:
          ranges.length === 1 ? donutSlicePath(0, Math.PI * 2 - 0.001) : donutSlicePath(start, end),
      };
    });
  }, [participants, totalBalance]);

  if (totalBalance === 0n) return null;

  const activeItem = activeIndex === null ? null : pieChartData[activeIndex];

  return (
    <div className="relative h-[240px] w-full sm:h-[360px]">
      <svg
        viewBox="0 0 240 224"
        role="img"
        aria-label={`Distribution of ${participants.length} owners`}
        className="h-full w-full"
      >
        {pieChartData.map((item, index) => (
          <path
            key={item.address}
            d={item.path}
            fill={index === activeIndex ? OWNER_HOVER_COLOR : OWNER_COLOR}
            stroke="white"
            strokeWidth="0.8"
            className="cursor-default transition-colors duration-150"
            onMouseEnter={() => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(null)}
          />
        ))}
      </svg>
      {activeItem ? (
        <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 border border-zinc-200 bg-white px-5 py-3 text-sm shadow-md">
          <OwnerTooltip item={activeItem} totalSupply={totalSupply} />
        </div>
      ) : null}
      {showOwnerCount ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-semibold leading-none text-black tabular-nums">
            {participants.length}
          </span>
          <span className="mt-2 text-sm uppercase text-melon-700">owners</span>
        </div>
      ) : null}
    </div>
  );
}
