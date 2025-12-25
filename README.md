# ZVerse

ZVerse is a confidential group chat application built on Zama's FHEVM. It lets users create private rooms, share an
encrypted group key, and exchange encrypted messages that stay unreadable on-chain. Only group members can decrypt the
group key and the message ciphertexts, while the smart contract and blockchain never see plaintext.

## Project Goals

- Deliver a production-like reference for FHE-enabled group communication.
- Show how to combine on-chain access control with off-chain user decryption.
- Provide a complete, working frontend and contract flow without mock data.

## Problem Statement

Traditional on-chain messaging exposes sensitive data, even when using basic encryption patterns. Public blockchains
preserve transaction payloads forever, so group chats require:

- Privacy of message content and group keys.
- Membership-gated decryption.
- Transparent, verifiable access rules without leaking plaintext.

ZVerse solves this with Fully Homomorphic Encryption (FHE) and explicit access control lists (ACLs) on-chain.

## Solution Overview

ZVerse introduces a shared group key "A" that is generated, encrypted, and stored on-chain. Members decrypt A using
Zama's relayer infrastructure, then use A to seal messages locally before sending them as FHE ciphertexts. The contract
only stores encrypted handles and manages access permissions.

High-level flow:

1. Create group: a random address A is generated and encrypted as an `eaddress`.
2. Join group: the contract grants decryption permission for A and existing messages.
3. Send message: the user seals plaintext with A locally, then submits an encrypted `euint256` ciphertext.
4. Decrypt: members request user decryption for ciphertexts and open them locally with A.

## Advantages

- End-to-end confidentiality: plaintext never appears on-chain.
- On-chain access rules: membership gates who can decrypt each ciphertext.
- Auditable membership and message history without revealing content.
- Clean separation of concerns: encryption and decryption stay client-side, ACL stays on-chain.
- Works with standard wallets and a familiar React stack.

## Features

- Create group with encrypted shared key A.
- Join group and gain access to historical ciphertexts.
- Send FHE-encrypted messages to all group members.
- Decrypt group key and messages via Zama relayer.
- View group lists, member lists, and message history in the UI.

## Architecture and Data Flow

Contract layer (ZVerseGroups):
- Stores group metadata: name, creator, encrypted key, members.
- Stores encrypted message handles with timestamps.
- Grants ACL permissions to the creator, members, and contract itself.

Frontend layer:
- Uses viem for reads and ethers for writes.
- Uses Zama relayer SDK for user decryption.
- Seals and opens messages locally with a derived key from A.

Message sealing details:
- The decrypted group key A is hashed with keccak256 to derive 32 key bytes.
- Messages are encoded to bytes, length is stored in byte 0, max 31 bytes.
- Payload is XORed with the derived key and stored as a uint256.

## Smart Contract Summary

Contract: `contracts/ZVerseGroups.sol`

- `createGroup(name)`: creates a new group and encrypts A as `eaddress`.
- `joinGroup(groupId)`: adds a member and grants decryption permissions.
- `sendMessage(groupId, encryptedMessage, inputProof)`: stores ciphertext and grants ACL to all members.
- `getGroupCount`, `getGroup`, `getGroupMembers`: reads for UI.
- `getMessageCount`, `getMessage`: message retrieval.
- `canDecryptGroupKey`, `canDecryptMessage`: explicit ACL checks.

Randomness note: A is derived from block data and sender input, then encrypted. It is not intended as a secure RNG,
but it is never stored in plaintext.

## Frontend Summary

Frontend lives in `ui/` and is built with React + Vite.

Key behaviors:
- Reads use `viem` and the public client.
- Writes use `ethers` with a signer from RainbowKit.
- Zama relayer is initialized with `SepoliaConfig`.
- No local storage or environment variables are used.
- Contract ABI is embedded directly in `ui/src/config/contracts.ts` (no JSON imports).

## Tech Stack

