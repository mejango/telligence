import type { ChainPayment } from "@/lib/nana/types";
import type { Address, Hex } from "viem";
export const ACCOUNT = "0x000000000000000000000000000000000000dEaD" as Address;
export const TARGET = "0x0000000000000000000000000000000000001000" as Address;
export const PAYMENT_TARGET = "0x1c05f7841379d4393574c0ffa17908ec40ffd97d" as Address;
export const HASH = `0x${"ab".repeat(32)}` as Hex;
export const BLOCK_HASH = `0x${"cd".repeat(32)}` as Hex;
export const BUNDLE_UUID = "01234567-89ab-cdef-0123-456789abcdef";
export const NOW = 1_750_000_000;
export const PAYMENT_RUNTIME =
  "0x608060405260043610156010575f80fd5b5f3560e01c63103903a7146022575f80fd5b604036600319011260ef576004356fffffffffffffffffffffffffffffffff19811680910360ef5760243564ffffffffff811680910360ef5780421160ce575f341560c6575b5f8080809373755ff2f75a0a586ecfa2b9a3c959cb662458a1053491f11560bb5760407fb96b060a9c075a83da0cf1f9405deeb5df21df681a762de16c3d5eaf99531cd8918151903482526020820152a2005b6040513d5f823e3d90fd5b506108fc6068565b90630f01bd8760e21b5f5260045260245264ffffffffff421660445260645ffd5b5f80fdfea26469706673582212206ea0d2ba1e0cb26cc9293b24f1a7aecc1de7e328ca83d6b3bf5382ac44c7390064736f6c634300081a0033" as Hex;
export function payment(overrides: Partial<ChainPayment> = {}): ChainPayment {
  return {
    amount: "0x10",
    calldata: `0x103903a7${BUNDLE_UUID.replaceAll("-", "")}${"0".repeat(32)}${BigInt(NOW + 600)
      .toString(16)
      .padStart(64, "0")}`,
    chain: 1,
    payment_deadline: String(NOW + 600),
    target: PAYMENT_TARGET,
    token: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    ...overrides,
  };
}
export function onchain(to: Address, input: Hex, value = 16n) {
  return {
    hash: HASH,
    transactionHash: HASH,
    from: ACCOUNT,
    to,
    input,
    value,
    status: "success",
    blockHash: BLOCK_HASH,
    blockNumber: 123n,
  };
}
