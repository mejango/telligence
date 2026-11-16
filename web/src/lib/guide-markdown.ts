import {
  AUDIENCE_LABEL,
  INLINE_LINK,
  type RevnetGuideContent,
  type RevnetGuideSection,
} from "@/components/guides/RevnetGuide";

const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002";

type Link = { href: string; label: string };

const blocks = (...parts: (string | false | 0 | null | undefined)[]) =>
  parts.filter((part): part is string => Boolean(part));
const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", "<br>");
const row = (cells: readonly string[]) => `| ${cells.map(cell).join(" | ")} |`;
const table = (head: readonly string[], rows: readonly (readonly string[])[]) =>
  [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");
const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``;

function sectionMarkdown(
  section: RevnetGuideSection,
  absolute: (href: string) => string,
): string[] {
  const inline = (text: string) =>
    text.replace(INLINE_LINK, (_, label: string, href: string) => `[${label}](${absolute(href)})`);
  const linkList = (links?: readonly Link[]) =>
    links?.length && links.map((link) => `- [${link.label}](${absolute(link.href)})`).join("\n");
  const diagrams = (section.diagrams ?? []).flatMap((diagram) =>
    blocks(`**${diagram.label}**`, diagram.description, fence("text", diagram.lines.join("\n"))),
  );

  return blocks(
    `## ${section.title} {#${section.id}}`,
    section.audience?.length &&
      `For: ${section.audience.map((audience) => AUDIENCE_LABEL[audience]).join(", ")}`,
    inline(section.summary),
    ...(section.diagramsFirst ? diagrams : []),
    ...(section.paragraphs ?? []).map(inline),
    section.points
      ?.map((point) =>
        typeof point === "string"
          ? `- ${inline(point)}`
          : `- **${point.key}:** ${inline(point.text)}`,
      )
      .join("\n"),
    section.steps?.map((step, index) => `${index + 1}. ${inline(step)}`).join("\n"),
    ...(section.diagramsFirst ? [] : diagrams),
    ...(section.compare
      ? blocks(
          `**${section.compare.label}**`,
          section.compare.lead,
          table(section.compare.columns, section.compare.rows),
          section.compare.footer,
        )
      : []),
    // The page's reference rows have no column headings, so the label heads the first column.
    ...[section.table ?? []].flat().map((reference) =>
      table(
        [reference.label, ""],
        reference.rows.map(([key, value]) => [key, inline(value)]),
      ),
    ),
    ...(section.codePoints ?? []).flatMap((codePoint) =>
      blocks(
        `### ${codePoint.title}`,
        codePoint.description && inline(codePoint.description),
        codePoint.details?.map((detail) => `- **${detail.key}:** ${detail.value}`).join("\n"),
        codePoint.code && fence(codePoint.lang ?? "text", codePoint.code),
        linkList(codePoint.links),
      ),
    ),
    section.note && `> ${inline(section.note)}`,
    linkList(section.links),
  );
}

/** A guide as markdown for agents, from the same data its page at `path` renders. */
export function guideMarkdown(guide: RevnetGuideContent, path: string): string {
  const absolute = (href: string) =>
    href.startsWith("#")
      ? `${siteOrigin}${path}${href}`
      : href.startsWith("/")
        ? `${siteOrigin}${href}`
        : href;
  return (
    blocks(
      `# ${guide.title}`,
      guide.introduction,
      `Web page: ${siteOrigin}${path}`,
      ...guide.sections.flatMap((section, index) =>
        blocks(
          section.part && section.part !== guide.sections[index - 1]?.part && `**${section.part}**`,
          ...sectionMarkdown(section, absolute),
        ),
      ),
      `Next: [${guide.companion.label}](${absolute(guide.companion.href)}). ${guide.companion.description}`,
    ).join("\n\n") + "\n"
  );
}

/** Same content type and cache as /skill.md. The route still exports its own `revalidate`. */
export function guideMarkdownResponse(guide: RevnetGuideContent, path: string): Response {
  return new Response(guideMarkdown(guide, path), {
    headers: {
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
      "content-type": "text/markdown; charset=utf-8",
    },
  });
}
