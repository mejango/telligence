/**
 * ERC-20 `approve` without a declared return. Some tokens (mainnet USDT)
 * return nothing, and the bool viem's `erc20Abi` declares cannot be decoded
 * from that, so simulating their approval fails. The calldata is the same as
 * `erc20Abi`'s. A literal rather than `parseAbi`, which would run at import.
 */
export const erc20ApproveAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
