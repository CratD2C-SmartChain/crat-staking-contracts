const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect, assert } = require("chai");
const { ethers, upgrades } = require("hardhat");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  
describe("CratVesting", function () {
    async function deployFixture() {
        const [owner, earlyAdoptors, royalties, ico, CTVG, ieo, team, liquidity, airdrop, manualDistribution] = await ethers.getSigners();

        const vesting = await ethers.deployContract("CratVesting", [owner]);
    
        const CratStakeManager = await ethers.getContractFactory("CratStakeManager");
        const stakeManager = await upgrades.deployProxy(CratStakeManager, [owner.address, owner.address]);
    
        return { owner, earlyAdoptors, royalties, ico, CTVG, ieo, team, liquidity, airdrop, manualDistribution, vesting, stakeManager };
    }

    describe("Deployment", function() {
        it("Initial settings", async ()=> {
            const {owner, vesting} = await loadFixture(deployFixture);

            assert.equal(await vesting.hasRole(await vesting.DEFAULT_ADMIN_ROLE(), owner), true);
            let accounts = await vesting.getAllocationAddresses();
            let info = await vesting.getAddressInfo(owner);
            assert.equal(accounts.length, 10);
            assert.equal(info.hasShedule, false);
            assert.equal(info.shedule.length, 8);
            assert.equal(info.claimed, 0);
            assert.equal(await vesting.pending(owner), 0);
            for(let i = 0; i < 10; i++) {
                assert.equal(accounts[i], ZERO_ADDRESS);
                if(i < 8) assert.equal(info.shedule[i], 0);
            }

            assert.equal(await vesting.PRECISION(), 10000);
            assert.equal(await vesting.TOTAL_SUPPLY(), ethers.parseEther('300000000'));
        })
    })

    describe("Main logic", function() {
        it("Reverts list", async ()=> {
            const {owner, earlyAdoptors, royalties, ico, CTVG, ieo, team, liquidity, airdrop, manualDistribution, vesting, stakeManager} = await loadFixture(deployFixture);

            await expect(vesting.connect(ico).startDistribution([
                ZERO_ADDRESS,
                ZERO_ADDRESS,
                ZERO_ADDRESS,
                ZERO_ADDRESS,
                ZERO_ADDRESS,
                ZERO_ADDRESS,
                ZERO_ADDRESS,
                ZERO_ADDRESS,
                ZERO_ADDRESS,
                ZERO_ADDRESS
            ])).to.be.revertedWithCustomError(vesting, "AccessControlUnauthorizedAccount");
            await expect(vesting.connect(ico).claim(ZERO_ADDRESS, 0)).to.be.revertedWithCustomError(vesting, "AccessControlUnauthorizedAccount");
            await expect(vesting.connect(ico).claimAll(ZERO_ADDRESS)).to.be.revertedWithCustomError(vesting, "AccessControlUnauthorizedAccount");
        })
    })
})