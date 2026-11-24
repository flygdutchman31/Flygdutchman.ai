import { createPublicClient, http, type Address, type Chain } from "viem";
import { bsc, bscTestnet, hardhat } from "viem/chains";

const chains: Record<string, Chain> = { bsc, bscTestnet, localhost: hardhat };

export const chain: Chain = chains[import.meta.env.VITE_CHAIN ?? "bsc"] ?? bsc;
export const isMainnet = chain.id === bsc.id;

const rawAddress = import.meta.env.VITE_BOARD_ADDRESS as string | undefined;
export const boardAddress: Address | undefined =
  rawAddress && /^0x[0-9a-fA-F]{40}$/.test(rawAddress) && !/^0x0{40}$/.test(rawAddress)
    ? (rawAddress as Address)
    : undefined;

export const publicClient = createPublicClient({
  chain,
  transport: http(import.meta.env.VITE_RPC_URL || undefined),
});

export const explorer = chain.blockExplorers?.default.url;

export const AGENT_ID_MAINNET = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f" as const;
