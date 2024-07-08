const {ethers} = require("hardhat");

const {DISTRIBUTOR, RECEIVER} = process.env;

async function main() {
  const CratStakeManager = await ethers.getContractFactory("CRATStakeManagerTest");

  const AdminComp = require("@openzeppelin/upgrades-core/artifacts/@openzeppelin/contracts-v5/proxy/transparent/ProxyAdmin.sol/ProxyAdmin.json");
  const TUPComp = require("@openzeppelin/upgrades-core/artifacts/@openzeppelin/contracts-v5/proxy/transparent/TransparentUpgradeableProxy.sol/TransparentUpgradeableProxy.json");

  const ProxyAdmin = await ethers.getContractFactory(AdminComp.abi, AdminComp.bytecode);
  const TUP = await ethers.getContractFactory(TUPComp.abi, TUPComp.bytecode);

  const proxyAdmin = await ProxyAdmin.deploy(DISTRIBUTOR, {gasLimit: 8000000});
  console.log("Proxy admin deployed ", proxyAdmin.target);
  // const proxyAdmin = ProxyAdmin.attach("");

  const impl = await CratStakeManager.deploy({gasLimit: 8000000});
  console.log("Implementation deployed ", impl.target);

  await new Promise(x => setTimeout(x, 30000));

  const calldata = CratStakeManager.interface.encodeFunctionData("initialize", [DISTRIBUTOR, RECEIVER]);
  const proxyStaking = await TUP.deploy(impl.target, proxyAdmin.target, calldata, {gasLimit: 8000000});
  console.log("Staking proxy deployed ", proxyStaking.target);
}

// async function verify(contract, constructorArguments) {
//   await hre.run("verify:verify", {
//     address: contract.target,
//     constructorArguments: constructorArguments
//   })
// }

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
