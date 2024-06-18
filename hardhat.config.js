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
    ]
  },
  networks: {
    // hardhat: {}
    cratTestnet: {
      url: "http://142.132.143.240:8545/",
      chainId: 22618,
      accounts: [PRIVATE_KEY]
    }
  },
  // etherscan: {apiKey: API_KEY},
  gasReporter: {
    enabled: true,
  }
};
