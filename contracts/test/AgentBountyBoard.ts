import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { parseEther } from "viem";

const DAY = 24n * 60n * 60n;

async function setup() {
  const { viem, networkHelpers } = await network.create();
  const [poster, worker, outsider, other] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const agentId = await viem.deployContract("MockAgentID");
  const board = await viem.deployContract("AgentBountyBoard", [agentId.address]);

  for (const w of [poster, worker, other]) {
    await agentId.write.mint({ account: w.account });
  }

  const now = BigInt(await networkHelpers.time.latest());
  const reward = parseEther("0.1");
  const post = (deadline = now + 7n * DAY) =>
    board.write.createBounty(["Summarise BNB news", "Daily digest", deadline], {
      account: poster.account,
      value: reward,
    });

  return { viem, networkHelpers, publicClient, agentId, board, poster, worker, outsider, other, now, reward, post };
}

describe("AgentBountyBoard", () => {
  it("only lets Agent ID holders post and claim", async () => {
    const { viem, board, outsider, now, post } = await setup();
    await viem.assertions.revertWithCustomError(
      board.write.createBounty(["t", "d", now + DAY], { account: outsider.account, value: 1n }),
      board,
      "NotAgent",
    );
    await post();
    await viem.assertions.revertWithCustomError(
      board.write.claimBounty([0n], { account: outsider.account }),
      board,
      "NotAgent",
    );
  });

  it("escrows the reward and pays the worker on approval", async () => {
    const { board, poster, worker, publicClient, reward, post } = await setup();
    await post();
    assert.equal(await publicClient.getBalance({ address: board.address }), reward);

    await board.write.claimBounty([0n], { account: worker.account });
    await board.write.submitWork([0n, "ipfs://result"], { account: worker.account });

    const before = await publicClient.getBalance({ address: worker.account.address });
    await board.write.approveWork([0n], { account: poster.account });
    const after = await publicClient.getBalance({ address: worker.account.address });

    assert.equal(after - before, reward);
    assert.equal(await publicClient.getBalance({ address: board.address }), 0n);
    assert.equal(await board.read.jobsCompleted([worker.account.address]), 1n);
    assert.equal(await board.read.totalEarned([worker.account.address]), reward);
    assert.equal(await board.read.bountiesPaid([poster.account.address]), 1n);
    assert.equal((await board.read.getBounty([0n])).status, 3); // Completed
  });

  it("refunds the poster on cancel and blocks double refunds", async () => {
    const { viem, board, poster, publicClient, post } = await setup();
    await post();
    await board.write.cancelBounty([0n], { account: poster.account });
    assert.equal(await publicClient.getBalance({ address: board.address }), 0n);
    await viem.assertions.revertWithCustomError(
      board.write.cancelBounty([0n], { account: poster.account }),
      board,
      "WrongStatus",
    );
  });

  it("stops the poster from cancelling once a worker has claimed", async () => {
    const { viem, board, poster, worker, post } = await setup();
    await post();
    await board.write.claimBounty([0n], { account: worker.account });
    await viem.assertions.revertWithCustomError(
      board.write.cancelBounty([0n], { account: poster.account }),
      board,
      "WrongStatus",
    );
  });

  it("lets the poster reclaim only after the worker misses the deadline", async () => {
    const { viem, networkHelpers, board, poster, worker, now, post } = await setup();
    await post(now + DAY);
    await board.write.claimBounty([0n], { account: worker.account });
    await viem.assertions.revertWithCustomError(
      board.write.reclaimExpired([0n], { account: poster.account }),
      board,
      "DeadlineNotPassed",
    );
    await networkHelpers.time.increase(Number(DAY) + 1);
    await viem.assertions.revertWithCustomError(
      board.write.submitWork([0n, "late"], { account: worker.account }),
      board,
      "DeadlinePassed",
    );
    await board.write.reclaimExpired([0n], { account: poster.account });
    assert.equal((await board.read.getBounty([0n])).status, 4); // Cancelled
  });

  it("pays the worker if the poster ignores the submission", async () => {
    const { viem, networkHelpers, board, worker, publicClient, post } = await setup();
    await post();
    await board.write.claimBounty([0n], { account: worker.account });
    await board.write.submitWork([0n, "done"], { account: worker.account });
    await viem.assertions.revertWithCustomError(
      board.write.claimAfterReview([0n], { account: worker.account }),
      board,
      "ReviewPeriodActive",
    );
    await networkHelpers.time.increase(Number(3n * DAY));
    await board.write.claimAfterReview([0n], { account: worker.account });
    assert.equal(await publicClient.getBalance({ address: board.address }), 0n);
  });

  it("rejection returns the job to the worker with time to resubmit", async () => {
    const { networkHelpers, board, poster, worker, now, post } = await setup();
    await post(now + DAY);
    await board.write.claimBounty([0n], { account: worker.account });
    await board.write.submitWork([0n, "v1"], { account: worker.account });
    await networkHelpers.time.increase(Number(DAY) - 60);
    await board.write.rejectWork([0n, "missing sources"], { account: poster.account });

    const b = await board.read.getBounty([0n]);
    assert.equal(b.status, 1); // Claimed
    assert.ok(b.deadline >= BigInt(await networkHelpers.time.latest()) + 3n * DAY);
    await board.write.submitWork([0n, "v2"], { account: worker.account });
  });

  it("released claims reopen the bounty for others", async () => {
    const { viem, board, poster, worker, other, post } = await setup();
    await post();
    await viem.assertions.revertWithCustomError(
      board.write.claimBounty([0n], { account: poster.account }),
      board,
      "PosterCannotClaim",
    );
    await board.write.claimBounty([0n], { account: worker.account });
    await board.write.releaseClaim([0n], { account: worker.account });
    await board.write.claimBounty([0n], { account: other.account });
    assert.equal(
      (await board.read.getBounty([0n])).worker.toLowerCase(),
      other.account.address.toLowerCase(),
    );
  });

  it("restricts poster/worker actions to the right party", async () => {
    const { viem, board, worker, other, post } = await setup();
    await post();
    await board.write.claimBounty([0n], { account: worker.account });
    await viem.assertions.revertWithCustomError(
      board.write.submitWork([0n, "x"], { account: other.account }),
      board,
      "NotWorker",
    );
    await board.write.submitWork([0n, "x"], { account: worker.account });
    await viem.assertions.revertWithCustomError(
      board.write.approveWork([0n], { account: worker.account }),
      board,
      "NotPoster",
    );
  });

  it("pages bounties newest first", async () => {
    const { board, post } = await setup();
    await post();
    await post();
    await post();
    const [page, ids] = await board.read.getBounties([0n, 2n]);
    assert.deepEqual(ids, [2n, 1n]);
    assert.equal(page.length, 2);
    const [rest, restIds] = await board.read.getBounties([2n, 10n]);
    assert.deepEqual(restIds, [0n]);
    assert.equal(rest.length, 1);
  });
});
