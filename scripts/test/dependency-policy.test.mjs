import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("npm 12 Git resolution is confined to four explicit immutable Solidity dependencies", async () => {
  const manifest = JSON.parse(await read("contracts/package.json"));
  const lock = JSON.parse(await read("contracts/package-lock.json"));
  const pins = {
    "@uniswap/permit2": "Uniswap/permit2#cc56ad0f3439c502c246fc5cfcc3db92bb8b7219",
    "@uniswap/v3-core": "Uniswap/v3-core#6562c52e8f75f0c10f9deaf44861847585fc8129",
    "@uniswap/v3-periphery": "Uniswap/v3-periphery#b325bb0905d922ae61fcc7df85ee802e8df5e96c",
    "@zksync/contracts": "matter-labs/era-contracts#446d391d34bdb48255d5f8fef8a8248925fc98b9",
  };
  const gitEntries = Object.entries(lock.packages).filter(([, entry]) => entry.resolved?.startsWith("git+"));
  assert.equal(gitEntries.length, Object.keys(pins).length);
  for (const [name, pin] of Object.entries(pins)) {
    assert.equal(manifest.dependencies[name], `github:${pin}`);
    assert.equal(lock.packages[""].dependencies[name], `github:${pin}`);
    const [repository, commit] = pin.split("#");
    assert.equal(lock.packages[`node_modules/${name}`].resolved, `git+ssh://git@github.com/${repository}.git#${commit}`);
  }
  assert.match(await read("contracts/.npmrc"), /^allow-git=root$/m);
  for (const file of [".npmrc", "web/.npmrc"]) assert.match(await read(file), /^allow-git=none$/m);
  for (const file of [".npmrc", "web/.npmrc", "contracts/.npmrc"]) {
    assert.match(await read(file), /^ignore-scripts=true$/m);
    assert.doesNotMatch(await read(file), /^allow-git=all$/m);
  }
  const setup = JSON.parse(await read("package.json")).scripts.setup;
  assert.match(setup, /npm --prefix contracts ci --ignore-scripts --workspaces=false --allow-git=root/);
  assert.equal(setup.match(/--allow-git=root/g)?.length, 1);
});
