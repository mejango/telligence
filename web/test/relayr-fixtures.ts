import type { ChainPayment } from "@/lib/nana/types";
import type { Address, Hex } from "viem";
import { vi } from "vitest";
export const ACCOUNT = "0x000000000000000000000000000000000000dEaD" as Address;
export const TARGET = "0x0000000000000000000000000000000000001000" as Address;
export const PAYMENT_TARGET = "0x1c05f7841379d4393574c0ffa17908ec40ffd97d" as Address;
export const HASH = `0x${"ab".repeat(32)}` as Hex;
export const BLOCK_HASH = `0x${"cd".repeat(32)}` as Hex;
export let BUNDLE_UUID = "01234567-89ab-cdef-0123-456789abcdef";
export let OTHER_BUNDLE_UUID = "fedcba98-7654-3210-fedc-ba9876543210";

/**
 * Gives the next test bundles of its own. A test that leaves a bundle's background status watch
 * running (an uncertain payment keeps being proven for minutes) then can't write to a later
 * test's bundle of the same UUID.
 */
export function rotateBundleUuids(): void {
  BUNDLE_UUID = crypto.randomUUID();
  OTHER_BUNDLE_UUID = crypto.randomUUID();
}
/** The IDs Relayr assigns to a bundle's transactions, in posted order. */
export const TX_UUIDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];
export const NOW = 1_750_000_000;
export const PAYMENT_RUNTIME =
  "0x608060405260043610156010575f80fd5b5f3560e01c63103903a7146022575f80fd5b604036600319011260ef576004356fffffffffffffffffffffffffffffffff19811680910360ef5760243564ffffffffff811680910360ef5780421160ce575f341560c6575b5f8080809373755ff2f75a0a586ecfa2b9a3c959cb662458a1053491f11560bb5760407fb96b060a9c075a83da0cf1f9405deeb5df21df681a762de16c3d5eaf99531cd8918151903482526020820152a2005b6040513d5f823e3d90fd5b506108fc6068565b90630f01bd8760e21b5f5260045260245264ffffffffff421660445260645ffd5b5f80fdfea26469706673582212206ea0d2ba1e0cb26cc9293b24f1a7aecc1de7e328ca83d6b3bf5382ac44c7390064736f6c634300081a0033" as Hex;
/** A payment option Relayr quotes for `bundleUuid`, payable until `deadline`. */
export function payment(
  overrides: Partial<ChainPayment> = {},
  { bundleUuid = BUNDLE_UUID, deadline = NOW + 600 } = {},
): ChainPayment {
  return {
    amount: "0x10",
    calldata: `0x103903a7${bundleUuid.replaceAll("-", "")}${"0".repeat(32)}${BigInt(deadline)
      .toString(16)
      .padStart(64, "0")}`,
    chain: 1,
    payment_deadline: String(deadline),
    target: PAYMENT_TARGET,
    token: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    ...overrides,
  };
}
export function onchain(to: Address, input: Hex, value = 16n, chainId = 1) {
  return {
    hash: HASH,
    transactionHash: HASH,
    chainId,
    from: ACCOUNT,
    to,
    input,
    value,
    status: "success",
    blockHash: BLOCK_HASH,
    blockNumber: 123n,
    transactionIndex: 0,
    nonce: 5,
  };
}

export type PostedRelayrTransaction = {
  chain: number;
  target: Address;
  data: Hex;
  value: string;
  virtual_nonce: number;
};
export type RelayrRecord = {
  tx_uuid: string;
  request: PostedRelayrTransaction;
  status: { state: string; data?: { hash?: Hex } };
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

/**
 * Relayr's API for one quote, as it answers live: the POST returns the bundle,
 * its payment options and one ID per posted transaction (under the current
 * and the legacy name) without the records, and `GET /v1/bundle/{uuid}`
 * returns a record per transaction echoing the request it was posted with.
 * `records` rewrites that GET's records and `bundle` its other fields.
 */
export function relayrApi({
  bundleUuid = BUNDLE_UUID,
  payments = [payment({}, { bundleUuid })],
  ids = TX_UUIDS,
  quote = (quoted) => ({ tx_uuids: quoted, txn_uuids: quoted }),
  records = (echoed) => echoed,
  bundle = {},
}: {
  bundleUuid?: string;
  payments?: ChainPayment[];
  ids?: string[];
  quote?: (quoted: string[], posted: PostedRelayrTransaction[]) => Record<string, unknown>;
  records?: (echoed: RelayrRecord[]) => unknown[];
  bundle?: Record<string, unknown>;
} = {}) {
  let posted: PostedRelayrTransaction[] = [];
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/bundle/prepaid")) {
      posted = JSON.parse(String(init?.body)).transactions;
      return json({
        bundle_uuid: bundleUuid,
        payment_info: payments,
        ...quote(ids.slice(0, posted.length), posted),
      });
    }
    if (url.endsWith(`/v1/bundle/${bundleUuid}`)) {
      const echoed = posted.map((request, index) => ({
        tx_uuid: ids[index],
        request,
        status: { state: "Pending" },
      }));
      return json({
        bundle_uuid: bundleUuid,
        payment_received: false,
        transactions: records(echoed),
        ...bundle,
      });
    }
    throw new Error(`Unexpected Relayr request: ${url}`);
  });
}
