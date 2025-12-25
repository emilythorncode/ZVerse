import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";
import { ethers } from "ethers";

task("task:address", "Prints the ZVerseGroups address").setAction(async function (_taskArguments: TaskArguments, hre) {
  const { deployments } = hre;
  const groups = await deployments.get("ZVerseGroups");
  console.log("ZVerseGroups address is " + groups.address);
});

task("task:create-group", "Creates a new group")
  .addParam("name", "Name for the group")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { deployments, ethers } = hre;
    const { name } = taskArguments;

    const deployment = await deployments.get("ZVerseGroups");
    const [signer] = await ethers.getSigners();
    const contract = await ethers.getContractAt("ZVerseGroups", deployment.address);

    const tx = await contract.connect(signer).createGroup(name);
    console.log(`Creating group "${name}"... tx=${tx.hash}`);
    await tx.wait();
    console.log("Group created");
  });

task("task:get-group", "Reads group info")
  .addParam("groupId", "Target group id")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { deployments, ethers } = hre;
    const groupId = Number(taskArguments.groupId);

    const deployment = await deployments.get("ZVerseGroups");
    const contract = await ethers.getContractAt("ZVerseGroups", deployment.address);
    const info = await contract.getGroup(groupId);
    const members = await contract.getGroupMembers(groupId);
    console.log(`Group[${groupId}] name=${info[0]} creator=${info[2]} members=${members.length}`);
    console.log(`Encrypted key: ${info[1]}`);
    console.log(`Members: ${members.join(", ")}`);
  });

task("task:send-message", "Encrypts and sends a message to a group")
  .addParam("groupId", "Target group id")
  .addParam("message", "Message content to hash and encrypt")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { deployments, ethers, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const groupId = Number(taskArguments.groupId);
    const plainMessage = taskArguments.message as string;
    const hashed = BigInt(ethers.id(plainMessage));

    const deployment = await deployments.get("ZVerseGroups");
    const [signer] = await ethers.getSigners();
    const contract = await ethers.getContractAt("ZVerseGroups", deployment.address);

    const encryptedInput = await fhevm
      .createEncryptedInput(deployment.address, signer.address)
      .add256(hashed)
      .encrypt();

    const tx = await contract
      .connect(signer)
      .sendMessage(groupId, encryptedInput.handles[0], encryptedInput.inputProof);
    console.log(`Sending encrypted message... tx=${tx.hash}`);
    await tx.wait();

    const count = await contract.getMessageCount(groupId);
    console.log(`Message sent. Total messages now: ${count}`);

    const cipherHandle = (await contract.getMessage(groupId, Number(count) - 1))[1];
    const decrypted = await fhevm.userDecryptEuint(FhevmType.euint256, cipherHandle, deployment.address, signer);
    console.log(`Decrypted message (uint256): ${decrypted.toString()}`);
  });
