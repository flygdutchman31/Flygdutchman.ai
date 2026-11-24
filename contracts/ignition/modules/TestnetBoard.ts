import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Testnet/local: Agent ID only exists on mainnet, so deploy a mintable mock next to the board.
export default buildModule("TestnetBoardModule", (m) => {
  const agentId = m.contract("MockAgentID");
  const board = m.contract("AgentBountyBoard", [agentId]);
  return { agentId, board };
});
