import Link from "next/link";

type RevnetGuidePoint = string | { key: string; text: string };

type RevnetGuideCodePoint = {
  title: string;
  description?: string;
  code?: string;
  details?: readonly { key: string; value: string }[];
  links?: readonly { href: string; label: string }[];
};

type RevnetGuideAudience = "founders" | "frontend" | "contracts";

const AUDIENCE_LABEL: Record<RevnetGuideAudience, string> = {
  founders: "Project builders",
  frontend: "App builders",
  contracts: "Contract builders",
};

export type RevnetGuideSection = {
  id: string;
  /** Who the section is for. Omitted = everyone. */
  audience?: readonly RevnetGuideAudience[];
  /** Group label. A new value starts a part header in the body and the contents list. */
  part?: string;
  title: string;
  summary: string;
  paragraphs?: readonly string[];
  points?: readonly RevnetGuidePoint[];
  /** A visual sketch with a plain-language alternative for readers who cannot use it. */
  diagrams?: readonly { label: string; description?: string; lines: readonly string[] }[];
  /** Plain two-column reference rows, without the "code point" framing. */
  table?: { label: string; rows: readonly (readonly [string, string])[] };
  /** Side-by-side comparison: two named columns, one row per point. */
  compare?: {
    label: string;
    columns: readonly [string, string];
    rows: readonly (readonly [string, string])[];
  };
  codePoints?: readonly RevnetGuideCodePoint[];
  note?: string;
  links?: readonly { href: string; label: string }[];
};

type Props = {
  eyebrow: string;
  title: string;
  introduction: string;
  sections: readonly RevnetGuideSection[];
  companion: { href: string; label: string; description: string };
  afterIntroduction?: React.ReactNode;
  afterSections?: React.ReactNode;
};

function SectionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center py-2 underline decoration-melon-500 underline-offset-4 [overflow-wrap:anywhere] hover:text-melon-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-melon-700"
    >
      {label}
    </Link>
  );
}

