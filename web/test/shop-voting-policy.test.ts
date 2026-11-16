import { buildTierConfigs, newDraftItem } from "@/components/shop/itemDraft";
import { requirePriceBasedShopVoting } from "@/lib/shop-voting-policy";
import { erc2771ForwarderAbi, jb721TiersHookAbi } from "@bananapus/nana-sdk-core";
import { encodeFunctionData } from "viem";
import { expect, it } from "vitest";

it("refuses historical custom voting calldata only when new authorization is requested", () => {
  const configs = buildTierConfigs([{ ...newDraftItem(), price: "2" }], 6);
  if (typeof configs === "string") throw new Error(configs);
  const data = () =>
    encodeFunctionData({
      abi: jb721TiersHookAbi,
      functionName: "adjustTiers",
      args: [configs, []],
    });
  expect(() => requirePriceBasedShopVoting(data())).not.toThrow();
  configs[0].flags.useVotingUnits = true;
  const historical = data();
  expect(() => requirePriceBasedShopVoting(historical)).toThrow(/Rebuild/);
  expect(data()).toBe(historical);
  const wrapped = encodeFunctionData({
    abi: erc2771ForwarderAbi,
    functionName: "execute",
    args: [
      {
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        value: 0n,
        gas: 100000n,
        deadline: 1,
        data: historical,
        signature: "0x",
      },
    ],
  });
  expect(() => requirePriceBasedShopVoting(wrapped)).toThrow(/Rebuild/);
  expect(() => requirePriceBasedShopVoting("0x1234")).not.toThrow();
});

it("checks recognized Safe MultiSendCallOnly batches using the shared SDK decoder", async () => {
  const { encodeMultiSend, MULTI_SEND_CALL_ONLY } = await import("@bananapus/nana-sdk-core/safe");
  const configs = buildTierConfigs([{ ...newDraftItem(), price: "2" }], 6);
  if (typeof configs === "string") throw new Error(configs);
  configs[0].flags.useVotingUnits = true;
  const data = encodeFunctionData({
    abi: jb721TiersHookAbi,
    functionName: "adjustTiers",
    args: [configs, []],
  });
  const batch = encodeMultiSend([
    { to: "0x2222222222222222222222222222222222222222", data, value: 0n },
    { to: "0x3333333333333333333333333333333333333333", data: "0x", value: 0n },
  ]);
  expect(() => requirePriceBasedShopVoting(batch, MULTI_SEND_CALL_ONLY, 1)).toThrow(/Rebuild/);
});

it("refuses historical deadlocked reserved supply before new authorization", () => {
  const tiers = buildTierConfigs(
    [
      {
        ...newDraftItem(),
        price: "1",
        supply: "2",
        reserveFrequency: "1",
        reserveBeneficiary: "0x1111111111111111111111111111111111111111",
      },
    ],
    6,
  );
  if (typeof tiers === "string") throw new Error(tiers);
  tiers[0].initialSupply = 1;
  const data = encodeFunctionData({
    abi: jb721TiersHookAbi,
    functionName: "adjustTiers",
    args: [tiers, []],
  });
  expect(() => requirePriceBasedShopVoting(data)).toThrow(/supply of at least 2/);
});

it("checks a Safe execution containing a MultiSend batch and forwarded historical tier", async () => {
  const { encodeMultiSend, MULTI_SEND_CALL_ONLY } = await import("@bananapus/nana-sdk-core/safe");
  const { SAFE_EXEC_ABI } = await import("@bananapus/nana-sdk-core/safe-service");
  const { zeroAddress } = await import("viem");
  const tiers = buildTierConfigs([{ ...newDraftItem(), price: "1" }], 6);
  if (typeof tiers === "string") throw new Error(tiers);
  tiers[0].flags.useVotingUnits = true;
  const custom = encodeFunctionData({
    abi: jb721TiersHookAbi,
    functionName: "adjustTiers",
    args: [tiers, []],
  });
  const target = "0x2222222222222222222222222222222222222222";
  const forwarded = encodeFunctionData({
    abi: erc2771ForwarderAbi,
    functionName: "execute",
    args: [
      {
        from: target,
        to: target,
        value: 0n,
        gas: 100000n,
        deadline: 1,
        data: custom,
        signature: "0x",
      },
    ],
  });
  const batch = encodeMultiSend([{ to: target, data: forwarded, value: 0n }]);
  const safe = encodeFunctionData({
    abi: SAFE_EXEC_ABI,
    functionName: "execTransaction",
    args: [MULTI_SEND_CALL_ONLY, 0n, batch, 1, 0n, 0n, 0n, zeroAddress, zeroAddress, "0x"],
  });
  expect(() => requirePriceBasedShopVoting(safe)).toThrow(/Rebuild/);
});

it("checks historical launch tier bytes without rewriting them", async () => {
  const { parseDeployData } = await import("@/app/create/helpers/parseDeployData");
  const { validRevnetForm, EMPTY_SUCKER_CONFIG, TEST_TIMESTAMP, TEST_SALT } =
    await import("./fixtures/revnet");
  const { sepolia } = await import("viem/chains");
  const form = validRevnetForm();
  form.store.items = [{ ...newDraftItem(), name: "Hat", price: "1", votingUnits: "7" }];
  const request = parseDeployData(form, {
    metadataCid: "bafy-metadata",
    chainId: sepolia.id,
    suckerDeployerConfig: EMPTY_SUCKER_CONFIG,
    timestamp: TEST_TIMESTAMP,
    salt: TEST_SALT,
    creationFee: 0n,
  });
  const data = () => encodeFunctionData(request);
  expect(() => requirePriceBasedShopVoting(data())).not.toThrow();
  if (request.args.length !== 6) throw new Error("Expected shop launch");
  request.args[4].baseline721HookConfiguration.tiersConfig.tiers[0].flags.useVotingUnits = true;
  expect(() => requirePriceBasedShopVoting(data())).toThrow(/Rebuild/);
});
