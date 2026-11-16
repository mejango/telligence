import { BaseError, ContractFunctionRevertedError, toFunctionSelector } from "viem";

/** `ERC721NonexistentToken(uint256)`, which JBProjects' `ownerOf` throws for a project that was never minted. */
const NONEXISTENT_TOKEN = toFunctionSelector("ERC721NonexistentToken(uint256)");

/**
 * The revert `error` carries when the chain answered that the call reverted,
 * or null for anything else. viem reads a node's -32603 internal error as a
 * ContractFunctionRevertedError too, so a -32603 counts only when it carries
 * revert data; without data it is a node failure, not an answer, and reading
 * it as "reverted" would turn an RPC hiccup into a fact about the contract.
 */
export function chainRevert(error: unknown): ContractFunctionRevertedError | null {
  if (!(error instanceof BaseError)) return null;
  const revert = error.walk(
    (cause) => cause instanceof ContractFunctionRevertedError,
  ) as ContractFunctionRevertedError | null;
  if (!revert) return null;
  const internal = error.walk((cause) => (cause as { code?: unknown } | null)?.code === -32603);
  return internal && !revert.raw && !revert.signature ? null : revert;
}

/** Whether `error` is the chain saying the ERC-721 token (here, the project) does not exist. */
export function revertedNonexistentToken(error: unknown): boolean {
  const revert = chainRevert(error);
  return (
    !!revert &&
    (revert.signature === NONEXISTENT_TOKEN || revert.data?.errorName === "ERC721NonexistentToken")
  );
}
