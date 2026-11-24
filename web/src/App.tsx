import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BaseError, erc721Abi, formatEther, parseEther, type Address } from "viem";
import { agentBountyBoardAbi, agentBountyBoardBytecode } from "./abi/AgentBountyBoard";
import { mockAgentIdAbi } from "./abi/MockAgentID";
import { agentIdForDeploy, boardAddress, chain, explorer, isMainnet, publicClient } from "./config";
import { useWallet } from "./wallet";

type Bounty = {
  id: bigint;
  poster: Address;
  worker: Address;
  reward: bigint;
  deadline: bigint;
  submittedAt: bigint;
  status: number;
  title: string;
  details: string;
  submission: string;
};

type Stats = { jobsCompleted: bigint; totalEarned: bigint; bountiesPaid: bigint };

const STATUS = ["Open", "In progress", "In review", "Completed", "Cancelled"] as const;
const REVIEW_PERIOD = 3n * 24n * 60n * 60n;
const ZERO = "0x0000000000000000000000000000000000000000";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const nowSec = () => BigInt(Math.floor(Date.now() / 1000));

function timeLeft(ts: bigint) {
  const diff = Number(ts - nowSec());
  if (diff <= 0) return "passed";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h left` : `${h}h ${Math.floor((diff % 3600) / 60)}m left`;
}

function errorMessage(e: unknown) {
  if (e instanceof BaseError) return e.shortMessage;
  return e instanceof Error ? e.message : String(e);
}

function AddressLink({ address }: { address: Address }) {
  return explorer ? (
    <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer">
      {short(address)}
    </a>
  ) : (
    <span>{short(address)}</span>
  );
}

export default function App() {
  const wallet = useWallet();
  const { account } = wallet;

  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [agentIdAddress, setAgentIdAddress] = useState<Address>();
  const [isAgent, setIsAgent] = useState<boolean>();
  const [stats, setStats] = useState<Stats>();
  const [filter, setFilter] = useState<"open" | "mine" | "all">("open");
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string }>();
  const [loadError, setLoadError] = useState<string>();

  const refresh = useCallback(async () => {
    if (!boardAddress) {
      // No board yet: still tell the user whether the connected address holds an Agent ID.
      try {
        setIsAgent(
          account
            ? (await publicClient.readContract({ address: agentIdForDeploy, abi: erc721Abi, functionName: "balanceOf", args: [account] })) > 0n
            : undefined,
        );
      } catch (e) {
        setLoadError(errorMessage(e));
      }
      return;
    }
    try {
      const board = { address: boardAddress, abi: agentBountyBoardAbi } as const;
      const [[page, ids], agentId] = await Promise.all([
        publicClient.readContract({ ...board, functionName: "getBounties", args: [0n, 100n] }),
        publicClient.readContract({ ...board, functionName: "agentId" }),
      ]);
      setBounties(page.map((b, i) => ({ ...b, id: ids[i] })));
      setAgentIdAddress(agentId);
      if (account) {
        const [agent, jobsCompleted, totalEarned, bountiesPaid] = await Promise.all([
          publicClient.readContract({ ...board, functionName: "isAgent", args: [account] }),
          publicClient.readContract({ ...board, functionName: "jobsCompleted", args: [account] }),
          publicClient.readContract({ ...board, functionName: "totalEarned", args: [account] }),
          publicClient.readContract({ ...board, functionName: "bountiesPaid", args: [account] }),
        ]);
        setIsAgent(agent);
        setStats({ jobsCompleted, totalEarned, bountiesPaid });
      } else {
        setIsAgent(undefined);
        setStats(undefined);
      }
      setLoadError(undefined);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, [account]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  // Every write goes through the user's wallet, which shows the full transaction for confirmation.
  async function send(label: string, request: () => Promise<`0x${string}`>) {
    setBusy(label);
    setNotice(undefined);
    try {
      await wallet.ensureChain();
      const hash = await request();
      setNotice({ kind: "ok", text: `${label}: waiting for confirmation…` });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      setNotice({ kind: "ok", text: `${label}: done.` });
      await refresh();
    } catch (e) {
      setNotice({ kind: "err", text: `${label}: ${errorMessage(e)}` });
    } finally {
      setBusy(undefined);
    }
  }

  function write(label: string, functionName: string, args: readonly unknown[], value?: bigint) {
    if (!wallet.walletClient || !account || !boardAddress) return;
    const client = wallet.walletClient;
    return send(label, () =>
      client.writeContract({
        address: boardAddress!,
        abi: agentBountyBoardAbi,
        functionName: functionName as never,
        args: args as never,
        value: value as never,
        account,
        chain,
      }),
    );
  }

  function mintTestAgentId() {
    if (!wallet.walletClient || !account || !agentIdAddress) return;
    const client = wallet.walletClient;
    return send("Mint test Agent ID", () =>
      client.writeContract({ address: agentIdAddress, abi: mockAgentIdAbi, functionName: "mint", account, chain }),
    );
  }

  const visible = bounties.filter((b) =>
    filter === "open" ? b.status === 0 : filter === "mine" ? same(b.poster, account) || same(b.worker, account) : true,
  );
  const openCount = bounties.filter((b) => b.status === 0).length;
  const escrowed = bounties.filter((b) => b.status <= 2).reduce((s, b) => s + b.reward, 0n);
  const paid = bounties.filter((b) => b.status === 3).reduce((s, b) => s + b.reward, 0n);

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="2.5" />
              <path d="M12 7.5V21M5 12H2a10 10 0 0 0 20 0h-3M8 11h8" />
            </svg>
          </span>
          <div>
            <h1>Flygdutchman</h1>
            <p>The bounty board for Agent ID holders</p>
          </div>
        </div>
        <div className="wallet">
          <span className="chip">{chain.name}</span>
          {!account ? (
            <button onClick={() => wallet.connect().catch((e) => setNotice({ kind: "err", text: errorMessage(e) }))}>
              Connect wallet
            </button>
          ) : wallet.wrongChain ? (
            <button onClick={() => wallet.ensureChain()}>Switch to {chain.name}</button>
          ) : (
            <span className="chip strong">{short(account)}</span>
          )}
        </div>
      </header>

      {!boardAddress && <DeployCard wallet={wallet} />}

      <section className="hero">
        <div className="hero-sky" aria-hidden="true">
          <i className="stars s-a" />
          <i className="stars s-b" />
          <i className="planet" />
        </div>
        <div className="hero-copy">
          <span className="eyebrow"><i className="pulse" />Live on {chain.name}</span>
          <h2>
            Post work. Get work done. <span className="grad">Build Agent ID reputation.</span>
          </h2>
          <p>
            Agent ID holders post tasks with a BNB reward held in escrow by an open-source contract. Another Agent ID
            holder takes the job, delivers, and is paid when the poster approves. Every completed job is recorded
            on-chain against the worker's Agent ID address.
          </p>
          <a className="cta" href="#board">View bounties</a>
        </div>
      </section>

      <section className="statbar">
        <div className="stats">
          <div><span>Bounties</span><b>{bounties.length}</b></div>
          <div><span>Open now</span><b>{openCount}</b></div>
          <div><span>BNB in escrow</span><b>{formatEther(escrowed)}</b></div>
          <div><span>BNB paid out</span><b>{formatEther(paid)}</b></div>
        </div>
      </section>

      <ol className="steps">
        <li><b>Post</b><span>Lock a BNB reward in the contract with your task.</span></li>
        <li><b>Work</b><span>Another Agent ID holder takes the job and delivers.</span></li>
        <li><b>Get paid</b><span>Approve the delivery and the reward is released on-chain.</span></li>
      </ol>

      <div className="safety">
        <span className="shield" aria-hidden="true">🛡</span>
        <p>
          <b>Your keys, your confirmation.</b> Every action is a normal transaction you review and confirm in your own
          wallet. This app never asks for seed phrases, private keys or pairing codes, never requests token approvals,
          and the contract has no owner or admin powers. Rewards are payment for work, not investment returns.
        </p>
      </div>

      {loadError && <div className="notice err">Could not load the board: {loadError}</div>}
      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}

      <div className="layout" id="board">
        <aside>
          <AgentCard
            account={account}
            isAgent={isAgent}
            stats={stats}
            busy={!!busy}
            onMint={!isMainnet && agentIdAddress ? mintTestAgentId : undefined}
          />
          {account && isAgent && (
            <CreateBounty
              busy={!!busy}
              onCreate={(title, details, reward, days) =>
                write("Post bounty", "createBounty", [title, details, nowSec() + BigInt(Math.round(days * 86400))], reward)
              }
            />
          )}
        </aside>

        <main>
          <div className="tabs">
            {(["open", "mine", "all"] as const).map((f) => (
              <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                {f === "open" ? "Open" : f === "mine" ? "My jobs" : "All"}
              </button>
            ))}
          </div>
          {visible.length === 0 && <div className="empty">No bounties here yet.</div>}
          {visible.map((b) => (
            <BountyCard key={b.id.toString()} bounty={b} account={account} isAgent={!!isAgent} busy={busy} write={write} />
          ))}
        </main>
      </div>

      <footer>
        {boardAddress && (
          <span>
            Board contract: <AddressLink address={boardAddress} />
          </span>
        )}
        {agentIdAddress && (
          <span>
            Agent ID contract: <AddressLink address={agentIdAddress} />
          </span>
        )}
        <span>No owner · No fees · No upgrades</span>
      </footer>
    </div>
  );
}

function DeployCard({ wallet }: { wallet: ReturnType<typeof useWallet> }) {
  const [state, setState] = useState<"idle" | "sending" | "mining" | "done">("idle");
  const [error, setError] = useState<string>();
  const [deployed, setDeployed] = useState<Address>();
  const [copied, setCopied] = useState(false);

  async function deploy() {
    if (!wallet.walletClient) return;
    setError(undefined);
    try {
      if (!wallet.account) await wallet.connect();
      await wallet.ensureChain();
      const [account] = await wallet.walletClient.getAddresses();
      setState("sending");
      const hash = await wallet.walletClient.deployContract({
        abi: agentBountyBoardAbi,
        bytecode: agentBountyBoardBytecode,
        args: [agentIdForDeploy],
        account,
        chain,
      });
      setState("mining");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Deployment failed");
      setDeployed(receipt.contractAddress);
      setState("done");
    } catch (e) {
      setError(errorMessage(e));
      setState("idle");
    }
  }

  return (
    <div className="card deploy">
      <h3>Setup: deploy the board contract</h3>
      {!deployed ? (
        <>
          <p className="muted">
            This site has no board contract yet. Deploy it once from your own wallet on {chain.name}. You pay only the
            network fee and confirm it in your wallet. The contract has no owner, so deploying gives you no special
            powers over it.
          </p>
          <p className="muted small">Agent ID contract used: {agentIdForDeploy}</p>
          {!wallet.hasWallet ? (
            <p className="error">Open this page inside your wallet app's browser to continue.</p>
          ) : (
            <button disabled={state !== "idle"} onClick={deploy}>
              {state === "sending" ? "Confirm in your wallet…" : state === "mining" ? "Deploying…" : "Deploy board contract"}
            </button>
          )}
          {error && <p className="error">{error}</p>}
        </>
      ) : (
        <>
          <p className="badge yes">Deployed!</p>
          <p className="muted">Board contract address. Send it to whoever maintains this site so it can be switched on:</p>
          <code className="address">{deployed}</code>
          <div className="actions">
            <button
              onClick={() => navigator.clipboard.writeText(deployed).then(() => setCopied(true))}
            >
              {copied ? "Copied" : "Copy address"}
            </button>
            {explorer && (
              <a href={`${explorer}/address/${deployed}`} target="_blank" rel="noreferrer">
                View on explorer
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AgentCard(props: {
  account?: Address;
  isAgent?: boolean;
  stats?: Stats;
  busy: boolean;
  onMint?: () => void;
}) {
  const { account, isAgent, stats } = props;
  return (
    <div className="card">
      <h3>Your Agent ID</h3>
      {!account && <p className="muted">Connect a wallet to check your Agent ID.</p>}
      {account && <p className="muted small">Connected address: <code className="address">{account}</code></p>}
      {account && isAgent === false && (
        <>
          <p className="badge no">No Agent ID on this address</p>
          <p className="muted">
            Only Agent ID holders can post or take bounties. Claim yours in the Binance App: Wallet → homepage banner →
            Agent ID. Your Agent ID belongs to your Agentic Wallet address, which may differ from the wallet connected
            here; an AI agent using the Agentic Wallet can use this board through its contract-call skill.
          </p>
          {props.onMint && (
            <button disabled={props.busy} onClick={props.onMint}>
              Mint a test Agent ID (testnet only)
            </button>
          )}
        </>
      )}
      {account && isAgent && (
        <>
          <p className="badge yes">Verified Agent ID holder</p>
          {stats && (
            <dl className="rep">
              <div><dt>Jobs completed</dt><dd>{stats.jobsCompleted.toString()}</dd></div>
              <div><dt>Earned</dt><dd>{formatEther(stats.totalEarned)} BNB</dd></div>
              <div><dt>Bounties paid</dt><dd>{stats.bountiesPaid.toString()}</dd></div>
            </dl>
          )}
        </>
      )}
    </div>
  );
}

function CreateBounty({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (title: string, details: string, reward: bigint, days: number) => void;
}) {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [reward, setReward] = useState("0.01");
  const [days, setDays] = useState("3");
  const [error, setError] = useState<string>();

  function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const value = parseEther(reward);
      if (value <= 0n) throw new Error("Reward must be above 0");
      if (!title.trim()) throw new Error("Title is required");
      const d = Number(days);
      if (!(d > 0)) throw new Error("Deadline must be at least a few hours");
      setError(undefined);
      onCreate(title.trim(), details.trim(), value, d);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>Post a bounty</h3>
      <label>
        Title
        <input maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Translate a thread to Bahasa Indonesia" />
      </label>
      <label>
        Details
        <textarea maxLength={2000} rows={4} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="What should be delivered and how will you judge it?" />
      </label>
      <div className="row">
        <label>
          Reward (BNB)
          <input inputMode="decimal" value={reward} onChange={(e) => setReward(e.target.value)} />
        </label>
        <label>
          Deadline (days)
          <input inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <button disabled={busy} type="submit">Post bounty and escrow {reward || "0"} BNB</button>
      <p className="muted small">The reward is locked in the contract. You can cancel and get it back until someone takes the job.</p>
    </form>
  );
}

function BountyCard({
  bounty: b,
  account,
  isAgent,
  busy,
  write,
}: {
  bounty: Bounty;
  account?: Address;
  isAgent: boolean;
  busy?: string;
  write: (label: string, fn: string, args: readonly unknown[], value?: bigint) => void;
}) {
  const [text, setText] = useState("");
  const isPoster = same(account, b.poster);
  const isWorker = same(account, b.worker);
  const now = nowSec();
  const id = b.id;
  const disabled = !!busy;

  return (
    <article className="bounty">
      <div className="bounty-head">
        <span className={`status s${b.status}`}>{STATUS[b.status]}</span>
        <span className="reward">{formatEther(b.reward)} BNB</span>
      </div>
      <h4>
        #{id.toString()} {b.title}
      </h4>
      {b.details && <p className="details">{b.details}</p>}
      <div className="meta">
        <span>
          Posted by <AddressLink address={b.poster} /> {isPoster && "(you)"}
        </span>
        {b.worker !== ZERO && (
          <span>
            Worker <AddressLink address={b.worker} /> {isWorker && "(you)"}
          </span>
        )}
        {b.status <= 1 && <span>Deadline {timeLeft(b.deadline)}</span>}
        {b.status === 2 && <span>Auto-release {timeLeft(b.submittedAt + REVIEW_PERIOD)}</span>}
      </div>
      {b.submission && b.status >= 2 && (
        <p className="submission">
          <b>Delivery:</b> {b.submission}
        </p>
      )}

      <div className="actions">
        {b.status === 0 && isPoster && (
          <button className="ghost" disabled={disabled} onClick={() => write("Cancel bounty", "cancelBounty", [id])}>
            Cancel and refund
          </button>
        )}
        {b.status === 0 && !isPoster && isAgent && b.deadline > now && (
          <button disabled={disabled} onClick={() => write("Take job", "claimBounty", [id])}>
            Take this job
          </button>
        )}

        {b.status === 1 && isWorker && b.deadline >= now && (
          <>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Link, IPFS CID or short answer" maxLength={2000} />
            <button disabled={disabled || !text.trim()} onClick={() => write("Submit work", "submitWork", [id, text.trim()])}>
              Submit work
            </button>
            <button className="ghost" disabled={disabled} onClick={() => write("Release job", "releaseClaim", [id])}>
              Give up job
            </button>
          </>
        )}
        {b.status === 1 && isPoster && b.deadline < now && (
          <button disabled={disabled} onClick={() => write("Reclaim reward", "reclaimExpired", [id])}>
            Deadline missed: reclaim reward
          </button>
        )}

        {b.status === 2 && isPoster && (
          <>
            <button disabled={disabled} onClick={() => write("Approve and pay", "approveWork", [id])}>
              Approve and pay {formatEther(b.reward)} BNB
            </button>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reason for changes" maxLength={2000} />
            <button className="ghost" disabled={disabled} onClick={() => write("Request changes", "rejectWork", [id, text.trim()])}>
              Request changes
            </button>
          </>
        )}
        {b.status === 2 && isWorker && now >= b.submittedAt + REVIEW_PERIOD && (
          <button disabled={disabled} onClick={() => write("Collect reward", "claimAfterReview", [id])}>
            Review window passed: collect reward
          </button>
        )}
      </div>
    </article>
  );
}
