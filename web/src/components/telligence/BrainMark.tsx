import type { SVGProps } from "react";

/** The Telligence brain, shared by navigation and the social preview. */
export function BrainMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="32"
      height="32"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path
        d="M24 9C21 3 13 4 11 10C5 10 2 17 6 22C1 26 4 34 10 35C10 42 20 44 24 38C28 44 38 42 38 35C44 34 47 26 42 22C46 17 43 10 37 10C35 4 27 3 24 9Z"
        fill="currentColor"
      />
      <path
        d="M24 9V38M11 10C10 15 13 18 17 18M6 22C10 20 15 23 14 28M10 35C14 36 18 33 18 29M37 10C38 15 35 18 31 18M42 22C38 20 33 23 34 28M38 35C34 36 30 33 30 29"
        stroke="#F6FEF9"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