function ContentsList({ sections }: { sections: readonly RevnetGuideSection[] }) {
  return (
    <ol className="space-y-1 text-sm leading-snug">
      {sections.map((section, index) => (
        <li key={section.id}>
          {section.part && section.part !== sections[index - 1]?.part ? (
            <p className="mb-1 mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-melon-700">
              {section.part}
            </p>
          ) : null}
          <a
            href={`#${section.id}`}
            className="grid min-h-11 grid-cols-[1.7rem_1fr] items-center gap-1 px-1 py-2 underline-offset-4 hover:bg-melon-100 hover:text-melon-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-melon-700"
          >
            <span aria-hidden="true" className="text-zinc-600">
              {index + 1}.
            </span>
            <span>{section.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

export function RevnetGuide({
  eyebrow,
  title,
  introduction,
  sections,
  companion,
  afterIntroduction,
  afterSections,
}: Props) {
  return (
    <div
      id="guide-content"
      tabIndex={-1}
      className="container scroll-mt-6 px-6 py-12 [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-melon-700 sm:px-8 sm:py-16"
    >
      <header className="max-w-[78ch]">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-melon-700">
          {eyebrow}
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">{title}</h1>
        <p className="mt-6 text-lg leading-relaxed text-zinc-700 sm:text-xl">{introduction}</p>
        {afterIntroduction ? <div className="mt-6 space-y-3">{afterIntroduction}</div> : null}
      </header>

      <div className="mt-12 grid gap-10 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
        <div
          id="guide-contents"
          tabIndex={-1}
          className="scroll-mt-6 border border-melon-200 bg-melon-50 p-5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-melon-700 lg:sticky lg:top-6"
        >
          <nav aria-label={`${eyebrow} contents`} className="lg:hidden">
            <details>
              <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-melon-700">
                Contents · {sections.length} sections
              </summary>
              <ContentsList sections={sections} />
            </details>
          </nav>
          <nav
            aria-label={`${eyebrow} contents`}
            className="hidden max-h-[calc(100dvh-5.5rem)] overflow-y-auto p-1 lg:block"
          >
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-600">
              Contents
            </h2>
            {sections[0] ? (
              <a
                href={`#${sections[0].id}`}
                className="mt-2 inline-flex min-h-11 items-center text-sm underline underline-offset-4 hover:text-melon-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-melon-700"
              >
                Skip contents and start reading
              </a>
            ) : null}
            <ContentsList sections={sections} />
          </nav>
        </div>

        <div className="min-w-0">
          {sections.map((section, index) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-title`}
              tabIndex={-1}
              className="scroll-mt-6 border-t border-melon-200 py-10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-melon-700 first:border-t-0 first:pt-0"
            >
              {section.part && section.part !== sections[index - 1]?.part ? (
                <p className="mb-6 text-sm font-semibold uppercase tracking-[0.16em] text-melon-700">
                  {section.part}
                </p>
              ) : null}
              <div className="flex items-start gap-4">
                <span
                  aria-hidden="true"
                  className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center border border-melon-300 bg-melon-100 text-sm font-semibold text-melon-800"
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <h2 id={`${section.id}-title`} className="text-2xl font-semibold sm:text-3xl">
                    <a
                      href={`#${section.id}`}
                      className="group inline-block py-1 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-melon-700"
                    >
                      {section.title}{" "}
                      <span aria-hidden="true" className="text-melon-700">
                        #
                      </span>
                    </a>
                  </h2>
                  {section.audience?.length ? (
                    <p className="mt-2 flex flex-wrap gap-2">
                      {section.audience.map((audience) => (
                        <span
                          key={audience}
                          className="border border-melon-300 bg-melon-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.08em] text-melon-800"
                        >
                          {AUDIENCE_LABEL[audience]}
                        </span>
                      ))}
                    </p>
                  ) : null}
                  <p className="mt-3 text-lg leading-relaxed text-zinc-700">{section.summary}</p>
                </div>
              </div>

              <div className="ml-0 mt-6 space-y-5 text-base leading-relaxed text-zinc-700 sm:ml-12 sm:text-lg">
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}

                {section.points?.length ? (
                  <ul className="ml-6 list-outside list-square space-y-3 marker:text-melon-600">
                    {section.points.map((point) => (
                      <li key={typeof point === "string" ? point : point.key} className="pl-1">
                        {typeof point === "string" ? (
                          point
                        ) : (
                          <>
                            <strong className="font-semibold text-zinc-900">{point.key}:</strong>{" "}
                            {point.text}
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {section.diagrams?.map((diagram, diagramIndex) => (
                  <figure key={diagram.label} className="border border-melon-300 bg-melon-50">
                    <figcaption className="border-b border-melon-200 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-melon-700">
                      {diagram.label}
                    </figcaption>
                    {diagram.description ? (
                      <p
                        id={`${section.id}-diagram-${diagramIndex}-description`}
                        className="px-4 pt-4 text-base leading-relaxed text-zinc-800"
                      >
                        {diagram.description}
                      </p>
                    ) : null}
                    <div
                      role="region"
                      aria-label={`${diagram.label}: scrollable diagram`}
                      aria-describedby={
                        diagram.description
                          ? `${section.id}-diagram-${diagramIndex}-description`
                          : undefined
                      }
                      tabIndex={0}
                      className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-melon-700"
                    >
                      <pre
                        aria-hidden={diagram.description ? true : undefined}
                        className="p-4 font-mono text-sm leading-6 text-zinc-800"
                      >
                        {diagram.lines.join("\n")}
                      </pre>
                    </div>
                  </figure>
                ))}

                {section.compare ? (
                  <div className="border border-melon-300">
                    <table className="w-full table-fixed border-collapse text-left text-sm sm:text-base">
                      <caption className="border-b border-melon-200 bg-melon-50 px-4 py-2 text-left text-xs font-semibold uppercase tracking-[0.14em] text-melon-700">
                        {section.compare.label}
                      </caption>
                      <thead>
                        <tr>
                          {section.compare.columns.map((column) => (
                            <th
                              key={column}
                              scope="col"
                              className="border-b border-melon-200 px-3 py-3 align-top font-semibold text-zinc-900 first:border-r sm:px-4"
                            >
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {section.compare.rows.map(([left, right]) => (
                          <tr key={left} className="border-b border-melon-200 last:border-b-0">
                            <td className="border-r border-melon-200 px-3 py-3 align-top text-zinc-700 sm:px-4">
                              {left}
                            </td>
                            <td className="px-3 py-3 align-top text-zinc-700 sm:px-4">{right}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {section.table ? (
                  <div className="border border-melon-300">
                    <h3
                      id={`${section.id}-reference`}
                      className="border-b border-melon-200 bg-melon-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-melon-700"
                    >
                      {section.table.label}
                    </h3>
                    <dl
                      aria-labelledby={`${section.id}-reference`}
                      className="text-sm sm:text-base"
                    >
                      {section.table.rows.map(([key, value]) => (
                        <div
                          key={key}
                          className="grid border-b border-melon-200 last:border-b-0 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
                        >
                          <dt className="px-4 pb-1 pt-3 font-mono text-sm font-semibold text-zinc-900 sm:border-r sm:border-melon-200 sm:py-3">
                            {key}
                          </dt>
                          <dd className="px-4 pb-3 pt-1 text-zinc-700 sm:py-3">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ) : null}

                {section.codePoints?.length ? (
                  <div className="space-y-5">
                    {section.codePoints.map((codePoint) => (
                      <article
                        key={codePoint.title}
                        className="border border-melon-300 bg-melon-50 p-4 sm:p-5"
                      >
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-melon-700">
                          Code point
                        </p>
                        <h3 className="mt-2 text-lg font-semibold text-zinc-900 sm:text-xl">
                          {codePoint.title}
                        </h3>
                        {codePoint.description ? (
                          <p className="mt-2 text-base leading-relaxed text-zinc-700">
                            {codePoint.description}
                          </p>
                        ) : null}

                        {codePoint.details?.length ? (
                          <dl className="mt-4 border border-melon-200 bg-white text-sm sm:text-base">
                            {codePoint.details.map((detail) => (
                              <div
                                key={detail.key}
                                className="grid border-b border-melon-200 last:border-b-0 sm:grid-cols-[9rem_minmax(0,1fr)]"
                              >
                                <dt className="px-3 pb-1 pt-3 font-semibold text-zinc-900 sm:border-r sm:border-melon-200 sm:py-3">
                                  {detail.key}
                                </dt>
                                <dd className="px-3 pb-3 pt-1 font-mono text-sm text-zinc-700 sm:py-3">
                                  {detail.value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        ) : null}

                        {codePoint.code ? (
                          <pre
                            role="region"
                            aria-label={`${codePoint.title}: code example`}
                            className="mt-4 overflow-x-auto border border-black bg-zinc-900 p-4 text-sm leading-6 text-melon-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-melon-700"
                            tabIndex={0}
                          >
                            <code>{codePoint.code}</code>
                          </pre>
                        ) : null}

                        {codePoint.links?.length ? (
                          <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                            {codePoint.links.map((link) => (
                              <SectionLink key={link.href} href={link.href} label={link.label} />
                            ))}
                          </p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : null}

                {section.note ? (
                  <div className="border-l-4 border-peel-400 bg-peel-50 px-5 py-4 text-zinc-800">
                    {section.note}
                  </div>
                ) : null}

                {section.links?.length ? (
                  <p className="flex flex-wrap gap-x-5 gap-y-2 text-base">
                    {section.links.map((link) => (
                      <SectionLink key={link.href} href={link.href} label={link.label} />
                    ))}
                  </p>
                ) : null}

                <a
                  href="#guide-contents"
                  className="inline-flex min-h-11 items-center py-2 text-sm text-zinc-600 underline underline-offset-4 hover:text-melon-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-melon-700"
                >
                  Back to contents
                </a>
              </div>
            </section>
          ))}

          {afterSections ? (
            <div className="border-t border-melon-200 pt-8">{afterSections}</div>
          ) : null}

          <aside className="mt-10 border border-melon-300 bg-melon-50 p-6 sm:p-8">
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-melon-700">
              Keep going
            </p>
            <h2 className="mt-2 text-2xl font-semibold">
              <Link
                href={companion.href}
                className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-melon-700"
              >
                {companion.label}
              </Link>
            </h2>
            <p className="mt-3 leading-relaxed text-zinc-700">{companion.description}</p>
          </aside>
        </div>
      </div>
    </div>
  );
}
