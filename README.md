# Crat blockchain system contracts

This repo contains following contracts:
1. CratStakeManager.sol - stake manager contract for validators and delegators accounting;
2. CratVesting.sol - vesting contract for sheduled unlocking funds for several system wallets.

## Before compilation
1. Create .env file & fill all of the necessary fields: `cp env.example .env`
2. `npm i`

## Commands
1. To compile: `npx hardhat compile`
2. To run tests: `npx hardhat test`
3. To run coverage: `npx hardhat coverage`
4. To deploy: `npx hardhat run --network <choose_network> scripts/<choose_script>.js`
