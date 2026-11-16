import { launchConfigHash } from "@/app/create/helpers/launchIntent";
import { legacyBatchNamespace, legacyCallNamespace, legacyIntents } from "@/lib/legacy-intents";
import { parseAbi, type Address } from "viem";
import { describe, expect, it } from "vitest";

const A = "0x000000000000000000000000000000000000dEaD" as Address;
const T = "0x0000000000000000000000000000000000001000" as Address;
const S = "0x0000000000000000000000000000000000004000" as Address;

// Namespaces origin/main (71c24286, #80) built for these inputs, read from that build's own code.
describe("the frozen namespaces of the build before SDK 2.38's builders", () => {
  it.each([
    ["a payment", legacyIntents.pay(7n, A), "intent:pay:080202e2deea2a4a7572d449a369967082b3cf3a"],
    [
      "a typed cash out",
      legacyIntents.cashOut({ projectId: 7n, token: T, amount: 5n, beneficiary: A }),
      "intent:cash-out:67ddd3d249bcfcd65b36f4064e504c4757ad3baf",
    ],
    [
      "a cash out of the Max option",
      legacyIntents.cashOut({ projectId: 7n, token: T, amount: 5n, beneficiary: A }),
      "intent:cash-out:bdccc31bf27fecd1a187552b87648f49992044d5",
    ],
    ["a repay", legacyIntents.repay("5"), "intent:repay:9231f3bd13485cbf834b30b8a51d1db95a4a0e9c"],
    [
      "a reallocation",
      legacyIntents.reallocate("5"),
      "intent:reallocate:0f47e224c472b71a79ee643bc8fa369e491ccb81",
    ],
    [
      "a sucker sync",
      legacyIntents.sync(S),
      "intent:sucker-sync:25146d5fcb88d09e1c1375c6daae1c609c27a0ba",
    ],
    [
      "a bridge of a seeded amount",
      legacyIntents.bridge({ sucker: S, token: T, amount: 1n }),
      "intent:bridge:5bea5b313ebb8e034af4215139542f9f23f41a4e",
    ],
    [
      "a launch",
      legacyIntents.launch(launchConfigHash({ a: 1n, b: [T] })),
      "intent:launch:d2d6fcf9b81ec92b5577d9782cee53052de88858",
    ],
  ])("rebuilds %s", (_case, built, main) => {
    expect(built).toContain(main);
  });

  // That build keyed an amount picked from the 10%, 25%, 50% or Max buttons by the button
  // (useChosen's `policy:<name>`), in cashOutIntent's and the bridge's params.
  it.each(["10%", "25%", "50%", "max"])(
    "rebuilds a cash out and a bridge of the %s option",
    async (option) => {
      const { intent, writeIntentKey } = await import("@bananapus/nana-sdk-core/review");
      const amount = `policy:${option}`;
      expect(
        legacyIntents.cashOut({ projectId: 7n, token: T, amount: 5n, beneficiary: A }),
      ).toContain(
        writeIntentKey("cash-out", {
          projectId: 7n,
          token: intent.address(T),
          amount,
          beneficiary: intent.address(A),
        }),
      );
      expect(legacyIntents.bridge({ sucker: S, token: T, amount: 1n })).toContain(
        writeIntentKey("bridge", { sucker: intent.address(S), token: intent.address(T), amount }),
      );
    },
  );

  const approve = {
    address: T,
    abi: parseAbi(["function approve(address,uint256)"]),
    functionName: "approve",
    args: [S, 9n] as const,
  };
  it("rebuilds an approval keyed by its call, and a Safe batch", () => {
    expect(legacyCallNamespace(approve)).toBe(
      "intent:approve:dfe1a878d948294ea008f2e9d66dad8e3afb0382",
    );
    expect(legacyBatchNamespace([approve])).toBe(
      "intent:batch:18e6a927c859698a8c0685ea2ad5e5b127623f3d",
    );
  });
});
