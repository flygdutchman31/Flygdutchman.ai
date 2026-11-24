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

// Public RPCs that accept browser (CORS) requests.
const defaultRpc: Record<number, string> = {
  [bsc.id]: "https://bsc-rpc.publicnode.com",
  [bscTestnet.id]: "https://bsc-testnet-rpc.publicnode.com",
};

export const publicClient = createPublicClient({
  chain,
  transport: http(import.meta.env.VITE_RPC_URL || defaultRpc[chain.id]),
});

export const explorer = chain.blockExplorers?.default.url;

export const AGENT_ID_MAINNET = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f" as const;

// Agent ID contract the deploy page wires into a new board. Override only for local/testnet mocks.
export const agentIdForDeploy = ((import.meta.env.VITE_AGENT_ID as string | undefined) || AGENT_ID_MAINNET) as Address;
