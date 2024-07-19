require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("hardhat-gas-reporter");
require("hardhat-contract-sizer");
require("dotenv").config();

const {PRIVATE_KEY/* , TEST_API_KEY, MAIN_API_KEY, ETHERSCAN_KEY, INFURA */} = process.env;


/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.24",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      }
    ],
    overrides: {
      "contracts/CRATStakeManager.sol": {
        version: "0.8.24",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 99,
          },
        }
      },
      "contracts/mock/CRATStakeManagerTest.sol": {
        version: "0.8.24",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 99,
            // details: {
            //   yul: true
            // }
          },
        }
      },
    }
  },
  networks: {
    // hardhat: {
    //   // allowUnlimitedContractSize: true,
    //   forking: {
    //     url: "https://cratd2c-testnet-node1.cratd2csmartchain.io/",
    //     chainId: 65349,
    //     blockNumber: 298148
    //   }
    // },
    cratTestnet: {
      url: "https://cratd2c-testnet-node1.cratd2csmartchain.io/",
      chainId: 65349,
      gasPrice: 25000000000,
      accounts: [PRIVATE_KEY]
    }
  },
  // etherscan: {apiKey: API_KEY},
  gasReporter: {
    enabled: true,
  }
};
