import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { provingTitleWords } from "./lib/test-titles.mjs";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "test/fixtures/wallet-write-sites.json");
const testingPath = resolve(root, "TESTING.md");
const sourceRoot = resolve(root, "src");

const reviewedHookModules = {
  "@/hooks/useReviewedCreatorSignature": {
    useReviewedCreatorSignature: {
      hookKind: "reviewed-creator-signature-hook",
      bindings: { signCreatorMessageAsync: "reviewed-creator-signature" },
    },
  },
  "@/hooks/useMultichainBatch": {
    useMultichainBatch: {
      hookKind: "reviewed-multichain-hook",
      bindings: { runBatch: "reviewed-multichain-batch" },
    },
  },
  "@/hooks/useReviewedAction": {
    useReviewedAction: {
      hookKind: "reviewed-action-hook",
      bindings: { run: "reviewed-action" },
    },
    useSafeTransactionSignature: {
      hookKind: "reviewed-safe-signature-hook",
      bindings: { signSafeTransactionAsync: "reviewed-safe-signature" },
    },
  },
  "@/hooks/useReviewedRelayr": {
    useGetRelayrTxQuote: {
      hookKind: "reviewed-relayr-quote-hook",
      bindings: { getRelayrTxQuote: "reviewed-relayr-quote" },
    },
    useSendRelayrTx: {
      hookKind: "reviewed-relayr-payment-hook",
      bindings: { sendRelayrTx: "reviewed-relayr-payment" },
    },
  },
};

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

function bindingName(node) {
  return ts.isIdentifier(node) ? node.text : undefined;
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function ownerOf(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (ts.isMethodDeclaration(current) && current.name)
      return propertyName(current.name) ?? "<method>";
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      if (ts.isVariableDeclaration(current.parent)) {
        const name = bindingName(current.parent.name);
        if (name) return name;
      }
      if (ts.isCallExpression(current.parent) && ts.isVariableDeclaration(current.parent.parent)) {
        const name = bindingName(current.parent.parent.name);
        if (name) return name;
      }
      if (ts.isPropertyAssignment(current.parent)) {
        return propertyName(current.parent.name) ?? "<property>";
      }
    }
  }
  return "<module>";
}

function aggregate(sites) {
  const grouped = new Map();
  for (const site of sites) {
    const key = JSON.stringify(site);
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  return [...grouped.entries()]
    .map(([key, count]) => {
      const site = JSON.parse(key);
      return {
        kind: site.kind,
        file: site.file,
        owner: site.owner,
        callee: site.callee,
        count,
      };
    })
    .sort((a, b) =>
      [a.file, a.owner, a.kind, a.callee]
        .join(":")
        .localeCompare([b.file, b.owner, b.kind, b.callee].join(":")),
    );
}

const discovered = [];

for (const path of sourceFiles(sourceRoot).sort()) {
  const file = relative(root, path).replaceAll("\\", "/");
  const source = ts.createSourceFile(
    file,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    extname(path) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hookImports = new Map();
  const callableBindings = new Map();

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const moduleName = statement.moduleSpecifier.text;
    const imports = statement.importClause?.namedBindings;
    if (!imports || !ts.isNamedImports(imports)) continue;

    for (const element of imports.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      const local = element.name.text;
      const reviewed = reviewedHookModules[moduleName]?.[imported];
      if (reviewed) hookImports.set(local, { ...reviewed, callee: imported });
    }
  }

  function collectBindings(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression)
    ) {
      const hook = hookImports.get(node.initializer.expression.text);
      if (hook) {
        for (const element of node.name.elements) {
          const property = propertyName(element.propertyName ?? element.name);
          const local = bindingName(element.name);
          const kind = property ? hook.bindings[property] : undefined;
          if (property && local && kind) callableBindings.set(local, { kind, callee: property });
        }
      }
    }
    ts.forEachChild(node, collectBindings);
  }
  collectBindings(source);

  function collectCalls(node) {
    if (ts.isCallExpression(node)) {
      let site;
      if (ts.isIdentifier(node.expression)) {
        const local = node.expression.text;
        const hook = hookImports.get(local);
        const binding = callableBindings.get(local);
        if (hook) {
          site = { kind: hook.hookKind, file, owner: ownerOf(node), callee: hook.callee };
        } else if (binding) {
          site = { ...binding, file, owner: ownerOf(node) };
        } else if (local === "writeContract" || local === "writeContractAsync") {
          site = { kind: "reviewed-write", file, owner: ownerOf(node), callee: local };
        } else if (local === "getRelayrTxQuote") {
          site = { kind: "reviewed-relayr-quote", file, owner: ownerOf(node), callee: local };
        } else if (local === "sendRelayrTx") {
          site = { kind: "reviewed-relayr-payment", file, owner: ownerOf(node), callee: local };
        }
      }

      if (site) discovered.push(site);
    }
    ts.forEachChild(node, collectCalls);
  }
  collectCalls(source);
}

