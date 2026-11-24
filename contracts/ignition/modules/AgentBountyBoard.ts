import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// SPACE ID Agent ID on BNB Chain mainnet.
export const AGENT_ID_MAINNET = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f";

export default buildModule("AgentBountyBoardModule", (m) => {
  const agentId = m.getParameter("agentId", AGENT_ID_MAINNET);
  const board = m.contract("AgentBountyBoard", [agentId]);
  return { board };
});
