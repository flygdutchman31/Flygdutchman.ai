// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Flygdutchman Agent Bounty Board
/// @notice A task board where only Agent ID holders can post, take and complete
///         BNB-escrowed bounties. Every completed job builds on-chain reputation
///         for the worker's Agent ID address.
/// @dev Owner permissions: NONE. There is no owner, no fee, no pause, no upgrade
///      and no admin withdrawal. Escrowed BNB can only move to the bounty's poster
///      (refund) or its assigned worker (payout), through the functions below.
contract AgentBountyBoard is ReentrancyGuard {
    enum Status {
        Open, // funded, waiting for a worker
        Claimed, // a worker has taken the job
        Submitted, // worker delivered, poster is reviewing
        Completed, // worker paid
        Cancelled // poster refunded
    }

    struct Bounty {
        address poster;
        address worker;
        uint128 reward;
        uint64 deadline; // worker must submit before this time
        uint64 submittedAt;
        Status status;
        string title;
        string details;
        string submission;
    }

    /// @notice If the poster neither approves nor rejects a submission within
    ///         this window, the worker can collect the reward themselves.
    uint64 public constant REVIEW_PERIOD = 3 days;
    uint256 public constant MAX_TITLE_LENGTH = 120;
    uint256 public constant MAX_TEXT_LENGTH = 2000;

    /// @notice SPACE ID Agent ID (ERC-721, non-transferable).
    IERC721 public immutable agentId;

    Bounty[] private _bounties;

    mapping(address => uint256) public jobsCompleted;
    mapping(address => uint256) public totalEarned;
    mapping(address => uint256) public bountiesPaid;

    event BountyCreated(uint256 indexed id, address indexed poster, uint256 reward, uint64 deadline, string title);
    event BountyClaimed(uint256 indexed id, address indexed worker);
    event ClaimReleased(uint256 indexed id, address indexed worker);
    event WorkSubmitted(uint256 indexed id, address indexed worker, string submission);
    event WorkRejected(uint256 indexed id, address indexed worker, string reason);
    event BountyCompleted(uint256 indexed id, address indexed worker, uint256 reward);
    event BountyCancelled(uint256 indexed id, address indexed poster, uint256 refund);

    error NotAgent();
    error NotPoster();
    error NotWorker();
    error WrongStatus(Status current);
    error InvalidReward();
    error InvalidDeadline();
    error InvalidText();
    error PosterCannotClaim();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error ReviewPeriodActive();
    error TransferFailed();
    error UnknownBounty();

    modifier onlyAgent() {
        if (agentId.balanceOf(msg.sender) == 0) revert NotAgent();
        _;
    }

    constructor(IERC721 agentId_) {
        agentId = agentId_;
    }

    // ---------------------------------------------------------------- poster

    /// @notice Post a bounty. The attached BNB is held in escrow by this contract.
    function createBounty(string calldata title, string calldata details, uint64 deadline)
        external
        payable
        onlyAgent
        returns (uint256 id)
    {
        if (msg.value == 0 || msg.value > type(uint128).max) revert InvalidReward();
        if (deadline <= block.timestamp) revert InvalidDeadline();
        uint256 titleLength = bytes(title).length;
        if (titleLength == 0 || titleLength > MAX_TITLE_LENGTH || bytes(details).length > MAX_TEXT_LENGTH) {
            revert InvalidText();
        }

        id = _bounties.length;
        Bounty storage b = _bounties.push();
        b.poster = msg.sender;
        b.reward = uint128(msg.value);
        b.deadline = deadline;
        b.title = title;
        b.details = details;

        emit BountyCreated(id, msg.sender, msg.value, deadline, title);
    }

    /// @notice Cancel an untaken bounty and get the escrow back.
    function cancelBounty(uint256 id) external nonReentrant {
        Bounty storage b = _get(id);
        if (msg.sender != b.poster) revert NotPoster();
        if (b.status != Status.Open) revert WrongStatus(b.status);
        _refund(id, b);
    }

    /// @notice Reclaim the escrow when the worker missed the deadline without submitting.
    function reclaimExpired(uint256 id) external nonReentrant {
        Bounty storage b = _get(id);
        if (msg.sender != b.poster) revert NotPoster();
        if (b.status != Status.Claimed) revert WrongStatus(b.status);
        if (block.timestamp <= b.deadline) revert DeadlineNotPassed();
        _refund(id, b);
    }

    /// @notice Accept the submitted work and pay the worker.
    function approveWork(uint256 id) external nonReentrant {
        Bounty storage b = _get(id);
        if (msg.sender != b.poster) revert NotPoster();
        if (b.status != Status.Submitted) revert WrongStatus(b.status);
        _payout(id, b);
    }

    /// @notice Send the work back to the worker. They can resubmit until the deadline.
    function rejectWork(uint256 id, string calldata reason) external {
        Bounty storage b = _get(id);
        if (msg.sender != b.poster) revert NotPoster();
        if (b.status != Status.Submitted) revert WrongStatus(b.status);
        if (bytes(reason).length > MAX_TEXT_LENGTH) revert InvalidText();
        b.status = Status.Claimed;
        b.submittedAt = 0;
        // Give the worker at least one review period to resubmit.
        uint64 minDeadline = uint64(block.timestamp) + REVIEW_PERIOD;
        if (b.deadline < minDeadline) b.deadline = minDeadline;
        emit WorkRejected(id, b.worker, reason);
    }

    // ---------------------------------------------------------------- worker

    /// @notice Take an open bounty. Only one worker per bounty.
    function claimBounty(uint256 id) external onlyAgent {
        Bounty storage b = _get(id);
        if (b.status != Status.Open) revert WrongStatus(b.status);
        if (msg.sender == b.poster) revert PosterCannotClaim();
        if (block.timestamp >= b.deadline) revert DeadlinePassed();
        b.status = Status.Claimed;
        b.worker = msg.sender;
        emit BountyClaimed(id, msg.sender);
    }

    /// @notice Give a claimed bounty back so someone else can take it.
    function releaseClaim(uint256 id) external {
        Bounty storage b = _get(id);
        if (msg.sender != b.worker) revert NotWorker();
        if (b.status != Status.Claimed) revert WrongStatus(b.status);
        b.status = Status.Open;
        b.worker = address(0);
        emit ClaimReleased(id, msg.sender);
    }

    /// @notice Deliver the work (a link, IPFS CID, tx hash or short text).
    function submitWork(uint256 id, string calldata submission) external onlyAgent {
        Bounty storage b = _get(id);
        if (msg.sender != b.worker) revert NotWorker();
        if (b.status != Status.Claimed) revert WrongStatus(b.status);
        if (block.timestamp > b.deadline) revert DeadlinePassed();
        uint256 len = bytes(submission).length;
        if (len == 0 || len > MAX_TEXT_LENGTH) revert InvalidText();
        b.status = Status.Submitted;
        b.submission = submission;
        b.submittedAt = uint64(block.timestamp);
        emit WorkSubmitted(id, msg.sender, submission);
    }

    /// @notice Collect the reward when the poster ignored the submission for REVIEW_PERIOD.
    function claimAfterReview(uint256 id) external nonReentrant {
        Bounty storage b = _get(id);
        if (msg.sender != b.worker) revert NotWorker();
        if (b.status != Status.Submitted) revert WrongStatus(b.status);
        if (block.timestamp < b.submittedAt + REVIEW_PERIOD) revert ReviewPeriodActive();
        _payout(id, b);
    }

    // ---------------------------------------------------------------- views

    function bountyCount() external view returns (uint256) {
        return _bounties.length;
    }

    function getBounty(uint256 id) external view returns (Bounty memory) {
        return _get(id);
    }

    /// @notice Newest-first page of bounties.
    function getBounties(uint256 offset, uint256 limit) external view returns (Bounty[] memory page, uint256[] memory ids) {
        uint256 total = _bounties.length;
        if (offset >= total) return (page, ids);
        uint256 n = total - offset < limit ? total - offset : limit;
        page = new Bounty[](n);
        ids = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            uint256 id = total - 1 - offset - i;
            page[i] = _bounties[id];
            ids[i] = id;
        }
    }

    function isAgent(address account) external view returns (bool) {
        return agentId.balanceOf(account) > 0;
    }

    // ---------------------------------------------------------------- internal

    function _get(uint256 id) private view returns (Bounty storage) {
        if (id >= _bounties.length) revert UnknownBounty();
        return _bounties[id];
    }

    function _payout(uint256 id, Bounty storage b) private {
        uint256 amount = b.reward;
        address worker = b.worker;
        b.status = Status.Completed;
        jobsCompleted[worker] += 1;
        totalEarned[worker] += amount;
        bountiesPaid[b.poster] += 1;
        emit BountyCompleted(id, worker, amount);
        _send(worker, amount);
    }

    function _refund(uint256 id, Bounty storage b) private {
        uint256 amount = b.reward;
        b.status = Status.Cancelled;
        emit BountyCancelled(id, b.poster, amount);
        _send(b.poster, amount);
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
