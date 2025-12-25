import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { ZVerseGroups, ZVerseGroups__factory } from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  carol: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("ZVerseGroups")) as ZVerseGroups__factory;
  const contract = (await factory.deploy()) as ZVerseGroups;
  const contractAddress = await contract.getAddress();

  return { contract, contractAddress };
}

describe("ZVerseGroups", function () {
  let signers: Signers;
  let contract: ZVerseGroups;
  let contractAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2], carol: ethSigners[3] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }

    ({ contract, contractAddress } = await deployFixture());
  });

  it("creates group with encrypted key and member list", async function () {
    await contract.connect(signers.alice).createGroup("Alpha");

    const count = await contract.getGroupCount();
    expect(count).to.eq(1);

    const groupInfo = await contract.getGroup(0);
    expect(groupInfo[0]).to.eq("Alpha");
    expect(groupInfo[1]).to.not.eq(ethers.ZeroHash);
    expect(groupInfo[2]).to.eq(signers.alice.address);
    expect(groupInfo[3]).to.eq(1);

    const members = await contract.getGroupMembers(0);
    expect(members).to.deep.equal([signers.alice.address]);

    const canDecrypt = await contract.canDecryptGroupKey(0, signers.alice.address);
    expect(canDecrypt).to.eq(true);
  });

  it("shares access to history when new members join", async function () {
    await contract.connect(signers.alice).createGroup("History");

    const messageValue = 1234n;
    const encryptedMessage = await fhevm
      .createEncryptedInput(contractAddress, signers.alice.address)
      .add256(messageValue)
      .encrypt();

    await contract
      .connect(signers.alice)
      .sendMessage(0, encryptedMessage.handles[0], encryptedMessage.inputProof);

    await contract.connect(signers.bob).joinGroup(0);

    const isMember = await contract.isGroupMember(0, signers.bob.address);
    expect(isMember).to.eq(true);

    const canReadKey = await contract.canDecryptGroupKey(0, signers.bob.address);
    expect(canReadKey).to.eq(true);

    const canReadMessage = await contract.canDecryptMessage(0, 0, signers.bob.address);
    expect(canReadMessage).to.eq(true);
  });

  it("stores encrypted messages that members can decrypt", async function () {
    await contract.connect(signers.alice).createGroup("Chat");
    await contract.connect(signers.bob).joinGroup(0);

    const hashedContent = 987654321n;
    const encryptedMessage = await fhevm
      .createEncryptedInput(contractAddress, signers.bob.address)
      .add256(hashedContent)
      .encrypt();

    await contract
      .connect(signers.bob)
      .sendMessage(0, encryptedMessage.handles[0], encryptedMessage.inputProof);

    const messageCount = await contract.getMessageCount(0);
    expect(messageCount).to.eq(1);

    const message = await contract.getMessage(0, 0);
    expect(message[0]).to.eq(signers.bob.address);
    expect(message[2]).to.be.gt(0);

    const decrypted = await fhevm.userDecryptEuint(FhevmType.euint256, message[1], contractAddress, signers.bob);
    expect(decrypted).to.eq(hashedContent);
  });
});
