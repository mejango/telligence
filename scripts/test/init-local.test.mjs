import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { initializeLocalEnvironment } from "../init-local.mjs";

async function temporary(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "telligence-init-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function values(text) {
  return Object.fromEntries(text.split("\n").filter((line) => line && !line.startsWith("#")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1)];
  }));
}

test("local setup generates private independent credentials, and leaves deployment and model gates closed", async (t) => {
  const root = await temporary(t);
  await initializeLocalEnvironment(root);
  const filename = path.join(root, ".env");
  const config = values(await readFile(filename, "utf8"));
  assert.equal((await stat(filename)).mode & 0o777, 0o600);
  const secrets = ["POSTGRES_PASSWORD", "API_KEY_PEPPER", "AUTH_SIGNER_GATEWAY_SECRET", "AUTH_SIGNER_WORKER_SECRET"];
  for (const name of secrets) {
    assert.match(config[name], /^[A-Za-z0-9_-]{43}$/);
  }
  assert.equal(new Set(secrets.map((name) => config[name])).size, secrets.length);
  assert.equal(config.AUTH_SIGNER_SERVICE_SECRET, undefined, "each signer caller has its own credential");
  assert.equal(Buffer.from(config.SIGNER_ENCRYPTION_KEY, "base64").length, 32);
  assert.equal(config.SIGNER_ENCRYPTION_KEY, Buffer.from(config.SIGNER_ENCRYPTION_KEY, "base64").toString("base64"));
  assert.equal(config.MODEL_PRICES_JSON, "");
  assert.equal(config.MODEL_POLICY_JSON, "");
  assert.equal(config.TELLIGENCE_MANIFEST_FILE, "");
  assert.equal(config.NEXT_PUBLIC_SITE_URL, "http://localhost:3000");
  assert.equal(config.ALLOWED_WEB_ORIGINS, "http://localhost:3000,http://localhost:3002");
});

test("running local setup again never rotates credentials or overwrites operator configuration", async (t) => {
  const root = await temporary(t);
  await writeFile(path.join(root, ".env"), "existing configuration\n");
  await assert.rejects(initializeLocalEnvironment(root), { code: "EEXIST" });
  assert.equal(await readFile(path.join(root, ".env"), "utf8"), "existing configuration\n");
});

test("local setup cannot follow a symlink into an existing secret file", async (t) => {
  const root = await temporary(t);
  const target = path.join(root, "secret");
  await writeFile(target, "unchanged\n");
  await symlink(target, path.join(root, ".env"));
  await assert.rejects(initializeLocalEnvironment(root), { code: "EEXIST" });
  assert.equal(await readFile(target, "utf8"), "unchanged\n");
});
