import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("../require-test-db.mjs", import.meta.url));
function run(value) {
  return spawnSync(process.execPath, [script], {
    env: { ...process.env, TEST_DATABASE_URL: value },
    encoding: "utf8",
  });
}

test("the database gate requires an explicit PostgreSQL database", () => {
  for (const value of ["", "https://localhost/test", "postgres://localhost/"]) {
    assert.equal(run(value).status, 1);
  }
  assert.equal(run("postgres://test_user@127.0.0.1:55442/telligence_test").status, 0);
});

test("invalid database configuration fails without echoing a possible credential", () => {
  const secret = "invalid connection with secret-never-print-123";
  const result = run(secret);
  assert.equal(result.status, 1);
  assert(!result.stdout.includes(secret));
  assert(!result.stderr.includes(secret));
});
