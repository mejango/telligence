import assert from "node:assert/strict";

// This verifies the empty local Compose stack, never a production deployment.
const origin = "http://127.0.0.1:8080";
for (const path of ["/healthz", "/readyz"]) {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, `${path} must be healthy`);
}
const config = await fetch(`${origin}/v1/config`).then((response) => response.json());
assert.equal(config.ready, false);
assert.equal(config.factoryAddress, null);
assert.equal(config.creationFee, null);
const projects = await fetch(`${origin}/v1/projects`).then((response) => response.json());
assert.deepEqual(projects.projects, []);
const inference = await fetch(`${origin}/api/v1/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model: "unconfigured", messages: [{ role: "user", content: "local smoke" }], max_tokens: 1 }),
  signal: AbortSignal.timeout(5000),
});
assert.equal(inference.status, 503);
process.stdout.write("Healthy local services; missing deployment, project data, and pricing remain unavailable.\n");
