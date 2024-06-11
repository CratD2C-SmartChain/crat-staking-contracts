# Crat blockchain system contracts

This repo contains following contracts:
1. CratStakeManager.sol - stake manager contract for validators and delegators accounting;
2. CratVesting.sol - vesting contract for sheduled unlocking funds for several system wallets.

## Before compilation
1. Create .env file & fill all of the necessary fields: `cp env.example .env`
2. `npm i`

## Before deploy & test
Package version `@openzeppelin/hardhat-upgrades@3.1.0` has been damaged. There are no several useful libraries:
1. `node_modules/@openzeppelin/defender-sdk-base-client/lib`
2. `node_modules/@openzeppelin/defender-sdk-network-client/lib`

Please, find them here [defender-sdk-base-client](https://www.npmjs.com/package/@openzeppelin/defender-sdk-base-client)/[defender-sdk-network-client](https://www.npmjs.com/package/@openzeppelin/defender-sdk-network-client), download and paste it in right directory.

## Commands
1. To compile: `npx hardhat compile`
2. To run tests: `npx hardhat test`
3. To run coverage: `npx hardhat coverage`
4. To deploy: `npx hardhat run --network <choose_network> scripts/<choose_script>.js`
