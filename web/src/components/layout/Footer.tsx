import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-melon-300">
      <div className="compute-container flex flex-col justify-between gap-8 py-10 sm:flex-row sm:items-start">
        <div>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center text-xl font-bold tracking-[-0.06em]"
          >
            telligence
          </Link>
        </div>
        <div className="text-xs leading-7 text-melon-700">
          <p>Built on open foundations.</p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            <a
              href="https://github.com/Bananapus/version-6"
              target="_blank"
              rel="noopener noreferrer"
              className="compute-text-link inline-flex min-h-11 items-center"
            >
              Juicebox V6 ↗
            </a>
            <a
              href="https://revnet.money"
              target="_blank"
              rel="noopener noreferrer"
              className="compute-text-link inline-flex min-h-11 items-center"
            >
              Revnets ↗
            </a>
            <a
              href="https://docs.venice.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="compute-text-link inline-flex min-h-11 items-center"
            >
              Venice ↗
            </a>
            <Link
              href="/how-it-works"
              className="compute-text-link inline-flex min-h-11 items-center"
            >
              How it works
            </Link>
          </div>
          <Link href="/recover" className="compute-text-link inline-flex min-h-11 items-center">
            Recover backing directly on Base ↗
          </Link>
          <p className="mt-2 max-w-[55ch]">
            Funding terms, compute capacity, and recovery are open to inspect.
          </p>
        </div>
      </div>
    </footer>
  );
}
