// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, eaddress, euint256, externalEuint256} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title ZVerseGroups
/// @notice FHE-enabled group chat contract that shares an encrypted group key and encrypted messages between members.
contract ZVerseGroups is ZamaEthereumConfig {
    struct Group {
        string name;
        eaddress encryptedKey;
        address creator;
        address[] members;
        mapping(address => bool) isMember;
    }

    struct Message {
        address sender;
        euint256 encryptedContent;
        uint256 timestamp;
    }

    Group[] private _groups;
    mapping(uint256 => Message[]) private _groupMessages;

    event GroupCreated(uint256 indexed groupId, string name, address indexed creator, eaddress encryptedKey);
    event GroupJoined(uint256 indexed groupId, address indexed member);
    event MessageSent(uint256 indexed groupId, address indexed sender, euint256 encryptedContent);

    modifier validGroup(uint256 groupId) {
        require(groupId < _groups.length, "Invalid group");
        _;
    }

    /// @notice Create a new group with a random encrypted address key.
    /// @param name Group name to display in the UI.
    /// @return groupId The identifier of the newly created group.
    function createGroup(string calldata name) external returns (uint256 groupId) {
        require(bytes(name).length > 0, "Name required");

        groupId = _groups.length;

        address groupAddress = address(
            uint160(uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, msg.sender, groupId))))
        );
        eaddress encryptedKey = FHE.asEaddress(groupAddress);

        Group storage group = _groups.push();
        group.name = name;
        group.encryptedKey = encryptedKey;
        group.creator = msg.sender;
        group.members.push(msg.sender);
        group.isMember[msg.sender] = true;

        FHE.allowThis(encryptedKey);
        FHE.allow(encryptedKey, msg.sender);

        emit GroupCreated(groupId, name, msg.sender, encryptedKey);
    }

    /// @notice Join an existing group and gain access to its encrypted key and history.
    /// @param groupId Target group identifier.
    function joinGroup(uint256 groupId) external validGroup(groupId) {
        Group storage group = _groups[groupId];
        require(!group.isMember[msg.sender], "Already a member");

        group.isMember[msg.sender] = true;
        group.members.push(msg.sender);

        FHE.allow(group.encryptedKey, msg.sender);

        Message[] storage messages = _groupMessages[groupId];
        for (uint256 i = 0; i < messages.length; i++) {
            FHE.allow(messages[i].encryptedContent, msg.sender);
        }

        emit GroupJoined(groupId, msg.sender);
    }

    /// @notice Send an encrypted message to group members.
    /// @param groupId Target group identifier.
    /// @param encryptedMessage Ciphertext handle representing the message encrypted with the group key.
    /// @param inputProof Proof generated alongside the ciphertext handle.
    function sendMessage(
        uint256 groupId,
        externalEuint256 encryptedMessage,
        bytes calldata inputProof
    ) external validGroup(groupId) {
        Group storage group = _groups[groupId];
        require(group.isMember[msg.sender], "Join group first");

        euint256 storedMessage = FHE.fromExternal(encryptedMessage, inputProof);
        FHE.allowThis(storedMessage);

        address[] storage members = group.members;
        for (uint256 i = 0; i < members.length; i++) {
            FHE.allow(storedMessage, members[i]);
        }

        _groupMessages[groupId].push(
            Message({sender: msg.sender, encryptedContent: storedMessage, timestamp: block.timestamp})
        );

        emit MessageSent(groupId, msg.sender, storedMessage);
    }

    function getGroupCount() external view returns (uint256) {
        return _groups.length;
    }

    function getGroup(
        uint256 groupId
    ) external view validGroup(groupId) returns (string memory, eaddress, address, uint256) {
        Group storage group = _groups[groupId];
        return (group.name, group.encryptedKey, group.creator, group.members.length);
    }

    function getGroupMembers(uint256 groupId) external view validGroup(groupId) returns (address[] memory) {
        return _groups[groupId].members;
    }

    function isGroupMember(uint256 groupId, address account) external view validGroup(groupId) returns (bool) {
        return _groups[groupId].isMember[account];
    }

    function getGroupKey(uint256 groupId) external view validGroup(groupId) returns (eaddress) {
        return _groups[groupId].encryptedKey;
    }

    function getMessageCount(uint256 groupId) external view validGroup(groupId) returns (uint256) {
        return _groupMessages[groupId].length;
    }

    function getMessage(
        uint256 groupId,
        uint256 index
    ) external view validGroup(groupId) returns (address, euint256, uint256) {
        Message storage messageData = _groupMessages[groupId][index];
        return (messageData.sender, messageData.encryptedContent, messageData.timestamp);
    }

    function canDecryptGroupKey(uint256 groupId, address account) external view validGroup(groupId) returns (bool) {
        return FHE.isAllowed(_groups[groupId].encryptedKey, account);
    }

    function canDecryptMessage(
        uint256 groupId,
        uint256 index,
        address account
    ) external view validGroup(groupId) returns (bool) {
        Message storage messageData = _groupMessages[groupId][index];
        return FHE.isAllowed(messageData.encryptedContent, account);
    }
}
