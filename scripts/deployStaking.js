const {ethers, upgrades} = require("hardhat");

const {DISTRIBUTOR, RECEIVER} = process.env;

async function main() {
  const Staking = await ethers.getContractFactory("CratStakeManager");
  const staking = await upgrades.deployProxy(Staking, [DISTRIBUTOR, RECEIVER]);

  console.log("Staking deployed ", staking.target);

  await new Promise(x => setTimeout(x, 30000));

  await verify(staking, []);
}

async function verify(contract, constructorArguments) {
  await hre.run("verify:verify", {
    address: contract.target,
    constructorArguments: constructorArguments
  })
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
