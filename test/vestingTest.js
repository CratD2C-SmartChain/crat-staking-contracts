const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect, assert } = require("chai");
const { ethers, upgrades } = require("hardhat");
const Web3 = require("web3");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  
describe("CratD2CVesting", function () {
    async function deployFixture() {
        const [owner, earlyAdoptors, royalties, ico, CTVG, ieo, team, liquidity, airdrop, manualDistribution] = await ethers.getSigners();

        const vesting = await ethers.deployContract("CratD2CVesting", [owner]);
    
        const CratD2CStakeManager = await ethers.getContractFactory("CratD2CStakeManager");
        const stakeManager = await upgrades.deployProxy(CratD2CStakeManager, [owner.address, owner.address]);

        await ethers.provider.send("hardhat_setBalance", [owner.address, "0x" + ethers.parseEther("300001000").toString(16)]);
    
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

            assert.equal(await vesting.PRECISION(), ethers.parseEther('100000000'));
            assert.equal(await vesting.TOTAL_SUPPLY(), ethers.parseEther('300000000'));
        })
    })

    describe("Main logic", function() {
        it("Reverts list", async ()=> {
            const {owner, ico, vesting} = await loadFixture(deployFixture);

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

            await expect(vesting.claim(owner, 0)).to.be.revertedWith("CratD2CVesting: wrong amount");
            await expect(vesting.claim(owner, 1)).to.be.revertedWith("CratD2CVesting: wrong amount");
            await expect(vesting.claimAll(owner)).to.be.revertedWith("CratD2CVesting: nothing to claim");

            await expect(vesting.startDistribution([
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
            ])).to.be.revertedWith("CratD2CVesting: wrong vesting supply");

            await expect(vesting.startDistribution([
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
            ], {value: ethers.parseEther('300000000')})).to.be.revertedWith("CratD2CVesting: 0x00");
        })

        it("Vesting shedule (claim every period)", async ()=> {
            const {owner, earlyAdoptors, royalties, ico, CTVG, ieo, team, liquidity, airdrop, manualDistribution, vesting, stakeManager} = await loadFixture(deployFixture);

            await vesting.connect(owner).startDistribution([
                earlyAdoptors,
                royalties,
                ico,
                CTVG,
                ieo,
                team,
                stakeManager,
                liquidity,
                airdrop,
                manualDistribution
            ], {value: ethers.parseEther('300000000')});

            assert.equal(await ethers.provider.getBalance(vesting), await vesting.TOTAL_SUPPLY());

            let allocators = await vesting.getAllocationAddresses();
            assert.equal(allocators.length, 10);
            assert.equal(allocators[0], earlyAdoptors.address);
            assert.equal(allocators[1], royalties.address);
            assert.equal(allocators[2], ico.address);
            assert.equal(allocators[3], CTVG.address);
            assert.equal(allocators[4], ieo.address);
            assert.equal(allocators[5], team.address);
            assert.equal(allocators[6], stakeManager.target);
            assert.equal(allocators[7], liquidity.address);
            assert.equal(allocators[8], airdrop.address);
            assert.equal(allocators[9], manualDistribution.address);

            let info, expected, real, pending;
            for(let i = 0; i < 10; i++) {
                info = await vesting.getAddressInfo(allocators[i]);
                assert.equal(info.claimed, 0);
                assert.equal(info.hasShedule, true);
                switch(i) {
                    case 0:
                        assert.equal(info.shedule[0], ethers.parseEther('1709000'));
                        assert.equal(info.shedule[1], 0);
                        assert.equal(info.shedule[2], 0);
                        assert.equal(info.shedule[3], 0);
                        assert.equal(info.shedule[4], 0);
                        assert.equal(info.shedule[5], 0);
                        assert.equal(info.shedule[6], 0);
                        assert.equal(info.shedule[7], 0);

                        pending = await vesting.pending(allocators[i]);
                        assert.equal(pending, ethers.parseEther('5127000'));
                        await expect(vesting.claimAll(allocators[i])).to.changeEtherBalances([vesting, allocators[i]], [-pending, pending]);
                        assert.equal(await vesting.pending(allocators[i]), 0);
                        assert.equal((await vesting.getAddressInfo(allocators[i])).claimed, pending);
                        break;
                    case 1:
                        assert.equal(info.shedule[0], 0);
                        assert.equal(info.shedule[1], ethers.parseEther('1000000'));
                        assert.equal(info.shedule[2], ethers.parseEther('3000000'));
                        assert.equal(info.shedule[3], ethers.parseEther('5119000'));
                        assert.equal(info.shedule[4], ethers.parseEther('3000000'));
                        assert.equal(info.shedule[5], ethers.parseEther('6291000'));
                        assert.equal(info.shedule[6], ethers.parseEther('4590000'));
                        assert.equal(info.shedule[7], ethers.parseEther('7000000'));
                        assert.equal(await vesting.pending(allocators[i]), 0);
                        await expect(vesting.claimAll(allocators[i])).to.be.revertedWith("CratD2CVesting: nothing to claim");
                        break;
                    case 2:
                        assert.equal(info.shedule[0], "6666666666666666666666666");
                        assert.equal(info.shedule[1], 0);
                        assert.equal(info.shedule[2], 0);
                        assert.equal(info.shedule[3], 0);
                        assert.equal(info.shedule[4], 0);
                        assert.equal(info.shedule[5], 0);
                        assert.equal(info.shedule[6], 0);
                        assert.equal(info.shedule[7], 0);

                        pending = await vesting.pending(allocators[i]);
                        expected = parseFloat(Web3.utils.fromWei((pending).toString(), 'ether')).toFixed(18);
                        real = parseFloat(Web3.utils.fromWei((ethers.parseEther('20000000')).toString(), 'ether')).toFixed(18);
                        assert.equal(expected, real);

                        await expect(vesting.claimAll(allocators[i])).to.changeEtherBalances([vesting, allocators[i]], [-pending, pending]);
                        assert.equal(await vesting.pending(allocators[i]), 0);
                        assert.equal((await vesting.getAddressInfo(allocators[i])).claimed, pending);
                        // assert.equal(await vesting.pending(allocators[i]), ethers.parseEther('20000000'));
                        break;
                    case 3:
                        assert.equal(info.shedule[0], 0);
                        assert.equal(info.shedule[1], ethers.parseEther('200000'));
                        assert.equal(info.shedule[2], ethers.parseEther('700000'));
                        assert.equal(info.shedule[3], ethers.parseEther('600000'));
                        assert.equal(info.shedule[4], ethers.parseEther('2500000'));
                        assert.equal(info.shedule[5], ethers.parseEther('3900000'));
                        assert.equal(info.shedule[6], ethers.parseEther('500000'));
                        assert.equal(info.shedule[7], ethers.parseEther('1600000'));
                        assert.equal(await vesting.pending(allocators[i]), 0);
                        await expect(vesting.claimAll(allocators[i])).to.be.revertedWith("CratD2CVesting: nothing to claim");
                        break;
                    case 4:
                        assert.equal(info.shedule[0], ethers.parseEther('1000000'));
                        assert.equal(info.shedule[1], 0);
                        assert.equal(info.shedule[2], 0);
                        assert.equal(info.shedule[3], 0);
                        assert.equal(info.shedule[4], 0);
                        assert.equal(info.shedule[5], 0);
                        assert.equal(info.shedule[6], 0);
                        assert.equal(info.shedule[7], 0);

                        pending = await vesting.pending(allocators[i]);
                        assert.equal(pending, ethers.parseEther('3000000'));
                        await expect(vesting.claimAll(allocators[i])).to.changeEtherBalances([vesting, allocators[i]], [-pending, pending]);
                        assert.equal(await vesting.pending(allocators[i]), 0);
                        assert.equal((await vesting.getAddressInfo(allocators[i])).claimed, pending);
                        break;
                    case 5:
                        assert.equal(info.shedule[0], ethers.parseEther('100000'));
                        assert.equal(info.shedule[1], ethers.parseEther('500000'));
                        assert.equal(info.shedule[2], ethers.parseEther('600000'));
                        assert.equal(info.shedule[3], ethers.parseEther('2800000'));
                        assert.equal(info.shedule[4], ethers.parseEther('1000000'));
                        assert.equal(info.shedule[5], ethers.parseEther('2200000'));
                        assert.equal(info.shedule[6], ethers.parseEther('1300000'));
                        assert.equal(info.shedule[7], ethers.parseEther('1500000'));

                        pending = await vesting.pending(allocators[i]);
                        assert.equal(pending, ethers.parseEther('300000'));
                        await expect(vesting.claimAll(allocators[i])).to.changeEtherBalances([vesting, allocators[i]], [-pending, pending]);
                        assert.equal(await vesting.pending(allocators[i]), 0);
                        assert.equal((await vesting.getAddressInfo(allocators[i])).claimed, pending);
                        break;
                    case 6:
                        assert.equal(info.shedule[0], ethers.parseEther('274333.333333333333333333'));
                        assert.equal(info.shedule[1], ethers.parseEther('1000000'));
                        assert.equal(info.shedule[2], ethers.parseEther('2000000'));
                        assert.equal(info.shedule[3], ethers.parseEther('3000000'));
                        assert.equal(info.shedule[4], ethers.parseEther('3000000'));
                        assert.equal(info.shedule[5], ethers.parseEther('3692300'));
                        assert.equal(info.shedule[6], ethers.parseEther('2000000'));
                        assert.equal(info.shedule[7], ethers.parseEther('3033400'));

                        pending = await vesting.pending(allocators[i]);
                        expected = parseFloat(Web3.utils.fromWei((pending).toString(), 'ether')).toFixed(18);
                        real = parseFloat(Web3.utils.fromWei((ethers.parseEther('823000')).toString(), 'ether')).toFixed(18);
                        assert.equal(expected, real);
                        // assert.equal(await vesting.pending(allocators[i]), ethers.parseEther('823000'));

                        await expect(vesting.claimAll(allocators[i])).to.changeEtherBalances([vesting, allocators[i]], [-pending, pending]);
                        assert.equal(await vesting.pending(allocators[i]), 0);
                        assert.equal((await vesting.getAddressInfo(allocators[i])).claimed, pending);
                        break;
                    case 7:
                        assert.equal(info.shedule[0], 0);
                        assert.equal(info.shedule[1], ethers.parseEther('200000'));
                        assert.equal(info.shedule[2], ethers.parseEther('400000'));
                        assert.equal(info.shedule[3], ethers.parseEther('2500000'));
                        assert.equal(info.shedule[4], ethers.parseEther('1900000'));
                        assert.equal(info.shedule[5], ethers.parseEther('1500000'));
                        assert.equal(info.shedule[6], ethers.parseEther('2000000'));
                        assert.equal(info.shedule[7], ethers.parseEther('1500000'));
                        assert.equal(await vesting.pending(allocators[i]), 0);
                        await expect(vesting.claimAll(allocators[i])).to.be.revertedWith("CratD2CVesting: nothing to claim");
                        break;
                    case 8:
                        assert.equal(info.shedule[0], ethers.parseEther('250000'));
                        assert.equal(info.shedule[1], 0);
                        assert.equal(info.shedule[2], 0);
                        assert.equal(info.shedule[3], 0);
                        assert.equal(info.shedule[4], 0);
                        assert.equal(info.shedule[5], 0);
                        assert.equal(info.shedule[6], 0);
                        assert.equal(info.shedule[7], 0);

                        pending = await vesting.pending(allocators[i]);
                        assert.equal(pending, ethers.parseEther('750000'));
                        await expect(vesting.claimAll(allocators[i])).to.changeEtherBalances([vesting, allocators[i]], [-pending, pending]);
                        assert.equal(await vesting.pending(allocators[i]), 0);
                        assert.equal((await vesting.getAddressInfo(allocators[i])).claimed, pending);
                        break;
                    case 9:
                        assert.equal(info.shedule[0], 0);
                        assert.equal(info.shedule[1], ethers.parseEther('1100000'));
                        assert.equal(info.shedule[2], ethers.parseEther('1900000'));
                        assert.equal(info.shedule[3], ethers.parseEther('1781000'));
                        assert.equal(info.shedule[4], ethers.parseEther('1200000'));
                        assert.equal(info.shedule[5], ethers.parseEther('1916700'));
                        assert.equal(info.shedule[6], ethers.parseEther('1410000'));
                        assert.equal(info.shedule[7], ethers.parseEther('3066600'));
                        assert.equal(await vesting.pending(allocators[i]), 0);
                        await expect(vesting.claimAll(allocators[i])).to.be.revertedWith("CratD2CVesting: nothing to claim");
                        break;
                }
            }

            // increase to December, 31, 2025 year (not yet pending increased)
            await time.increaseTo(1767225599);
            for(let i = 0; i < 10; i++){
                assert.equal(await vesting.pending(allocators[i]), 0);
            }
            
            await time.increase(1);

            assert.equal(await vesting.pending(allocators[0]), 0);

            pending = await vesting.pending(allocators[1]);
            assert.equal(pending, ethers.parseEther('3000000'));
            await expect(vesting.claimAll(allocators[1])).to.changeEtherBalances([vesting, allocators[1]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[1]), 0);

            assert.equal(await vesting.pending(allocators[2]), 0);

            pending = await vesting.pending(allocators[3]);
            assert.equal(pending, ethers.parseEther('600000'));
            await expect(vesting.claimAll(allocators[3])).to.changeEtherBalances([vesting, allocators[3]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[3]), 0);

            assert.equal(await vesting.pending(allocators[4]), 0);

            pending = await vesting.pending(allocators[5]);
            assert.equal(pending, ethers.parseEther('1500000'));
            await expect(vesting.claimAll(allocators[5])).to.changeEtherBalances([vesting, allocators[5]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[5]), 0);

            pending = await vesting.pending(allocators[6]);
            assert.equal(pending, ethers.parseEther('3000000'));
            await expect(vesting.claimAll(allocators[6])).to.changeEtherBalances([vesting, allocators[6]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[6]), 0);

            pending = await vesting.pending(allocators[7]);
            assert.equal(pending, ethers.parseEther('600000'));
            await expect(vesting.claimAll(allocators[7])).to.changeEtherBalances([vesting, allocators[7]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[7]), 0);

            assert.equal(await vesting.pending(allocators[8]), 0);

            pending = await vesting.pending(allocators[9]);
            assert.equal(pending, ethers.parseEther('3300000'));
            await expect(vesting.claimAll(allocators[9])).to.changeEtherBalances([vesting, allocators[9]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[9]), 0);

            // increase to December, 31, 2027 year (not yet pending increased)
            await time.increaseTo(1830297599);
            for(let i = 0; i < 10; i++){
                assert.equal(await vesting.pending(allocators[i]), 0);
            }
            
            await time.increase(1);

            assert.equal(await vesting.pending(allocators[0]), 0);

            pending = await vesting.pending(allocators[1]);
            assert.equal(pending, ethers.parseEther('9000000'));
            await expect(vesting.claimAll(allocators[1])).to.changeEtherBalances([vesting, allocators[1]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[1]), 0);

            assert.equal(await vesting.pending(allocators[2]), 0);

            pending = await vesting.pending(allocators[3]);
            assert.equal(pending, ethers.parseEther('2100000'));
            await expect(vesting.claimAll(allocators[3])).to.changeEtherBalances([vesting, allocators[3]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[3]), 0);

            assert.equal(await vesting.pending(allocators[4]), 0);

            pending = await vesting.pending(allocators[5]);
            assert.equal(pending, ethers.parseEther('1800000'));
            await expect(vesting.claimAll(allocators[5])).to.changeEtherBalances([vesting, allocators[5]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[5]), 0);

            pending = await vesting.pending(allocators[6]);
            assert.equal(pending, ethers.parseEther('6000000'));
            await expect(vesting.claimAll(allocators[6])).to.changeEtherBalances([vesting, allocators[6]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[6]), 0);

            pending = await vesting.pending(allocators[7]);
            assert.equal(pending, ethers.parseEther('1200000'));
            await expect(vesting.claimAll(allocators[7])).to.changeEtherBalances([vesting, allocators[7]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[7]), 0);

            assert.equal(await vesting.pending(allocators[8]), 0);

            pending = await vesting.pending(allocators[9]);
            assert.equal(pending, ethers.parseEther('5700000'));
            await expect(vesting.claimAll(allocators[9])).to.changeEtherBalances([vesting, allocators[9]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[9]), 0);

            // increase to December, 31, 2029 year (not yet pending increased)
            await time.increaseTo(1893455999);
            for(let i = 0; i < 10; i++){
                assert.equal(await vesting.pending(allocators[i]), 0);
            }
            
            await time.increase(1);

            assert.equal(await vesting.pending(allocators[0]), 0);

            pending = await vesting.pending(allocators[1]);
            assert.equal(pending, ethers.parseEther('15357000'));
            await expect(vesting.claimAll(allocators[1])).to.changeEtherBalances([vesting, allocators[1]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[1]), 0);

            assert.equal(await vesting.pending(allocators[2]), 0);

            pending = await vesting.pending(allocators[3]);
            assert.equal(pending, ethers.parseEther('1800000'));
            await expect(vesting.claimAll(allocators[3])).to.changeEtherBalances([vesting, allocators[3]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[3]), 0);

            assert.equal(await vesting.pending(allocators[4]), 0);

            pending = await vesting.pending(allocators[5]);
            assert.equal(pending, ethers.parseEther('8400000'));
            await expect(vesting.claimAll(allocators[5])).to.changeEtherBalances([vesting, allocators[5]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[5]), 0);

            pending = await vesting.pending(allocators[6]);
            assert.equal(pending, ethers.parseEther('9000000'));
            await expect(vesting.claimAll(allocators[6])).to.changeEtherBalances([vesting, allocators[6]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[6]), 0);

            pending = await vesting.pending(allocators[7]);
            assert.equal(pending, ethers.parseEther('7500000'));
            await expect(vesting.claimAll(allocators[7])).to.changeEtherBalances([vesting, allocators[7]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[7]), 0);

            assert.equal(await vesting.pending(allocators[8]), 0);

            pending = await vesting.pending(allocators[9]);
            assert.equal(pending, ethers.parseEther('5343000'));
            await expect(vesting.claimAll(allocators[9])).to.changeEtherBalances([vesting, allocators[9]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[9]), 0);

            // increase to December, 31, 2031 year (not yet pending increased)
            await time.increaseTo(1956527999);
            for(let i = 0; i < 10; i++){
                assert.equal(await vesting.pending(allocators[i]), 0);
            }
            
            await time.increase(1);

            assert.equal(await vesting.pending(allocators[0]), 0);

            pending = await vesting.pending(allocators[1]);
            assert.equal(pending, ethers.parseEther('9000000'));
            await expect(vesting.claimAll(allocators[1])).to.changeEtherBalances([vesting, allocators[1]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[1]), 0);

            assert.equal(await vesting.pending(allocators[2]), 0);

            pending = await vesting.pending(allocators[3]);
            assert.equal(pending, ethers.parseEther('7500000'));
            await expect(vesting.claimAll(allocators[3])).to.changeEtherBalances([vesting, allocators[3]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[3]), 0);

            assert.equal(await vesting.pending(allocators[4]), 0);

            pending = await vesting.pending(allocators[5]);
            assert.equal(pending, ethers.parseEther('3000000'));
            await expect(vesting.claimAll(allocators[5])).to.changeEtherBalances([vesting, allocators[5]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[5]), 0);

            pending = await vesting.pending(allocators[6]);
            assert.equal(pending, ethers.parseEther('9000000'));
            await expect(vesting.claimAll(allocators[6])).to.changeEtherBalances([vesting, allocators[6]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[6]), 0);

            pending = await vesting.pending(allocators[7]);
            assert.equal(pending, ethers.parseEther('5700000'));
            await expect(vesting.claimAll(allocators[7])).to.changeEtherBalances([vesting, allocators[7]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[7]), 0);

            assert.equal(await vesting.pending(allocators[8]), 0);

            pending = await vesting.pending(allocators[9]);
            assert.equal(pending, ethers.parseEther('3600000'));
            await expect(vesting.claimAll(allocators[9])).to.changeEtherBalances([vesting, allocators[9]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[9]), 0);

            // increase to December, 31, 2033 year (not yet pending increased)
            await time.increaseTo(2019686399);
            for(let i = 0; i < 10; i++){
                assert.equal(await vesting.pending(allocators[i]), 0);
            }
            
            await time.increase(1);

            assert.equal(await vesting.pending(allocators[0]), 0);

            pending = await vesting.pending(allocators[1]);
            assert.equal(pending, ethers.parseEther('18873000'));
            await expect(vesting.claimAll(allocators[1])).to.changeEtherBalances([vesting, allocators[1]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[1]), 0);

            assert.equal(await vesting.pending(allocators[2]), 0);

            pending = await vesting.pending(allocators[3]);
            assert.equal(pending, ethers.parseEther('11700000'));
            await expect(vesting.claimAll(allocators[3])).to.changeEtherBalances([vesting, allocators[3]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[3]), 0);

            assert.equal(await vesting.pending(allocators[4]), 0);

            pending = await vesting.pending(allocators[5]);
            assert.equal(pending, ethers.parseEther('6600000'));
            await expect(vesting.claimAll(allocators[5])).to.changeEtherBalances([vesting, allocators[5]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[5]), 0);

            pending = await vesting.pending(allocators[6]);
            assert.equal(pending, ethers.parseEther('11076900'));
            await expect(vesting.claimAll(allocators[6])).to.changeEtherBalances([vesting, allocators[6]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[6]), 0);

            pending = await vesting.pending(allocators[7]);
            assert.equal(pending, ethers.parseEther('4500000'));
            await expect(vesting.claimAll(allocators[7])).to.changeEtherBalances([vesting, allocators[7]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[7]), 0);

            assert.equal(await vesting.pending(allocators[8]), 0);

            pending = await vesting.pending(allocators[9]);
            assert.equal(pending, ethers.parseEther('5750100'));
            await expect(vesting.claimAll(allocators[9])).to.changeEtherBalances([vesting, allocators[9]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[9]), 0);

            // increase to December, 31, 2035 year (not yet pending increased)
            await time.increaseTo(2082758399);
            for(let i = 0; i < 10; i++){
                assert.equal(await vesting.pending(allocators[i]), 0);
            }
            
            await time.increase(1);

            assert.equal(await vesting.pending(allocators[0]), 0);

            pending = await vesting.pending(allocators[1]);
            assert.equal(pending, ethers.parseEther('13770000'));
            await expect(vesting.claimAll(allocators[1])).to.changeEtherBalances([vesting, allocators[1]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[1]), 0);

            assert.equal(await vesting.pending(allocators[2]), 0);

            pending = await vesting.pending(allocators[3]);
            assert.equal(pending, ethers.parseEther('1500000'));
            await expect(vesting.claimAll(allocators[3])).to.changeEtherBalances([vesting, allocators[3]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[3]), 0);

            assert.equal(await vesting.pending(allocators[4]), 0);

            pending = await vesting.pending(allocators[5]);
            assert.equal(pending, ethers.parseEther('3900000'));
            await expect(vesting.claimAll(allocators[5])).to.changeEtherBalances([vesting, allocators[5]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[5]), 0);

            pending = await vesting.pending(allocators[6]);
            assert.equal(pending, ethers.parseEther('6000000'));
            await expect(vesting.claimAll(allocators[6])).to.changeEtherBalances([vesting, allocators[6]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[6]), 0);

            pending = await vesting.pending(allocators[7]);
            assert.equal(pending, ethers.parseEther('6000000'));
            await expect(vesting.claimAll(allocators[7])).to.changeEtherBalances([vesting, allocators[7]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[7]), 0);

            assert.equal(await vesting.pending(allocators[8]), 0);

            pending = await vesting.pending(allocators[9]);
            assert.equal(pending, ethers.parseEther('4230000'));
            await expect(vesting.claimAll(allocators[9])).to.changeEtherBalances([vesting, allocators[9]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[9]), 0);

            // increase to December, 31, 2037 year (not yet pending increased)
            await time.increaseTo(2145916799);
            for(let i = 0; i < 10; i++){
                assert.equal(await vesting.pending(allocators[i]), 0);
            }
            
            await time.increase(1);

            assert.equal(await vesting.pending(allocators[0]), 0);

            pending = await vesting.pending(allocators[1]);
            assert.equal(pending, ethers.parseEther('21000000'));
            await expect(vesting.claimAll(allocators[1])).to.changeEtherBalances([vesting, allocators[1]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[1]), 0);

            assert.equal(await vesting.pending(allocators[2]), 0);

            pending = await vesting.pending(allocators[3]);
            assert.equal(pending, ethers.parseEther('4800000'));
            await expect(vesting.claimAll(allocators[3])).to.changeEtherBalances([vesting, allocators[3]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[3]), 0);

            assert.equal(await vesting.pending(allocators[4]), 0);

            pending = await vesting.pending(allocators[5]);
            assert.equal(pending, ethers.parseEther('4500000'));
            await expect(vesting.claimAll(allocators[5])).to.changeEtherBalances([vesting, allocators[5]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[5]), 0);

            pending = await vesting.pending(allocators[6]);
            assert.equal(pending, ethers.parseEther('9100200'));
            await expect(vesting.claimAll(allocators[6])).to.changeEtherBalances([vesting, allocators[6]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[6]), 0);

            pending = await vesting.pending(allocators[7]);
            assert.equal(pending, ethers.parseEther('4500000'));
            await expect(vesting.claimAll(allocators[7])).to.changeEtherBalances([vesting, allocators[7]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[7]), 0);

            assert.equal(await vesting.pending(allocators[8]), 0);

            pending = await vesting.pending(allocators[9]);
            assert.equal(pending, ethers.parseEther('9199800'));
            await expect(vesting.claimAll(allocators[9])).to.changeEtherBalances([vesting, allocators[9]], [-pending, pending]);
            assert.equal(await vesting.pending(allocators[9]), 0);

            await time.increaseTo(2208988800); // increase to 2040
            for(let i = 0; i < 10; i++){
                assert.equal(await vesting.pending(allocators[i]), 0);
            }

            await time.increase(time.duration.years(2));
            for(let i = 0; i < 10; i++){
                assert.equal(await vesting.pending(allocators[i]), 0);
            }

            assert.equal(await ethers.provider.getBalance(vesting), 3);
        })

        it("Vesting shedule (check different schemes of claim)", async ()=> {
            const {owner, earlyAdoptors, royalties, ico, CTVG, ieo, team, liquidity, airdrop, manualDistribution, vesting, stakeManager} = await loadFixture(deployFixture);

            await vesting.connect(owner).startDistribution([
                earlyAdoptors,
                royalties,
                ico,
                CTVG,
                ieo,
                team,
                stakeManager,
                liquidity,
                airdrop,
                manualDistribution
            ], {value: ethers.parseEther('300000000')});

            // partially claim
            assert.equal(await vesting.pending(earlyAdoptors), ethers.parseEther('5127000'));

            await expect(vesting.claim(earlyAdoptors, ethers.parseEther('6000000'))).to.be.revertedWith("CratD2CVesting: wrong amount");
            await expect(vesting.claim(earlyAdoptors, ethers.parseEther('1'))).to.changeEtherBalances([vesting, earlyAdoptors], [-ethers.parseEther('1'), ethers.parseEther('1')]);
            assert.equal(await vesting.pending(earlyAdoptors), ethers.parseEther('5127000') - ethers.parseEther('1'));

            // didn't claim at previous period
            await time.increase(time.duration.years(2));
            assert.equal(await vesting.pending(team), ethers.parseEther('1800000'));

            assert.equal(await vesting.pending(owner), 0);
        })

        it("Other branches", async ()=> {
            await expect(ethers.deployContract("CratD2CVesting", [ZERO_ADDRESS])).to.be.revertedWith("CratD2CVesting: 0x00");
        })
    })
})