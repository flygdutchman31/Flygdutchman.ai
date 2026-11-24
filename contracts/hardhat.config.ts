import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    bscTestnet: {
      type: "http",
      chainType: "l1",
      url: "https://bsc-testnet-rpc.publicnode.com",
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
    bsc: {
      type: "http",
      chainType: "l1",
      url: "https://bsc-rpc.publicnode.com",
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
  },
  // Etherscan API v2 key also covers BscScan (chain 56 / 97).
  verify: {
    etherscan: { apiKey: configVariable("ETHERSCAN_API_KEY") },
  },
});
