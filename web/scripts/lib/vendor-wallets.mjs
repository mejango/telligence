// Wagmi's `reconnect()` calls `getProvider()` on every configured connector, so
// a vendor wallet SDK becomes an eager download the moment its `shouldRestore`
// gate is dropped. Markers must be strings only the vendor bundle can contain —
// never a connector id or display name, which our own source carries.
/** @type {[label: string, markers: string[]][]} */
export const vendorWallets = [
  ["WalletConnect", ["walletconnect.org", "wc@2:", "@reown/appkit"]],
  ["Coinbase Wallet", ["CoinbaseWalletSDK", "keys.coinbase.com", "walletlink"]],
  ["Safe", ["safe-apps-provider", "SafeAppProvider"]],
];
