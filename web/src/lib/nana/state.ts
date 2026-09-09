import { isAddressEqual, zeroAddress, type Address } from "viem";

/**
 * Juicebox's primary native terminal may be configured for the native token or
 * USDC. Native takes precedence; a zero/unset native terminal falls back to
 * USDC exactly as the previous project-context behavior did.
 */
export function selectPrimaryNativeTerminal(
  nativeTerminal: Address | null | undefined,
  usdcTerminal: Address | null | undefined,
): Address | undefined {
  if (nativeTerminal && !isAddressEqual(nativeTerminal, zeroAddress)) {
    return nativeTerminal;
  }
  // `undefined` means the native-terminal read has not resolved yet, not that
  // the project has no native terminal. Do not briefly expose the USDC
  // terminal while that read is in flight: write flows must only fall back
  // after the directory definitively returns the zero address for native.
  if (nativeTerminal === undefined || nativeTerminal === null) {
    return undefined;
  }
  return usdcTerminal ?? undefined;
}

/**
 * V6 stores the omnichain deployer in ruleset metadata. Resolve that wrapper
 * to the actual tiered-721 hook first, then the extra data hook.
 */
export function resolveV6DataHookAddress({
  dataHook,
  omnichainDeployer,
  tiered721Hook,
  extraDataHook,
}: {
  dataHook: Address | null | undefined;
  omnichainDeployer: Address | null | undefined;
  tiered721Hook: Address | null | undefined;
  extraDataHook: Address | null | undefined;
}): Address {
  if (!dataHook) return zeroAddress;
  if (!omnichainDeployer || !isAddressEqual(dataHook, omnichainDeployer)) {
    return dataHook;
  }
  if (tiered721Hook && !isAddressEqual(tiered721Hook, zeroAddress)) {
    return tiered721Hook;
  }
  if (extraDataHook && !isAddressEqual(extraDataHook, zeroAddress)) {
    return extraDataHook;
  }
  return dataHook;
}
