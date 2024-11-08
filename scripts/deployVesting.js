const {ethers} = require("hardhat");

const {OWNER} = process.env;

async function main() {
  const vesting = await ethers.deployContract("CRATVestingTest", [OWNER, OWNER], {gasLimit: 8000000})
  console.log("Vesting deployed: ", vesting.target);
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