const actualSites = aggregate(discovered);
if (process.argv.includes("--print")) {
  console.log(JSON.stringify(actualSites, null, 2));
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.format !== "revnet-wallet-write-sites-1") {
  throw new Error(`Unsupported wallet-write manifest format in ${manifestPath}`);
}

const expectedSites = manifest.surfaces
  .flatMap((surface) =>
    surface.sites.map((site) => {
      if (!Array.isArray(site) || site.length !== 5) {
        throw new Error(`Wallet-write surface ${surface.id} has an invalid site tuple`);
      }
      const [kind, file, owner, callee, count] = site;
      return { kind, file, owner, callee, count };
    }),
  )
  .sort((a, b) =>
    [a.file, a.owner, a.kind, a.callee]
      .join(":")
      .localeCompare([b.file, b.owner, b.kind, b.callee].join(":")),
  );
const docs = readFileSync(testingPath, "utf8");
for (const surface of manifest.surfaces) {
  if (!docs.includes(`wallet-inventory:${surface.id}`)) {
    throw new Error(`TESTING.md is missing wallet-inventory:${surface.id}`);
  }
  if (!surface.sites.length) {
    throw new Error(`Wallet-write surface ${surface.id} has no inventoried sites`);
  }
}

// Every wallet site must also belong to exactly one action. Money-moving and
// project-control actions list the tests that prove them, and each listed test
// file carries the action's marker where TESTING.md says one counts.
if (!Array.isArray(manifest.actions) || !manifest.actions.length) {
  throw new Error(`Wallet-write manifest ${manifestPath} has no action coverage map`);
}
const actionIds = new Set();
const titleWordsOfTest = new Map();
/** The words of the titles in a test file that can prove an action; a file is read once. */
function titleWords(testPath) {
  if (!titleWordsOfTest.has(testPath)) {
    const text = readFileSync(resolve(root, testPath), "utf8");
    titleWordsOfTest.set(testPath, provingTitleWords(text, testPath));
  }
  return titleWordsOfTest.get(testPath);
}
for (const action of manifest.actions) {
  if (typeof action.id !== "string" || actionIds.has(action.id)) {
    throw new Error(`Wallet-write action IDs must be unique non-empty strings`);
  }
  actionIds.add(action.id);
  if (!["boundary", "money", "project-control"].includes(action.risk)) {
    throw new Error(`Wallet-write action ${action.id} has an invalid risk classification`);
  }
  if (!Array.isArray(action.files) || !action.files.length) {
    throw new Error(`Wallet-write action ${action.id} has no site files`);
  }
  if (!Array.isArray(action.tests) || !action.tests.length) {
    throw new Error(`Wallet-write action ${action.id} has no test references`);
  }
  for (const testPath of action.tests) {
    const absoluteTestPath = resolve(root, testPath);
    if (!existsSync(absoluteTestPath)) {
      throw new Error(`Wallet-write action ${action.id} references missing test ${testPath}`);
    }
    if (action.risk !== "boundary" && !titleWords(testPath).has(`wallet-action:${action.id}`)) {
      throw new Error(
        `Wallet-write action ${action.id} needs the marker wallet-action:${action.id} in the title of a test in ${testPath} that runs and proves it (see TESTING.md)`,
      );
    }
  }
}

for (const site of actualSites) {
  const matchingActions = manifest.actions.filter((action) => action.files.includes(site.file));
  if (matchingActions.length !== 1) {
    throw new Error(
      `${site.file}:${site.owner} (${site.kind}/${site.callee}) must map to exactly one wallet action; matched ${matchingActions.map((action) => action.id).join(", ") || "none"}`,
    );
  }
}
for (const action of manifest.actions) {
  if (!actualSites.some((site) => action.files.includes(site.file))) {
    throw new Error(`Wallet-write action ${action.id} does not match an inventoried site`);
  }
}

const actualJson = JSON.stringify(actualSites, null, 2);
const expectedJson = JSON.stringify(expectedSites, null, 2);
const failures = [];
if (actualJson !== expectedJson) {
  failures.push(
    `Wallet-write sites changed. Review the change, update ${relative(root, manifestPath)}, and keep TESTING.md in sync.\nExpected:\n${expectedJson}\nActual:\n${actualJson}`,
  );
}
if (failures.length) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log(
  `Verified ${actualSites.reduce((sum, site) => sum + site.count, 0)} wallet boundary call sites across ${manifest.surfaces.length} documented surfaces and ${manifest.actions.length} test-referenced actions.`,
);