- Smart contracts: Solidity 0.8.24+, FHEVM (`@fhevm/solidity`)
- Dev framework: Hardhat + hardhat-deploy + TypeChain
- Testing: Hardhat + FHEVM plugin + Chai
- Frontend: React + Vite + TypeScript
- Web3: wagmi + viem + ethers v6 + RainbowKit
- FHE relayer: `@zama-fhe/relayer-sdk`

## Repository Structure

```
contracts/              Smart contracts (ZVerseGroups)
deploy/                 Hardhat deploy scripts
tasks/                  Hardhat tasks for group operations
test/                   Contract tests
deployments/            Deployed contract data and ABI (per network)
ui/                     React frontend
docs/                   Zama FHE documentation references
```

## Setup

Prerequisites:
- Node.js 20+
- npm 7+
- A Sepolia wallet with test ETH

Install root dependencies:

```bash
npm install
```

Install frontend dependencies:

```bash
cd ui
npm install
```

## Local Development Workflow

Recommended sequence (local first, then Sepolia):

1. Run tests (FHEVM local mode only):
   ```bash
   npm run test
   ```
2. Start a local node:
   ```bash
   npm run chain
   ```
3. Deploy to local:
   ```bash
   npm run deploy:localhost
   ```
4. Run tasks to validate behavior:
   ```bash
   npx hardhat task:create-group --name "Alpha" --network localhost
   npx hardhat task:get-group --group-id 0 --network localhost
   npx hardhat task:send-message --group-id 0 --message "Hello" --network localhost
   ```

Note: The local test suite skips Sepolia because FHEVM tests require the local mock runtime.

## Sepolia Deployment

Deployment requires a private key and Infura API key (no mnemonic).

1. Create a `.env` file in the project root:
   ```bash
   PRIVATE_KEY=your_private_key
   INFURA_API_KEY=your_infura_key
   ETHERSCAN_API_KEY=your_etherscan_key
   ```
2. Deploy to Sepolia:
   ```bash
   npm run deploy:sepolia
   ```
3. Optional contract verification:
   ```bash
   npm run verify:sepolia -- <CONTRACT_ADDRESS>
   ```

## Frontend Configuration

After deployment, update the frontend to point at the Sepolia contract.

1. Copy the ABI from `deployments/sepolia/ZVerseGroups.json`.
2. Update `ui/src/config/contracts.ts`:
   - Set `CONTRACT_ADDRESS` to the deployed address.
   - Replace `CONTRACT_ABI` with the ABI from deployments.
3. Update `ui/src/config/wagmi.ts`:
   - Set `projectId` to a WalletConnect project id.
   - Optionally set `appName`.

## Running the Frontend

```bash
cd ui
npm run dev
```

Open the app and connect a Sepolia wallet.

## Using the App

- Create a group with a name.
- Select the group and join if you are not a member.
- Decrypt the group key A (requires Zama relayer and wallet signature).
- Send messages; each is sealed with A and encrypted through FHE.
- Decrypt stored messages on demand.

Message length is limited to 31 bytes due to the 32-byte payload format.

## Tasks Reference

- `task:address`: prints deployed contract address.
- `task:create-group`: creates a group.
- `task:get-group`: prints group data and members.
- `task:send-message`: encrypts and sends a message (hash-based in CLI task).

## Known Constraints

- Decryption relies on Zama relayer availability.
- Message size is limited by the 32-byte payload envelope.
- Group key generation uses on-chain entropy and is not cryptographic RNG.

## Future Roadmap

- Pagination and streaming for large message histories.
- Roles and permissions (moderators, invites, ban lists).
- Session-based key rotation and ephemeral group keys.
- Attachment support with encrypted pointers.
- Multi-network configuration and UI network switching.
- Improved message packing to support longer payloads.
- Audit-ready logging and analytics without exposing plaintext.

## License

BSD-3-Clause-Clear. See `LICENSE`.
