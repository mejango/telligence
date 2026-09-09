import { cp } from "node:fs/promises";

// Next's standalone trace intentionally excludes static/public assets. Mirror
// the Docker runner composition so browser tests exercise the same filesystem
// layout that is promoted to production.
await cp("public", ".next/standalone/public", { force: true, recursive: true });
await cp(".next/static", ".next/standalone/.next/static", { force: true, recursive: true });

console.log("Staged public and static assets into the standalone runtime.");
