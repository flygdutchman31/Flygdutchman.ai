// Fills a local/testnet board with demo bounties in different states.
// Usage: npx hardhat run scripts/seed-demo.ts --network localhost
import { network } from "hardhat";
import { parseEther } from "viem";

const BOARD = process.env.BOARD_ADDRESS ?? "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

const { viem } = await network.create();
const [poster, worker, other] = await viem.getWalletClients();
const board = await viem.getContractAt("AgentBountyBoard", BOARD as `0x${string}`);
const agentId = await viem.getContractAt("MockAgentID", await board.read.agentId());
const publicClient = await viem.getPublicClient();

for (const w of [poster, worker, other]) {
  if ((await agentId.read.balanceOf([w.account.address])) === 0n) {
    await publicClient.waitForTransactionReceipt({ hash: await agentId.write.mint({ account: w.account }) });
  }
}

const day = 86400n;
const now = BigInt(Math.floor(Date.now() / 1000));
const tasks: [string, string, string, bigint][] = [
  ["Daily BNB Chain DeFi digest", "Summarise the top 5 BNB Chain DeFi events of the day in under 300 words with sources.", "0.02", 2n],
  ["Translate agent docs to Bahasa Indonesia", "Translate the README of our trading agent (about 1,200 words). Deliver a Markdown file link.", "0.05", 5n],
  ["Label 200 token contracts", "Classify each contract as meme / DeFi / infra / unknown. CSV with address,label,notes.", "0.03", 3n],
  ["Write a risk checklist for new tokens", "A practical checklist an agent can run before interacting with a new BEP-20 contract.", "0.015", 4n],
];

for (const [title, details, reward, days] of tasks) {
  const hash = await board.write.createBounty([title, details, now + days * day], {
    account: poster.account,
    value: parseEther(reward),
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

const count = await board.read.bountyCount();
const first = count - BigInt(tasks.length);
const wait = async (p: Promise<`0x${string}`>) => publicClient.waitForTransactionReceipt({ hash: await p });

// #first: completed, #first+1: in review, #first+2: in progress, #first+3: open
await wait(board.write.claimBounty([first], { account: worker.account }));
await wait(board.write.submitWork([first, "https://example.com/digest-2026-11-24.md"], { account: worker.account }));
await wait(board.write.approveWork([first], { account: poster.account }));
await wait(board.write.claimBounty([first + 1n], { account: worker.account }));
await wait(board.write.submitWork([first + 1n, "ipfs://bafy-demo-translation"], { account: worker.account }));
await wait(board.write.claimBounty([first + 2n], { account: other.account }));

console.log(`Seeded ${tasks.length} bounties (ids ${first}..${count - 1n}) on ${BOARD}`);
