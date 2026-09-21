import type { SVGProps } from "react";

/** The Telligence fig tree, shared by navigation and the social preview. */
export function TreeMark(props: SVGProps<SVGSVGElement>) {
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
        d="M22 31C14 34 5 31 5 25C0 22 3 13 10 13C11 6 20 4 24 9C28 3 39 4 40 10C46 11 48 19 45 23C48 28 43 34 37 32C33 35 27 35 22 31Z"
        fill="currentColor"
      />
      <path
        d="M22 31C22 25 18 21 13 20M22 31C25 22 31 15 37 12M22 31C28 29 35 28 42 27M22 31C20 28 14 27 9 26"
        stroke="#F6FEF9"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="16" cy="25" r="1.6" fill="#F6FEF9" />
      <circle cx="32" cy="19" r="1.6" fill="#F6FEF9" />
      <circle cx="37" cy="30" r="1.6" fill="#F6FEF9" />
      <path d="M8 46C14 43 17 38 19 29L25 29C23 37 21 42 21 46Z" fill="currentColor" />
    </svg>
  );
}
