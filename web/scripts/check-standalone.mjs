import { access, readFile } from "node:fs/promises";

const required = [
  ".next/standalone/server.js",
  ".next/standalone/.next/server/app/api/healthz/route.js",
];

await Promise.all(required.map((path) => access(path)));

const server = await readFile(required[0], "utf8");
if (!server.includes("process.env.PORT") || !server.includes("process.env.HOSTNAME")) {
  throw new Error("Standalone server does not expose configurable PORT and HOSTNAME bindings");
}

console.log(`Standalone deployment contains ${required.length} required runtime artifacts.`);
