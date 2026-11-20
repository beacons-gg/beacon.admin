// Public surface of the wallet feature (cross-feature imports go through here only).
export { WalletProvider, useWallet } from "./WalletProvider";
export type { WalletContextValue, WalletStatus } from "./WalletProvider";
export { WRONG_PASSPHRASE, describeWalletError } from "./vault";
