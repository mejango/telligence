import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { format } from "prettier";

const root = fileURLToPath(new URL("../", import.meta.url));
const names = ["TelligenceFactory", "ProjectPolicy", "TelligenceComputeVault"];
const generated = path.join(root, "packages/contracts");
const frontend = path.join(root, "web/src/lib/telligence/generated");
await mkdir(generated, { recursive: true });
await mkdir(frontend, { recursive: true });
for (const name of names) {
  const artifact = JSON.parse(await readFile(path.join(root, `contracts/out/${name}.sol/${name}.json`), "utf8"));
  if (!Array.isArray(artifact.abi)) throw new Error(`Missing ABI: ${name}`);
  const json = JSON.stringify(artifact.abi, null, 2);
  await writeFile(path.join(generated, `${name}.json`), `${json}\n`);
  const typescript = await format(
    `// Generated from contracts/out by npm run abi:generate.\nexport const ${name}Abi = ${json} as const;\n`,
    { parser: "typescript", printWidth: 100, semi: true, quoteProps: "as-needed" },
  );
  await writeFile(path.join(frontend, `${name}.ts`), typescript);
}
console.log(`Generated ${names.length} contract ABIs for services and frontend.`);
