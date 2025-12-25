import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedGroups = await deploy("ZVerseGroups", {
    from: deployer,
    log: true,
  });

  console.log(`ZVerseGroups contract: `, deployedGroups.address);
};
export default func;
func.id = "deploy_zverse_groups"; // id required to prevent reexecution
func.tags = ["ZVerseGroups"];
