// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Test/testnet stand-in for the SPACE ID Agent ID (non-transferable ERC-721).
///         Anyone can mint one for themselves. Never deployed to BNB Chain mainnet.
contract MockAgentID is ERC721 {
    uint256 public nextId = 1;

    error Soulbound();
    error AlreadyHasAgentId();

    constructor() ERC721("Mock Agent ID", "AI") {}

    function mint() external {
        if (balanceOf(msg.sender) > 0) revert AlreadyHasAgentId();
        _mint(msg.sender, nextId++);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }
}
