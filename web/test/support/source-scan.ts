import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import ts from "typescript";

/*
 * The one walker and parser the source-scanning tests share: which files they
 * read, how a file is parsed, and which nodes carry text a reader sees.
 */

/** A TypeScript file name: .ts or .tsx. */
const isTypeScript = (name: string) => [".ts", ".tsx"].includes(extname(name));

/** Any file that can hold code: TypeScript or JavaScript, any module flavour, with or without JSX. */
export const isScript = (name: string) => /\.[cm]?[jt]sx?$/u.test(name);

/** Every file below `directory` whose name `accepts`, in directory order. */
export function sourceFiles(
  directory: string,
  accepts: (name: string) => boolean = isTypeScript,
): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, accepts);
    return accepts(entry.name) ? [path] : [];
  });
}

const SCRIPT_KINDS: Record<string, ts.ScriptKind> = {
  ".tsx": ts.ScriptKind.TSX,
  ".jsx": ts.ScriptKind.JSX,
  ".js": ts.ScriptKind.JS,
  ".mjs": ts.ScriptKind.JS,
  ".cjs": ts.ScriptKind.JS,
};

/** A file parsed with parent links, in the script kind its extension names. */
export function parseSource(file: string, text = readFileSync(file, "utf8")): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    SCRIPT_KINDS[extname(file)] ?? ts.ScriptKind.TS,
  );
}

/** A node whose text a reader can see: a string, template text or JSX text. */
export type TextNode =
  | ts.StringLiteral
  | ts.NoSubstitutionTemplateLiteral
  | ts.TemplateHead
  | ts.TemplateMiddle
  | ts.TemplateTail
  | ts.JsxText;

export function isTextNode(node: ts.Node): node is TextNode {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node) ||
    ts.isJsxText(node)
  );
}

/** The 1-based line a node starts on. */
export function lineOf(node: ts.Node, source: ts.SourceFile): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** A dot separator or an em dash in copy, and where it is. */
export type Mark = { line: number; mark: "·" | "—"; text: string };

export type MarkRules = {
  /**
   * A lone "—" standing for "no value": "allowed" in app copy (ruling R111),
   * "refused" in a confirm, which states every value the user agrees to.
   */
  placeholder: "allowed" | "refused";
};

/**
 * Whether a file's text could spell a mark: a written mark, any escape a string
 * could hold, or any entity JSX could hold. It errs toward parsing: every
 * spelling of a mark passes it, and the parse decides.
 */
export function couldSpellMark(text: string): boolean {
  return /[·—]|\\[ux]|&[#A-Za-z]/u.test(text);
}

const MARK_ENTITIES: Record<string, string> = {
  mdash: "—",
  middot: "·",
  centerdot: "·",
  CenterDot: "·",
};

/**
 * JSX text or a JSX attribute string as it renders. JSX decodes HTML entities
 * there, and no JavaScript escapes: every numeric entity, and each named one
 * that spells a mark, is decoded.
 */
function decodeJsxEntities(text: string): string {
  return text.replace(
    /&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|([A-Za-z]+));/gu,
    (entity: string, hex?: string, decimal?: string, name?: string) => {
      if (name !== undefined) return MARK_ENTITIES[name] ?? entity;
      const code = hex !== undefined ? Number.parseInt(hex, 16) : Number.parseInt(decimal!, 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    },
  );
}

/** The text a node renders: JSX text and JSX attribute strings with their entities decoded. */
function renderedText(node: TextNode): string {
  const jsx = ts.isJsxText(node) || (ts.isStringLiteral(node) && ts.isJsxAttribute(node.parent));
  return jsx ? decodeJsxEntities(node.text) : node.text;
}

/** Every dot separator and em dash in the text below `root`, under `rules`. */
export function copyMarks(root: ts.Node, source: ts.SourceFile, rules: MarkRules): Mark[] {
  const found: Mark[] = [];
  const visit = (node: ts.Node) => {
    if (isTextNode(node)) {
      const text = renderedText(node);
      const placeholder =
        rules.placeholder === "allowed" && (ts.isJsxText(node) ? text.trim() : text) === "—";
      if (!placeholder) {
        for (const mark of ["·", "—"] as const) {
          if (text.includes(mark))
            found.push({ line: lineOf(node, source), mark, text: text.trim() });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}
