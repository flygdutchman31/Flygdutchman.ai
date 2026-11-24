import { useCallback, useEffect, useMemo, useState } from "react";
import { createWalletClient, custom, getAddress, type Address, type EIP1193Provider } from "viem";
import { chain } from "./config";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
    binancew3w?: { ethereum?: EIP1193Provider };
  }
}

// Prefer Binance Wallet's own provider when present, otherwise any injected EIP-1193 wallet.
function getProvider(): EIP1193Provider | undefined {
  return window.binancew3w?.ethereum ?? window.ethereum;
}

export function useWallet() {
  const provider = getProvider();
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();

  useEffect(() => {
    if (!provider) return;
    const onAccounts = (accounts: string[]) => setAccount(accounts[0] ? getAddress(accounts[0]) : undefined);
    const onChain = (id: string) => setChainId(Number(id));
    provider.request({ method: "eth_accounts" }).then(onAccounts).catch(() => {});
    provider.request({ method: "eth_chainId" }).then(onChain).catch(() => {});
    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    return () => {
      provider.removeListener("accountsChanged", onAccounts);
      provider.removeListener("chainChanged", onChain);
    };
  }, [provider]);

  const walletClient = useMemo(
    () => (provider ? createWalletClient({ chain, transport: custom(provider) }) : undefined),
    [provider],
  );

  const connect = useCallback(async () => {
    if (!walletClient) throw new Error("No wallet found. Open this page in the Binance Wallet app or install a browser wallet.");
    const [addr] = await walletClient.requestAddresses();
    setAccount(addr);
  }, [walletClient]);

  const ensureChain = useCallback(async () => {
    if (!walletClient || chainId === chain.id) return;
    try {
      await walletClient.switchChain({ id: chain.id });
    } catch {
      await walletClient.addChain({ chain });
    }
  }, [walletClient, chainId]);

  return { hasWallet: !!provider, account, chainId, wrongChain: !!account && chainId !== chain.id, walletClient, connect, ensureChain };
}
