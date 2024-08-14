const {ethers} = require("hardhat");

const {DISTRIBUTOR, RECEIVER, OWNER} = process.env;

async function main() {
  const CratStakeManager = await ethers.getContractFactory("CRATStakeManagerTest");

  const AdminComp = require("@openzeppelin/upgrades-core/artifacts/@openzeppelin/contracts-v5/proxy/transparent/ProxyAdmin.sol/ProxyAdmin.json");
  const TUPComp = require("@openzeppelin/upgrades-core/artifacts/@openzeppelin/contracts-v5/proxy/transparent/TransparentUpgradeableProxy.sol/TransparentUpgradeableProxy.json");

  const ProxyAdmin = await ethers.getContractFactory(AdminComp.abi, AdminComp.bytecode);
  const TUP = await ethers.getContractFactory(TUPComp.abi, TUPComp.bytecode);

  // const proxyAdmin = await ProxyAdmin.deploy(DISTRIBUTOR, {gasLimit: 8000000});
  // console.log("Proxy admin deployed ", proxyAdmin.target);
  const proxyAdmin = ProxyAdmin.attach("0x845e4145F7de2822d16FE233Ecd0181c61f1d65F");

  const impl = await CratStakeManager.deploy({gasLimit: 8000000});
  console.log("Implementation deployed ", impl.target);

  await new Promise(x => setTimeout(x, 30000));

  const calldata = CratStakeManager.interface.encodeFunctionData("initialize", [DISTRIBUTOR, RECEIVER]);
  const proxyStaking = await TUP.deploy(impl.target, OWNER, calldata, {gasLimit: 8000000});
  console.log("Staking proxy deployed ", proxyStaking.target);
  // const proxyStaking = CratStakeManager.attach("0xFA79Ad6F5128c236c3894523260d48D693b0f155");
  // await proxyStaking.grantRole("0x0000000000000000000000000000000000000000000000000000000000000000", "0x73026Bfc0235875F6C1fD057E4674aC5F1409dE9");
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
