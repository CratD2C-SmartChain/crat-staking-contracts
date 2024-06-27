const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect, assert } = require("chai");
const { ethers, upgrades } = require("hardhat");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  
describe("CratD2CStakeManager", function () {
    async function deployFixture() {
      const [owner, distributor, slashReceiver, validator1, delegator1, validator2, delegator2_1, delegator2_2, swap] = await ethers.getSigners();
  
      const CratD2CStakeManager = await ethers.getContractFactory("CratD2CStakeManager");
      const stakeManager = await upgrades.deployProxy(CratD2CStakeManager, [distributor.address, slashReceiver.address]);

        assert.equal((await stakeManager.settings()).validatorsSettings.minimumThreshold, ethers.parseEther('100000'));
        assert.equal((await stakeManager.settings()).delegatorsSettings.minimumThreshold, ethers.parseEther('1000'));

        await stakeManager.setValidatorsMinimum(ethers.parseEther('100'));
        await stakeManager.setDelegatorsMinimum(ethers.parseEther('10'));
  
      return { owner, distributor, slashReceiver, validator1, delegator1, validator2, delegator2_1, delegator2_2, stakeManager, swap };
    }
  
    describe("Deployment", function () {
      it("Initial storage", async ()=> {
        const { owner, distributor, slashReceiver, stakeManager } = await loadFixture(deployFixture);
  
        assert.equal(await stakeManager.hasRole(await stakeManager.DEFAULT_ADMIN_ROLE(), owner), true);
        assert.equal(await stakeManager.hasRole(await stakeManager.DISTRIBUTOR_ROLE(), distributor), true);
        
        let settings = await stakeManager.settings();
        assert.equal(settings.validatorsLimit, 101);
        assert.equal(settings.slashReceiver, slashReceiver.address);
        assert.equal(settings.validatorsSettings.apr, 1500);
        assert.equal(settings.validatorsSettings.toSlash, ethers.parseEther('100'));
        assert.equal(settings.validatorsSettings.minimumThreshold, ethers.parseEther('100'));
        assert.equal(settings.validatorsSettings.claimCooldown, 86400 * 14);
        assert.equal(settings.validatorsSettings.withdrawCooldown, 86400 * 7);
        assert.equal(settings.delegatorsSettings.apr, 1300);
        assert.equal(settings.delegatorsSettings.toSlash, 500);
        assert.equal(settings.delegatorsSettings.minimumThreshold, ethers.parseEther('10'));
        assert.equal(settings.delegatorsSettings.claimCooldown, 86400 * 30);
        assert.equal(settings.delegatorsSettings.withdrawCooldown, 86400 * 5);

        assert.equal(await stakeManager.totalValidatorsPool(), 0);
        assert.equal(await stakeManager.totalDelegatorsPool(), 0);
        assert.equal(await stakeManager.stoppedValidatorsPool(), 0);
        assert.equal(await stakeManager.stoppedDelegatorsPool(), 0);

        let info = await stakeManager.getActiveValidators();
        assert.equal(info.validators.length, 0);
        assert.equal(info.amounts.length, 0);
      });
    });

    describe("Main logic", function() {
        it("Deposit", async ()=> {
            const { stakeManager, validator1, delegator1, owner } = await loadFixture(deployFixture);

            await expect(stakeManager.connect(validator1).depositAsValidator(0)).to.be.revertedWith("CratD2CStakeManager: wrong input amount");
            await expect(stakeManager.connect(validator1).depositAsValidator(0, {value: ethers.parseEther('1')})).to.be.revertedWith("CratD2CStakeManager: wrong input amount");
            await expect(stakeManager.connect(validator1).depositAsValidator(10001, {value: ethers.parseEther('100')})).to.be.revertedWith("CratD2CStakeManager: too high commission");

            await expect(stakeManager.connect(validator1).depositAsDelegator(validator1)).to.be.revertedWith("CratD2CStakeManager: wrong input amount");
            await expect(stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('1')})).to.be.revertedWith("CratD2CStakeManager: wrong input amount");
            await expect(stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('10')})).to.be.revertedWith("CratD2CStakeManager: wrong validator");

            // becomes a validator
            await stakeManager.connect(validator1).depositAsValidator(500, {value: ethers.parseEther('100')});
            let currentTime = await time.latest();
            await expect(stakeManager.connect(validator1).depositAsDelegator(delegator1, {value: ethers.parseEther('10')})).to.be.revertedWith("CratD2CStakeManager: delegators only");

            let validator1Info = await stakeManager.getValidatorInfo(validator1);
            assert.equal(validator1Info.amount, ethers.parseEther('100'));
            assert.equal(validator1Info.commission, 500);
            assert.equal(validator1Info.lastClaim, currentTime);
            assert.equal(validator1Info.calledForWithdraw, 0);
            assert.equal(validator1Info.fixedReward.apr, 1500);
            assert.equal(validator1Info.fixedReward.lastUpdate, currentTime);
            assert.equal(validator1Info.fixedReward.fixedReward, 0);
            assert.equal(validator1Info.variableReward, 0);
            assert.equal(validator1Info.delegatedAmount, 0);
            assert.equal(validator1Info.stoppedDelegatedAmount, 0);
            assert.equal(validator1Info.delegatorsAcc, 0);
            assert.equal(validator1Info.delegators.length, 0);

            validator1Info = await stakeManager.getActiveValidators();
            assert.equal(validator1Info.validators.length, 1);
            assert.equal(validator1Info.validators[0], validator1.address);
            assert.equal(validator1Info.amounts.length, 1);
            assert.equal(validator1Info.amounts[0].length, 3);
            assert.equal(validator1Info.amounts[0][0], ethers.parseEther('100'));
            assert.equal(validator1Info.amounts[0][1], 0);
            assert.equal(validator1Info.amounts[0][2], 0);

            assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('100'));

            await expect(stakeManager.connect(validator1).claim()).to.be.revertedWith("CratD2CStakeManager: not enough coins for fixed rewards");
            await owner.sendTransaction({value:ethers.parseEther('100'), to:stakeManager.target});
            await expect(stakeManager.connect(validator1).claim()).to.be.revertedWith("CratD2CStakeManager: claim cooldown");
            await expect(stakeManager.connect(delegator1).claim()).to.be.revertedWith("CratD2CStakeManager: not registered");
            await expect(stakeManager.connect(validator1).restake()).to.be.revertedWith("CratD2CStakeManager: claim cooldown");
            await expect(stakeManager.connect(delegator1).restake()).to.be.revertedWith("CratD2CStakeManager: not registered");

            // increase validators deposit
            await expect(stakeManager.connect(validator1).depositAsValidator(4, {value: ethers.parseEther('1')})).to.changeEtherBalances([stakeManager, validator1], [ethers.parseEther('1'), -ethers.parseEther('1')]);
            let currentTime2 = await time.latest();
            validator1Info = await stakeManager.getValidatorInfo(validator1);
            assert.equal(validator1Info.amount, ethers.parseEther('101'));
            assert.equal(validator1Info.commission, 500);
            assert.equal(validator1Info.lastClaim, currentTime);
            assert.equal(validator1Info.calledForWithdraw, 0);
            assert.equal(validator1Info.fixedReward.apr, 1500);
            assert.equal(validator1Info.fixedReward.lastUpdate, currentTime2);
            let fixedValidatorReward = BigInt(currentTime2 - currentTime) * ethers.parseEther('100') * BigInt(15) / BigInt(100) / BigInt(365 * 86400);
            assert.equal(validator1Info.fixedReward.fixedReward, fixedValidatorReward);
            assert.equal(validator1Info.variableReward, 0);
            assert.equal(validator1Info.delegatedAmount, 0);
            assert.equal(validator1Info.stoppedDelegatedAmount, 0);
            assert.equal(validator1Info.delegatorsAcc, 0);
            assert.equal(validator1Info.delegators.length, 0);
            assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('101'));

            // becomes a delegator
            await expect(stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('10')})).to.changeEtherBalances([stakeManager, delegator1], [ethers.parseEther('10'), -ethers.parseEther('10')]);
            currentTime = await time.latest();
            let delegator1Info = await stakeManager.getDelegatorInfo(delegator1);
            assert.equal(delegator1Info.validator, validator1.address);
            assert.equal(delegator1Info.amount, ethers.parseEther('10'));
            assert.equal(delegator1Info.lastClaim, currentTime);
            assert.equal(delegator1Info.calledForWithdraw, 0);
            assert.equal(delegator1Info.fixedReward.apr, 1300);
            assert.equal(delegator1Info.fixedReward.lastUpdate, currentTime);
            assert.equal(delegator1Info.fixedReward.fixedReward, 0);
            assert.equal(delegator1Info.variableReward.storedAcc, 0);
            assert.equal(delegator1Info.variableReward.variableReward, 0);
            assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('10'));
            validator1Info = await stakeManager.getValidatorInfo(validator1);
            assert.equal(validator1Info.delegatedAmount, ethers.parseEther('10'));
            assert.equal(validator1Info.stoppedDelegatedAmount, 0);
            assert.equal(validator1Info.delegatorsAcc, 0);
            assert.equal(validator1Info.delegators.length, 1);
            assert.equal(validator1Info.delegators[0], delegator1.address);
            validator1Info = await stakeManager.getActiveValidators();
            assert.equal(validator1Info.validators.length, 1);
            assert.equal(validator1Info.validators[0], validator1.address);
            assert.equal(validator1Info.amounts.length, 1);
            assert.equal(validator1Info.amounts[0].length, 3);
            assert.equal(validator1Info.amounts[0][0], ethers.parseEther('101'));
            assert.equal(validator1Info.amounts[0][1], ethers.parseEther('10'));
            assert.equal(validator1Info.amounts[0][2], 0);

            fixedValidatorReward += BigInt(currentTime - currentTime2) * ethers.parseEther('101') * BigInt(15) / BigInt(100) / BigInt(365 * 86400);

            // increase delegators deposit (validator change is forbidden)
            await stakeManager.connect(delegator1).depositAsDelegator(delegator1, {value: ethers.parseEther('1')});
            currentTime2 = await time.latest();
            delegator1Info = await stakeManager.getDelegatorInfo(delegator1);
            assert.equal(delegator1Info.validator, validator1.address);
            assert.equal(delegator1Info.amount, ethers.parseEther('11'));
            assert.equal(delegator1Info.lastClaim, currentTime);
            assert.equal(delegator1Info.calledForWithdraw, 0);
            assert.equal(delegator1Info.fixedReward.apr, 1300);
            assert.equal(delegator1Info.fixedReward.lastUpdate, currentTime2);
            assert.equal(delegator1Info.fixedReward.fixedReward, BigInt(currentTime2 - currentTime) * BigInt(13) * ethers.parseEther('10') / BigInt(100) / BigInt(365*86400));
            assert.equal(delegator1Info.variableReward.storedAcc, 0);
            assert.equal(delegator1Info.variableReward.variableReward, 0);
            assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('11'));

            fixedValidatorReward += BigInt(currentTime2 - currentTime) * ethers.parseEther('101') * BigInt(15) / BigInt(100) / BigInt(365 * 86400);

            assert.equal((await stakeManager.validatorEarned(validator1))[0], fixedValidatorReward);
            assert.equal((await stakeManager.validatorEarned(validator1))[1], 0);
            assert.equal((await stakeManager.delegatorEarned(delegator1))[0], delegator1Info.fixedReward.fixedReward);
            assert.equal((await stakeManager.delegatorEarned(delegator1))[1], 0);

            await expect(stakeManager.connect(delegator1).claim()).to.be.revertedWith("CratD2CStakeManager: claim cooldown");
            await expect(stakeManager.connect(delegator1).restake()).to.be.revertedWith("CratD2CStakeManager: claim cooldown");
            await expect(stakeManager.connect(delegator1).depositAsValidator(0, {value: ethers.parseEther('100')})).to.be.revertedWith("CratD2CStakeManager: validators only");

            await expect(stakeManager.connect(validator1).withdrawExcessFixedReward(ethers.parseEther('200'))).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount")
            await expect(stakeManager.withdrawExcessFixedReward(ethers.parseEther('200'))).to.be.revertedWith("CratD2CStakeManager: not enough coins");
            await expect(stakeManager.withdrawExcessFixedReward(ethers.parseEther('100'))).to.changeEtherBalances([stakeManager, owner], [-ethers.parseEther('100'), ethers.parseEther('100')]);
        })

        it("Distribute rewards & claim", async ()=> {
            const { stakeManager, validator1, delegator1, delegator2_1, distributor } = await loadFixture(deployFixture);

            await expect(stakeManager.distributeRewards([], [])).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount");
            await expect(stakeManager.connect(distributor).distributeRewards([], [])).to.be.revertedWith("CratD2CStakeManager: wrong length");
            await expect(stakeManager.connect(distributor).distributeRewards([validator1], [])).to.be.revertedWith("CratD2CStakeManager: wrong length");

            await expect(stakeManager.connect(distributor).distributeRewards([validator1], [ethers.parseEther('1')], {value: ethers.parseEther('1')})).to.changeEtherBalances([stakeManager, distributor], [0,0]);

            // create validator
            await stakeManager.connect(validator1).depositAsValidator(500, {value: ethers.parseEther('100')});
            let v1Start = await time.latest();

            await expect(stakeManager.connect(distributor).distributeRewards([validator1], [ethers.parseEther('1')])).to.be.revertedWith("CratD2CStakeManager: not enough coins");
            await expect(stakeManager.connect(distributor).distributeRewards([validator1], [ethers.parseEther('1')], {value:ethers.parseEther('1')})).to.changeEtherBalances([stakeManager, distributor],[ethers.parseEther('1'), -ethers.parseEther('1')]);

            let validatorInfo = await stakeManager.getValidatorInfo(validator1);
            let v1VariableReward = ethers.parseEther('1');
            assert.equal(validatorInfo.variableReward, v1VariableReward);
            assert.equal(validatorInfo.delegatorsAcc, 0);
            assert.equal((await stakeManager.validatorEarned(validator1))[0], BigInt(await time.latest() - v1Start) * ethers.parseEther('100') * BigInt(15) / BigInt(100*86400*365));
            assert.equal((await stakeManager.validatorEarned(validator1))[1], v1VariableReward);

            // create delegator
            await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('10')});
            let d1Start = await time.latest();

            await stakeManager.connect(distributor).distributeRewards([validator1, delegator1], [ethers.parseEther('1'), ethers.parseEther('1')], {value: ethers.parseEther('1')});
            validatorInfo = await stakeManager.getValidatorInfo(validator1);
            let d1VariableReward  = ethers.parseEther('1') / BigInt(20);
            assert.equal(validatorInfo.delegatorsAcc, d1VariableReward * ethers.parseEther('1') / ethers.parseEther('10'));
            v1VariableReward += ethers.parseEther('1') - d1VariableReward;
            assert.equal((await stakeManager.validatorEarned(validator1))[1], v1VariableReward);
            assert.equal((await stakeManager.delegatorEarned(delegator1))[0], BigInt(await time.latest() - d1Start) * ethers.parseEther('10') * BigInt(13) / BigInt(100*86400*365));
            assert.equal((await stakeManager.delegatorEarned(delegator1))[1], d1VariableReward);

            // add another delegator
            await stakeManager.connect(delegator2_1).depositAsDelegator(validator1, {value: ethers.parseEther('40')});
            let d2Start = await time.latest();
            let delegatorInfo = await stakeManager.getDelegatorInfo(delegator2_1);
            assert.equal(delegatorInfo.variableReward.storedAcc, validatorInfo.delegatorsAcc);

            await stakeManager.connect(distributor).distributeRewards([validator1], [ethers.parseEther('1')], {value: ethers.parseEther('1')});
            let fee = ethers.parseEther('1') / BigInt(20);
            assert.equal((await stakeManager.getValidatorInfo(validator1)).delegatorsAcc, validatorInfo.delegatorsAcc + fee * ethers.parseEther('1') / ethers.parseEther('50'));
            v1VariableReward += ethers.parseEther('1') - fee;
            d1VariableReward += fee / BigInt(5);
            let d2VariableReward = fee * BigInt(4) / BigInt(5);
            assert.equal((await stakeManager.validatorEarned(validator1))[1], v1VariableReward);
            assert.equal((await stakeManager.delegatorEarned(delegator1))[1], d1VariableReward);
            assert.equal((await stakeManager.delegatorEarned(delegator2_1))[0], BigInt(await time.latest() - d2Start) * ethers.parseEther('40') * BigInt(13) / BigInt(100*86400*365));
            assert.equal((await stakeManager.delegatorEarned(delegator2_1))[1], d2VariableReward);

            // validator claim
            await time.increase(time.duration.days(14));

            await expect(stakeManager.connect(validator1).claim()).to.be.revertedWith("CratD2CStakeManager: not enough coins for fixed rewards");
            let fixedReward = BigInt(await time.latest() + 2 - v1Start) * ethers.parseEther('100') * BigInt(15) / BigInt(100 * 86400 * 365);
            await distributor.sendTransaction({value: fixedReward, to: stakeManager.target});
            await expect(stakeManager.connect(validator1).claim()).to.changeEtherBalances([validator1, stakeManager], [v1VariableReward + fixedReward, -(v1VariableReward + fixedReward)]);
            v1Start = await time.latest();
            assert.equal((await stakeManager.validatorEarned(validator1))[0], 0);
            assert.equal((await stakeManager.validatorEarned(validator1))[1], 0);
            validatorInfo = await stakeManager.getValidatorInfo(validator1);
            assert.equal(validatorInfo.variableReward, 0);
            assert.equal(validatorInfo.fixedReward.fixedReward, 0);
            assert.equal(validatorInfo.fixedReward.lastUpdate, v1Start);
            assert.equal(validatorInfo.lastClaim, v1Start);
            await validator1.sendTransaction({to:stakeManager.target, value: ethers.parseEther('100')});
            await expect(stakeManager.connect(validator1).claim()).to.be.revertedWith("CratD2CStakeManager: claim cooldown");
            await stakeManager.withdrawExcessFixedReward(ethers.parseEther('100'));

            await time.increase(time.duration.days(14));
            // validator restake
            await expect(stakeManager.connect(validator1).restake()).to.be.revertedWith("CratD2CStakeManager: not enough coins for fixed rewards");
            fixedReward = BigInt(await time.latest() + 2 - v1Start) * ethers.parseEther('100') * BigInt(15) / BigInt(100 * 86400 * 365);
            await distributor.sendTransaction({value: fixedReward, to: stakeManager.target});
            await expect(stakeManager.connect(validator1).restake()).to.changeEtherBalances([validator1, stakeManager], [0,0]);
            v1Start = await time.latest();
            validatorInfo = await stakeManager.getValidatorInfo(validator1);
            assert.equal(validatorInfo.amount, ethers.parseEther('100') + fixedReward);
            assert.equal(validatorInfo.commission, 500);
            assert.equal(validatorInfo.lastClaim, v1Start);
            assert.equal(validatorInfo.calledForWithdraw, 0);
            assert.equal(validatorInfo.fixedReward.apr, 1500);
            assert.equal(validatorInfo.fixedReward.lastUpdate, v1Start);
            assert.equal(validatorInfo.fixedReward.fixedReward, 0);
            assert.equal(validatorInfo.variableReward, 0);
            assert.equal(await stakeManager.totalValidatorsPool(), validatorInfo.amount);

            await time.increase(time.duration.days(2));

            // delegator claim
            await expect(stakeManager.connect(delegator1).claim()).to.be.revertedWith("CratD2CStakeManager: not enough coins for fixed rewards");
            fixedReward = BigInt(await time.latest() + 2 - d1Start) * ethers.parseEther('10') * BigInt(13) / BigInt(100 * 86400 * 365);
            await distributor.sendTransaction({value: fixedReward, to: stakeManager.target});
            await expect(stakeManager.connect(delegator1).claim()).to.changeEtherBalances([delegator1, stakeManager], [fixedReward + d1VariableReward, -(fixedReward + d1VariableReward)]);
            d1Start = await time.latest();
            delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);
            assert.equal(delegatorInfo.amount, ethers.parseEther('10'));
            assert.equal(delegatorInfo.lastClaim, d1Start);
            assert.equal(delegatorInfo.fixedReward.lastUpdate, d1Start);
            assert.equal(delegatorInfo.fixedReward.fixedReward, 0);
            assert.equal(delegatorInfo.variableReward.variableReward, 0);
            assert.equal(delegatorInfo.variableReward.storedAcc, validatorInfo.delegatorsAcc);
            assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('50'));
            assert.equal((await stakeManager.delegatorEarned(delegator1))[0], 0);
            assert.equal((await stakeManager.delegatorEarned(delegator1))[1], 0);
            await validator1.sendTransaction({value: ethers.parseEther('100'), to: stakeManager.target});
            await expect(stakeManager.connect(delegator1).claim()).to.be.revertedWith("CratD2CStakeManager: claim cooldown");
            await expect(stakeManager.connect(delegator1).restake()).to.be.revertedWith("CratD2CStakeManager: claim cooldown");
            await stakeManager.withdrawExcessFixedReward(ethers.parseEther('100'));

            // delegator restake
            await expect(stakeManager.connect(delegator2_1).restake()).to.be.revertedWith("CratD2CStakeManager: not enough coins for fixed rewards");
            fixedReward = BigInt(await time.latest() + 2 - d2Start) * ethers.parseEther('40') * BigInt(13) / BigInt(100 * 86400 * 365);
            await distributor.sendTransaction({value: fixedReward, to: stakeManager.target});
            await expect(stakeManager.connect(delegator2_1).restake()).to.changeEtherBalances([stakeManager, delegator2_1], [0,0]);
            d2Start = await time.latest();
            delegatorInfo = await stakeManager.getDelegatorInfo(delegator2_1);
            assert.equal(delegatorInfo.amount, ethers.parseEther('40') + fixedReward + d2VariableReward);
            assert.equal(delegatorInfo.lastClaim, d2Start);
            assert.equal(delegatorInfo.fixedReward.lastUpdate, d2Start);
            assert.equal(delegatorInfo.fixedReward.fixedReward, 0);
            assert.equal(delegatorInfo.variableReward.variableReward, 0);
            assert.equal(delegatorInfo.variableReward.storedAcc, validatorInfo.delegatorsAcc);
            assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('50') + fixedReward + d2VariableReward);
            assert.equal((await stakeManager.delegatorEarned(delegator2_1))[0], 0);
            assert.equal((await stakeManager.delegatorEarned(delegator2_1))[1], 0);
            await validator1.sendTransaction({value: ethers.parseEther('100'), to: stakeManager.target});
            await expect(stakeManager.connect(delegator2_1).claim()).to.be.revertedWith("CratD2CStakeManager: claim cooldown");
            await expect(stakeManager.connect(delegator2_1).restake()).to.be.revertedWith("CratD2CStakeManager: claim cooldown");
        })

        it("Call for withdraw & withdraw cases", async ()=> {
            const { stakeManager, validator1, validator2, delegator1, delegator2_1, delegator2_2, distributor, owner } = await loadFixture(deployFixture);

            await stakeManager.connect(validator1).depositAsValidator(0,{value: ethers.parseEther('100')});
            let v1Start = await time.latest();
            await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('10')});
            let d1Start = await time.latest();
            await stakeManager.connect(validator2).depositAsValidator(231, {value: ethers.parseEther('200')});
            let v2Start = await time.latest();
            await stakeManager.connect(delegator2_1).depositAsDelegator(validator2, {value: ethers.parseEther('10')});
            let d21Start = await time.latest();
            await stakeManager.connect(delegator2_2).depositAsDelegator(validator2, {value: ethers.parseEther('40')});
            let d22Start = await time.latest();

            assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('300'));
            assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('60'));

            let activeValidators = await stakeManager.getActiveValidators();
            assert.equal(activeValidators.validators.length, 2);
            assert.equal(activeValidators.validators[0], validator1.address);
            assert.equal(activeValidators.validators[1], validator2.address);
            assert.equal(activeValidators.amounts.length, 2);
            assert.equal(activeValidators.amounts[0].length, 3);
            assert.equal(activeValidators.amounts[0][0], ethers.parseEther('100'));
            assert.equal(activeValidators.amounts[0][1], ethers.parseEther('10'));
            assert.equal(activeValidators.amounts[0][2], 0);
            assert.equal(activeValidators.amounts[1].length, 3);
            assert.equal(activeValidators.amounts[1][0], ethers.parseEther('200'));
            assert.equal(activeValidators.amounts[1][1], ethers.parseEther('50'));
            assert.equal(activeValidators.amounts[1][2], 0);

            await time.increase(time.duration.days(30));

            await expect(stakeManager.connect(distributor).distributeRewards([validator2, validator1], [ethers.parseEther('50'), ethers.parseEther('30')], {value: ethers.parseEther('100')})).to.changeEtherBalances([stakeManager, distributor], [ethers.parseEther('80'), -ethers.parseEther('80')]);
            let fee = ethers.parseEther('50') * BigInt(231) / BigInt(10000);
            let currentTime = await time.latest();
            let v2Earned = await stakeManager.validatorEarned(validator2);
            let v1Earned = await stakeManager.validatorEarned(validator1);
            let d21Earned = await stakeManager.delegatorEarned(delegator2_1);
            let d22Earned = await stakeManager.delegatorEarned(delegator2_2);
            let d1Earned = await stakeManager.delegatorEarned(delegator1);
            assert.equal(v2Earned[0], BigInt(currentTime - v2Start) * BigInt(15) * ethers.parseEther('200') / BigInt(86400*365*100));
            assert.equal(v2Earned[1], ethers.parseEther('50') - fee);
            assert.equal(d21Earned[0], BigInt(currentTime - d21Start) * BigInt(13) * ethers.parseEther('10') / BigInt(86400*365*100));
            assert.equal(d21Earned[1], fee / BigInt(5));
            assert.equal(d22Earned[0], BigInt(currentTime - d22Start) * BigInt(13) * ethers.parseEther('40') / BigInt(86400*365*100));
            assert.equal(d22Earned[1], fee * BigInt(4) / BigInt(5));
            assert.equal(v1Earned[0], BigInt(currentTime - v1Start) * BigInt(15) * ethers.parseEther('100') / BigInt(86400*365*100));
            assert.equal(v1Earned[1], ethers.parseEther('30'));
            assert.equal(d1Earned[0], BigInt(currentTime - d1Start) * BigInt(13) * ethers.parseEther('10') / BigInt(86400*365*100));
            assert.equal(d1Earned[1], 0);

            // delegator call for withdraw
            await expect(stakeManager.connect(validator1).withdrawAsValidator()).to.be.revertedWith("CratD2CStakeManager: withdraw cooldown");
            await expect(stakeManager.connect(delegator1).withdrawAsDelegator()).to.be.revertedWith("CratD2CStakeManager: no call for withdraw");
            await expect(stakeManager.connect(validator1).delegatorCallForWithdraw()).to.be.revertedWith("CratD2CStakeManager: not active delegator");
            await expect(stakeManager.connect(delegator1).validatorCallForWithdraw()).to.be.revertedWith("CratD2CStakeManager: not active validator");

            await stakeManager.connect(delegator2_1).delegatorCallForWithdraw();
            let d21CalledForWithdraw = await time.latest();
            assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('50'));
            assert.equal(await stakeManager.stoppedDelegatorsPool(), ethers.parseEther('10'));
            let delegatorInfo = await stakeManager.getDelegatorInfo(delegator2_1);
            assert.equal(delegatorInfo.amount, ethers.parseEther('10'));
            assert.equal(delegatorInfo.validator, validator2.address);
            assert.equal(delegatorInfo.lastClaim, d21Start);
            assert.equal(delegatorInfo.calledForWithdraw, d21CalledForWithdraw);
            assert.equal(delegatorInfo.fixedReward.lastUpdate, d21CalledForWithdraw);
            assert.equal(delegatorInfo.fixedReward.fixedReward, BigInt(d21CalledForWithdraw - d21Start) * BigInt(13) * ethers.parseEther('10') / BigInt(86400*100*365));
            assert.equal(delegatorInfo.variableReward.variableReward, fee / BigInt(5));
            assert.equal(delegatorInfo.variableReward.storedAcc, fee * ethers.parseEther('1') / ethers.parseEther('50'));
            let validatorInfo = await stakeManager.getValidatorInfo(validator2);
            assert.equal(validatorInfo.delegators.length, 2);
            assert.equal(validatorInfo.delegators[0], delegator2_1.address);
            assert.equal(validatorInfo.delegators[1], delegator2_2.address);
            assert.equal(validatorInfo.delegatedAmount, ethers.parseEther('40'));
            assert.equal(validatorInfo.stoppedDelegatedAmount, ethers.parseEther('10'));
            assert.equal((await stakeManager.delegatorEarned(delegator2_1))[0], BigInt(d21CalledForWithdraw - d21Start) * BigInt(13) * ethers.parseEther('10') / BigInt(86400*365*100));
            assert.equal((await stakeManager.delegatorEarned(delegator2_1))[1], d21Earned[1]);
            d21Earned = await stakeManager.delegatorEarned(delegator2_1);

            await time.increase(100);

            // check fixed reward stop increase
            assert.equal((await stakeManager.delegatorEarned(delegator2_1))[0], d21Earned[0]);
            assert.equal((await stakeManager.delegatorEarned(delegator2_1))[1], d21Earned[1]);

            await expect(stakeManager.connect(delegator2_1).delegatorCallForWithdraw()).to.be.revertedWith("CratD2CStakeManager: not active delegator");
            await expect(stakeManager.connect(delegator2_1).withdrawAsDelegator()).to.be.revertedWith("CratD2CStakeManager: withdraw cooldown");
            await expect(stakeManager.connect(delegator2_1).depositAsDelegator(validator2, {value: ethers.parseEther('1')})).to.be.revertedWith("CratD2CStakeManager: in stop list");

            // check still share variable rewards
            await stakeManager.connect(distributor).distributeRewards([validator1, validator2], [ethers.parseEther('10'), ethers.parseEther('20')], {value:ethers.parseEther('30')});
            fee = ethers.parseEther('20') * BigInt(231) / BigInt(10000);
            currentTime = await time.latest();
            assert.equal((await stakeManager.validatorEarned(validator2))[0], BigInt(currentTime - v2Start) * BigInt(15) * ethers.parseEther('200') / BigInt(86400*365*100));
            assert.equal((await stakeManager.validatorEarned(validator2))[1], v2Earned[1] + ethers.parseEther('20') - fee);
            assert.equal((await stakeManager.delegatorEarned(delegator2_1))[0], d21Earned[0]);
            assert.equal((await stakeManager.delegatorEarned(delegator2_1))[1], d21Earned[1] + fee / BigInt(5));
            assert.equal((await stakeManager.delegatorEarned(delegator2_2))[0], BigInt(currentTime - d22Start) * BigInt(13) * ethers.parseEther('40') / BigInt(86400*365*100));
            assert.equal((await stakeManager.delegatorEarned(delegator2_2))[1], d22Earned[1] + fee * BigInt(4) / BigInt(5));
            assert.equal((await stakeManager.validatorEarned(validator1))[0], BigInt(currentTime - v1Start) * BigInt(15) * ethers.parseEther('100') / BigInt(86400*365*100));
            assert.equal((await stakeManager.validatorEarned(validator1))[1], v1Earned[1] + ethers.parseEther('10'));
            assert.equal((await stakeManager.delegatorEarned(delegator1))[0], BigInt(currentTime - d1Start) * BigInt(13) * ethers.parseEther('10') / BigInt(86400*365*100));
            assert.equal((await stakeManager.delegatorEarned(delegator1))[1], 0);

            v2Earned = await stakeManager.validatorEarned(validator2);
            v1Earned = await stakeManager.validatorEarned(validator1);
            d21Earned = await stakeManager.delegatorEarned(delegator2_1);
            d22Earned = await stakeManager.delegatorEarned(delegator2_2);
            d1Earned = await stakeManager.delegatorEarned(delegator1);

            // validator call for withdraw
            await stakeManager.connect(validator2).validatorCallForWithdraw();
            let v2CalledForWithdraw = await time.latest();
            validatorInfo = await stakeManager.getValidatorInfo(validator2);
            assert.equal(validatorInfo.calledForWithdraw, v2CalledForWithdraw);
            assert.equal(validatorInfo.delegatedAmount, 0);
            assert.equal(validatorInfo.stoppedDelegatedAmount, ethers.parseEther('50'));
            assert.equal(validatorInfo.delegators.length, 2);
            assert.equal(validatorInfo.fixedReward.lastUpdate, v2CalledForWithdraw);
            assert.equal(validatorInfo.fixedReward.fixedReward, BigInt(v2CalledForWithdraw - v2Start) * BigInt(15) * ethers.parseEther('200') / BigInt(86400*100*365));
            assert.equal(validatorInfo.variableReward, v2Earned[1]);
            assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('10'));
            assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('100'));
            assert.equal(await stakeManager.stoppedDelegatorsPool(), ethers.parseEther('50'));
            assert.equal(await stakeManager.stoppedValidatorsPool(), ethers.parseEther('200'));
            activeValidators = await stakeManager.getActiveValidators();
            assert.equal(activeValidators.validators.length, 1);
            assert.equal(activeValidators.validators[0], validator1.address);
            assert.equal(activeValidators.amounts.length, 1);
            assert.equal(activeValidators.amounts[0].length, 3);
            assert.equal(activeValidators.amounts[0][0], ethers.parseEther('100'));
            assert.equal(activeValidators.amounts[0][1], ethers.parseEther('10'));
            assert.equal(activeValidators.amounts[0][2], 0);
            let stoppedValidatorsPool = await stakeManager.getStoppedValidators();
            assert.equal(stoppedValidatorsPool.validators.length, 1);
            assert.equal(stoppedValidatorsPool.validators[0], validator2.address);
            assert.equal(stoppedValidatorsPool.amounts.length, 1);
            assert.equal(stoppedValidatorsPool.amounts[0].length, 3);
            assert.equal(stoppedValidatorsPool.amounts[0][0], ethers.parseEther('200'));
            assert.equal(stoppedValidatorsPool.amounts[0][1], 0);
            assert.equal(stoppedValidatorsPool.amounts[0][2], ethers.parseEther('50'));

            v2Earned = await stakeManager.validatorEarned(validator2);
            assert.equal(v2Earned[0], validatorInfo.fixedReward.fixedReward);
            assert.equal(v2Earned[1], validatorInfo.variableReward);

            // check stop fixed reward increase
            await time.increase(100);
            assert.equal((await stakeManager.validatorEarned(validator2))[0], validatorInfo.fixedReward.fixedReward);
            assert.equal((await stakeManager.validatorEarned(validator2))[1], validatorInfo.variableReward);
            assert.equal((await stakeManager.delegatorEarned(delegator2_1))[0], d21Earned[0]);
            assert.equal((await stakeManager.delegatorEarned(delegator2_1))[1], d21Earned[1]);
            assert.equal((await stakeManager.delegatorEarned(delegator2_2))[0], BigInt(v2CalledForWithdraw - d22Start) * BigInt(13) * ethers.parseEther('40') / BigInt(100*86400*365));
            assert.equal((await stakeManager.delegatorEarned(delegator2_2))[1], d22Earned[1]);

            v2Earned = await stakeManager.validatorEarned(validator2);
            d21Earned = await stakeManager.delegatorEarned(delegator2_1);
            d22Earned = await stakeManager.delegatorEarned(delegator2_2);

            await expect(stakeManager.connect(validator2).validatorCallForWithdraw()).to.be.revertedWith("CratD2CStakeManager: not active validator");
            await expect(stakeManager.connect(validator2).withdrawAsValidator()).to.be.revertedWith("CratD2CStakeManager: withdraw cooldown");
            await expect(stakeManager.connect(validator2).depositAsValidator(0, {value: ethers.parseEther('1')})).to.be.revertedWith("CratD2CStakeManager: in stop list");

            // still earn variable reward
            await stakeManager.connect(distributor).distributeRewards([validator1, validator2], [ethers.parseEther('1'), ethers.parseEther('1')], {value: ethers.parseEther('2')});
            currentTime = await time.latest();
            fee = ethers.parseEther('1') * BigInt(231) / BigInt(10000);
            assert.equal((await stakeManager.validatorEarned(validator2))[0], v2Earned[0]);
            assert.equal((await stakeManager.validatorEarned(validator2))[1], v2Earned[1] + ethers.parseEther('1') - fee);
            assert.equal((await stakeManager.delegatorEarned(delegator2_1))[0], d21Earned[0]);
            assert.equal((await stakeManager.delegatorEarned(delegator2_1))[1], d21Earned[1] + fee / BigInt(5));
            assert.equal((await stakeManager.delegatorEarned(delegator2_2))[0], d22Earned[0]);
            assert.equal((await stakeManager.delegatorEarned(delegator2_2))[1], d22Earned[1] + fee * BigInt(4) / BigInt(5));

            assert.equal((await stakeManager.validatorEarned(validator1))[0], BigInt(currentTime - v1Start) * BigInt(15) * ethers.parseEther('100') / BigInt(86400*100*365));
            assert.equal((await stakeManager.validatorEarned(validator1))[1], v1Earned[1] + ethers.parseEther('1'));
            assert.equal((await stakeManager.delegatorEarned(delegator1))[0], BigInt(currentTime - d1Start) * ethers.parseEther('10') * BigInt(13) / BigInt(86400*100*365));
            assert.equal((await stakeManager.delegatorEarned(delegator1))[1], 0);

            v2Earned = await stakeManager.validatorEarned(validator2);
            v1Earned = await stakeManager.validatorEarned(validator1);
            d21Earned = await stakeManager.delegatorEarned(delegator2_1);
            d22Earned = await stakeManager.delegatorEarned(delegator2_2);
            d1Earned = await stakeManager.delegatorEarned(delegator1);

            assert.equal(await stakeManager.forFixedReward(), 0);
            await owner.sendTransaction({to: stakeManager.target, value: ethers.parseEther('100')});
            assert.equal(await stakeManager.forFixedReward(), ethers.parseEther('100'));
            await expect(stakeManager.connect(validator2).claim()).to.changeEtherBalances([stakeManager, validator2], [-(v2Earned[0] + v2Earned[1]), v2Earned[0] + v2Earned[1]]);
            let fixedRewardPool = await stakeManager.forFixedReward();
            assert.equal(fixedRewardPool, ethers.parseEther('100') - v2Earned[0]);
            assert.equal((await stakeManager.validatorEarned(validator2))[0], 0);
            assert.equal((await stakeManager.validatorEarned(validator2))[1], 0);

            await time.increase(time.duration.days(14));
            await expect(stakeManager.connect(validator2).restake()).to.be.revertedWith("CratD2CStakeManager: nothing to restake");
            await expect(stakeManager.connect(validator2).claim()).to.changeEtherBalances([stakeManager, validator2], [0,0]);

            // delegator withdraw
            await expect(stakeManager.connect(delegator2_1).withdrawAsDelegator()).to.changeEtherBalances([stakeManager, delegator2_1], [-(ethers.parseEther('10') + d21Earned[0] + d21Earned[1]), ethers.parseEther('10') + d21Earned[0] + d21Earned[1]]);
            delegatorInfo = await stakeManager.getDelegatorInfo(delegator2_1);
            assert.equal(delegatorInfo.validator, ZERO_ADDRESS);
            assert.equal(delegatorInfo.amount, 0);
            assert.equal(delegatorInfo.lastClaim, 0);
            assert.equal(delegatorInfo.calledForWithdraw, 0);
            assert.equal(delegatorInfo.fixedReward.apr, 0);
            assert.equal(delegatorInfo.fixedReward.lastUpdate, 0);
            assert.equal(delegatorInfo.fixedReward.fixedReward, 0);
            assert.equal(delegatorInfo.variableReward.variableReward, 0);
            assert.equal(delegatorInfo.variableReward.storedAcc, 0);

            assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('10'));
            assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('100'));
            assert.equal(await stakeManager.stoppedDelegatorsPool(), ethers.parseEther('40'));
            assert.equal(await stakeManager.stoppedValidatorsPool(), ethers.parseEther('200'));

            validatorInfo = await stakeManager.getValidatorInfo(validator2);
            assert.equal(validatorInfo.delegatedAmount, 0);
            assert.equal(validatorInfo.stoppedDelegatedAmount, ethers.parseEther('40'));
            assert.equal(validatorInfo.delegators.length, 1);
            assert.equal(validatorInfo.delegators[0], delegator2_2.address);

            // validator withdraw (and his delegators)
            await expect(stakeManager.connect(validator2).withdrawAsValidator()).to.changeEtherBalances([validator2, delegator2_2, stakeManager], [ethers.parseEther('200'), ethers.parseEther('40') + d22Earned[0] + d22Earned[1], -(ethers.parseEther('240') + d22Earned[0] + d22Earned[1])]);
            assert.equal(await stakeManager.forFixedReward(), fixedRewardPool - d22Earned[0] - d21Earned[0]);
            fixedRewardPool = await stakeManager.forFixedReward();
            assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('100'));
            assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('10'));
            assert.equal(await stakeManager.stoppedValidatorsPool(), 0);
            assert.equal(await stakeManager.stoppedDelegatorsPool(), 0);
            stoppedValidatorsPool = await stakeManager.getStoppedValidators();
            assert.equal(stoppedValidatorsPool.validators.length, 0);
            validatorInfo = await stakeManager.getValidatorInfo(validator2);
            assert.equal(validatorInfo.amount, 0);
            assert.equal(validatorInfo.commission, 0);
            assert.equal(validatorInfo.lastClaim, 0);
            assert.equal(validatorInfo.calledForWithdraw, 0);
            assert.equal(validatorInfo.fixedReward.fixedReward, 0);
            assert.equal(validatorInfo.fixedReward.apr, 0);
            assert.equal(validatorInfo.fixedReward.lastUpdate, 0);
            assert.equal(validatorInfo.variableReward, 0);
            assert.equal(validatorInfo.delegatedAmount, 0);
            assert.equal(validatorInfo.stoppedDelegatedAmount, 0);
            assert.equal(validatorInfo.delegatorsAcc, 0);
            delegatorInfo = await stakeManager.getDelegatorInfo(delegator2_2);
            assert.equal(delegatorInfo.validator, ZERO_ADDRESS);
            assert.equal(delegatorInfo.amount, 0);
            assert.equal(delegatorInfo.lastClaim, 0);
            assert.equal(delegatorInfo.calledForWithdraw, 0);
            assert.equal(delegatorInfo.fixedReward.apr, 0);
            assert.equal(delegatorInfo.fixedReward.lastUpdate, 0);
            assert.equal(delegatorInfo.fixedReward.fixedReward, 0);
            assert.equal(delegatorInfo.variableReward.variableReward, 0);
            assert.equal(delegatorInfo.variableReward.storedAcc, 0);

            // close validators limit
            await expect(stakeManager.connect(validator1).setValidatorsLimit(0)).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount");
            await stakeManager.setValidatorsLimit(1);
            await expect(stakeManager.connect(validator2).depositAsValidator(0, {value: ethers.parseEther('100')})).to.be.revertedWith("CratD2CStakeManager: limit reached");

            await stakeManager.connect(validator1).validatorCallForWithdraw();
            let v1CalledForWithdraw = await time.latest();
            await time.increase(time.duration.days(5));

            await expect(stakeManager.connect(validator1).withdrawAsValidator()).to.be.revertedWith("CratD2CStakeManager: withdraw cooldown");
            let fixedReward = BigInt(v1CalledForWithdraw - d1Start) * BigInt(13) * ethers.parseEther('10') / BigInt(100*86400*365);
            await expect(stakeManager.connect(delegator1).withdrawAsDelegator()).to.changeEtherBalances([delegator1, stakeManager], [ethers.parseEther('10') + d1Earned[1] + fixedReward, -(ethers.parseEther('10') + d1Earned[1] + fixedReward)]);
            assert.equal(await stakeManager.forFixedReward(), fixedRewardPool - fixedReward);
            delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);
            assert.equal(delegatorInfo.validator, ZERO_ADDRESS);
            assert.equal(delegatorInfo.amount, 0);
            assert.equal(delegatorInfo.lastClaim, 0);
            assert.equal(delegatorInfo.calledForWithdraw, 0);
            assert.equal(delegatorInfo.fixedReward.apr, 0);
            assert.equal(delegatorInfo.fixedReward.lastUpdate, 0);
            assert.equal(delegatorInfo.fixedReward.fixedReward, 0);
            assert.equal(delegatorInfo.variableReward.variableReward, 0);
            assert.equal(delegatorInfo.variableReward.storedAcc, 0);
            validatorInfo = await stakeManager.getValidatorInfo(validator1);
            assert.equal(validatorInfo.delegatedAmount, 0);
            assert.equal(validatorInfo.stoppedDelegatedAmount, 0);
            assert.equal(validatorInfo.delegators.length, 0);
            assert.equal(await stakeManager.totalValidatorsPool(), 0);
            assert.equal(await stakeManager.stoppedValidatorsPool(), ethers.parseEther('100'));
            assert.equal(await stakeManager.totalDelegatorsPool(), 0);
            assert.equal(await stakeManager.stoppedDelegatorsPool(), 0);
            activeValidators = await stakeManager.getActiveValidators();
            assert.equal(activeValidators.validators.length, 0);
            stoppedValidatorsPool = await stakeManager.getStoppedValidators();
            assert.equal(stoppedValidatorsPool.validators.length, 1);
            assert.equal(stoppedValidatorsPool.validators[0], validator1.address);
        })

        it("Slashing mechanism", async ()=> {
          const { stakeManager, validator1, validator2, delegator1, delegator2_1, delegator2_2, distributor, owner, slashReceiver } = await loadFixture(deployFixture);

          await expect(stakeManager.connect(validator1).setValidatorsAmountToSlash(ethers.parseEther('10'))).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount");
          await stakeManager.setValidatorsAmountToSlash(ethers.parseEther('10'));

          await stakeManager.connect(validator1).depositAsValidator(100, {value: ethers.parseEther('100')}); // to be slashed under the threshold
          await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('10')}); // to be slashed under the threshold
          await stakeManager.connect(owner).depositAsDelegator(validator1, {value: ethers.parseEther('20')}); // to be slashed above the threshold

          await stakeManager.connect(validator2).depositAsValidator(200, {value: ethers.parseEther('200')}); // to be slashed above the threshold
          await stakeManager.connect(delegator2_1).depositAsDelegator(validator2, {value: ethers.parseEther('10')}); // to be slashed under the threshold
          await stakeManager.connect(delegator2_2).depositAsDelegator(validator2, {value: ethers.parseEther('20')}); // to be slashed above the threshold

          // distribute rewards
          await stakeManager.connect(distributor).distributeRewards([validator1, validator2],[ethers.parseEther('4'), ethers.parseEther('4')], {value: ethers.parseEther('8')});

          let v1Reward = await stakeManager.validatorEarned(validator1);
          let v2Reward = await stakeManager.validatorEarned(validator2);
          let d1Reward = await stakeManager.delegatorEarned(delegator1);
          let d21Reward = await stakeManager.delegatorEarned(delegator2_1);
          let d22Reward = await stakeManager.delegatorEarned(delegator2_2);
          let ownerReward = await stakeManager.delegatorEarned(owner);

          await expect(stakeManager.slash([])).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount");
          await expect(stakeManager.connect(distributor).slash([owner])).to.changeEtherBalances([stakeManager, slashReceiver], [0,0]);

          let totalSlashed = ethers.parseEther('20') + ethers.parseEther('60') * BigInt(5) / BigInt(100);
          await expect(stakeManager.connect(distributor).slash([validator1, validator2])).to.changeEtherBalances([stakeManager, slashReceiver], [-totalSlashed,totalSlashed]);
          let currentTime = await time.latest();

          let validatorInfo = await stakeManager.getValidatorInfo(validator1);
          assert.equal(validatorInfo.amount , ethers.parseEther('90'));
          assert.equal(validatorInfo.calledForWithdraw, currentTime);
          assert.equal(validatorInfo.fixedReward.fixedReward, v1Reward[0] + BigInt(3) * ethers.parseEther('100') * BigInt(15) / BigInt(100 * 86400 * 365) + BigInt(1));
          assert.equal(validatorInfo.variableReward, v1Reward[1]);

          validatorInfo = await stakeManager.getValidatorInfo(validator2);
          assert.equal(validatorInfo.amount , ethers.parseEther('190'));
          assert.equal(validatorInfo.calledForWithdraw, 0);
          assert.equal(validatorInfo.fixedReward.fixedReward, v2Reward[0] + BigInt(3) * ethers.parseEther('200') * BigInt(15) / BigInt(100 * 86400 * 365) + BigInt(1));
          assert.equal(validatorInfo.variableReward, v2Reward[1]);

          let delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);
          assert.equal(delegatorInfo.amount, ethers.parseEther('10') - ethers.parseEther('10') * BigInt(5) / BigInt(100));
          assert.equal(delegatorInfo.calledForWithdraw, 0);
          assert.equal(delegatorInfo.fixedReward.fixedReward, d1Reward[0] + BigInt(3) * ethers.parseEther('10') * BigInt(13) / BigInt(100 * 86400 * 365) + BigInt(1));
          assert.equal(delegatorInfo.variableReward.variableReward, d1Reward[1]);

          delegatorInfo = await stakeManager.getDelegatorInfo(owner);
          assert.equal(delegatorInfo.amount, ethers.parseEther('20') - ethers.parseEther('20') * BigInt(5) / BigInt(100));
          assert.equal(delegatorInfo.calledForWithdraw, 0);
          assert.equal(delegatorInfo.fixedReward.fixedReward, ownerReward[0] + BigInt(3) * ethers.parseEther('20') * BigInt(13) / BigInt(100 * 86400 * 365));
          assert.equal(delegatorInfo.variableReward.variableReward, ownerReward[1]);

          delegatorInfo = await stakeManager.getDelegatorInfo(delegator2_1);
          assert.equal(delegatorInfo.amount, ethers.parseEther('10') - ethers.parseEther('10') * BigInt(5) / BigInt(100));
          assert.equal(delegatorInfo.calledForWithdraw, currentTime);
          assert.equal(delegatorInfo.fixedReward.fixedReward, d21Reward[0] + BigInt(3) * ethers.parseEther('10') * BigInt(13) / BigInt(100 * 86400 * 365) + BigInt(1));
          assert.equal(delegatorInfo.variableReward.variableReward, d21Reward[1]);

          delegatorInfo = await stakeManager.getDelegatorInfo(delegator2_2);
          assert.equal(delegatorInfo.amount, ethers.parseEther('20') - ethers.parseEther('20') * BigInt(5) / BigInt(100));
          assert.equal(delegatorInfo.calledForWithdraw, 0);
          assert.equal(delegatorInfo.fixedReward.fixedReward, d22Reward[0] + BigInt(3) * ethers.parseEther('20') * BigInt(13) / BigInt(100 * 86400 * 365) + BigInt(1));
          assert.equal(delegatorInfo.variableReward.variableReward, d22Reward[1]);

          assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('190'));
          assert.equal(await stakeManager.totalDelegatorsPool(),ethers.parseEther('19'));
          assert.equal(await stakeManager.stoppedValidatorsPool(), ethers.parseEther('90'));
          assert.equal(await stakeManager.stoppedDelegatorsPool(), ethers.parseEther('38'));

          v1Reward = await stakeManager.validatorEarned(validator1);
          v2Reward = await stakeManager.validatorEarned(validator2);
          d1Reward = await stakeManager.delegatorEarned(delegator1);
          d21Reward = await stakeManager.delegatorEarned(delegator2_1);
          d22Reward = await stakeManager.delegatorEarned(delegator2_2);
          ownerReward = await stakeManager.delegatorEarned(owner);

          await time.increase(time.duration.days(1));

          assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, v1Reward.fixedReward);
          assert.equal((await stakeManager.validatorEarned(validator2)).fixedReward, v2Reward.fixedReward + BigInt(86400) * ethers.parseEther('190') * BigInt(15) / BigInt(86400 * 365 * 100));
          assert.equal((await stakeManager.delegatorEarned(delegator1)).fixedReward, d1Reward.fixedReward);
          assert.equal((await stakeManager.delegatorEarned(owner)).fixedReward, ownerReward.fixedReward);
          assert.equal((await stakeManager.delegatorEarned(delegator2_1)).fixedReward, d21Reward.fixedReward);
          assert.equal((await stakeManager.delegatorEarned(delegator2_2)).fixedReward, d22Reward.fixedReward + BigInt(86400) * ethers.parseEther('19') * BigInt(13) / BigInt(86400 * 365 * 100));

          // another slashing call for already stopped validator (withdraw all of his funds!!!)
          totalSlashed = ethers.parseEther('90') + (ethers.parseEther('9.5') + ethers.parseEther('19')) * BigInt(5) / BigInt(100);
          await stakeManager.setValidatorsAmountToSlash(ethers.parseEther('100'));
          await expect(stakeManager.connect(distributor).slash([validator1])).to.changeEtherBalances([stakeManager, slashReceiver], [-totalSlashed, totalSlashed]);

          validatorInfo = await stakeManager.getValidatorInfo(validator1);
          assert.equal(validatorInfo.amount , 0);
          assert.equal(validatorInfo.calledForWithdraw, currentTime);
          assert.equal(validatorInfo.fixedReward.fixedReward, v1Reward.fixedReward);
          assert.equal(validatorInfo.variableReward, v1Reward.variableReward);

          assert.equal((await stakeManager.validatorEarned(validator1))[0], v1Reward[0]);
          assert.equal((await stakeManager.validatorEarned(validator1))[1], v1Reward[1]);

          delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);
          assert.equal(delegatorInfo.amount, ethers.parseEther('9.5') - ethers.parseEther('9.5') * BigInt(5) / BigInt(100));
          assert.equal(delegatorInfo.calledForWithdraw, 0);
          assert.equal(delegatorInfo.fixedReward.fixedReward, d1Reward[0]);
          assert.equal(delegatorInfo.variableReward.variableReward, d1Reward[1]);

          assert.equal((await stakeManager.delegatorEarned(delegator1))[0], d1Reward[0]);
          assert.equal((await stakeManager.delegatorEarned(delegator1))[1], d1Reward[1]);

          delegatorInfo = await stakeManager.getDelegatorInfo(owner);
          assert.equal(delegatorInfo.amount, ethers.parseEther('19') - ethers.parseEther('19') * BigInt(5) / BigInt(100));
          assert.equal(delegatorInfo.calledForWithdraw, 0);
          assert.equal(delegatorInfo.fixedReward.fixedReward, ownerReward[0]);
          assert.equal(delegatorInfo.variableReward.variableReward, ownerReward[1]);

          assert.equal((await stakeManager.delegatorEarned(owner))[0], ownerReward[0]);
          assert.equal((await stakeManager.delegatorEarned(owner))[1], ownerReward[1]);

          assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('190'));
          assert.equal(await stakeManager.totalDelegatorsPool(),ethers.parseEther('19'));
          assert.equal(await stakeManager.stoppedValidatorsPool(), 0);
          assert.equal(await stakeManager.stoppedDelegatorsPool(), ethers.parseEther('36.575')); // (30*0.95) * 0.95 + 9.5

          await time.increase(time.duration.days(13));
          await owner.sendTransaction({value: v1Reward[0] , to: stakeManager.target});

          // not possible to restake
          await expect(stakeManager.connect(validator1).restake()).to.be.revertedWith("CratD2CStakeManager: in stop list");

          // but possible to claim rewards
          await expect(stakeManager.connect(validator1).claim()).to.changeEtherBalances([stakeManager, validator1], [-v1Reward[0] -v1Reward[1], v1Reward[0] + v1Reward[1]]);
          assert.equal((await stakeManager.validatorEarned(validator1))[0], 0);
          assert.equal((await stakeManager.validatorEarned(validator1))[1], 0);
          assert.equal((await stakeManager.getValidatorInfo(validator1)).lastClaim, await time.latest());
          await expect(stakeManager.connect(validator1).claim()).to.changeEtherBalances([stakeManager, validator1], [0, 0]);
          assert.equal((await stakeManager.getValidatorInfo(validator1)).lastClaim, await time.latest() - 1);

          // await expect(stakeManager.connect(distributor).slash([validator1])).to.changeEtherBalances([stakeManager, slashReceiver], [-ethers.parseEther('1.35375'), ethers.parseEther('1.35375')]); // try to slash validator with 0 amount - passed

          await expect(stakeManager.connect(delegator1).reviveAsDelegator({value: 0})).to.be.revertedWith("CratD2CStakeManager: can not revive"); // under the threshold
          await expect(stakeManager.connect(delegator1).reviveAsDelegator({value: ethers.parseEther('10')})).to.be.revertedWith("CratD2CStakeManager: can not revive"); // validator stopped
          await expect(stakeManager.connect(delegator2_2).reviveAsDelegator({value: ethers.parseEther('10')})).to.be.revertedWith("CratD2CStakeManager: can not revive"); // this delegator didn't call for withdraw

          await expect(stakeManager.connect(delegator1).reviveAsValidator()).to.be.revertedWith("CratD2CStakeManager: no withdraw call");
          await expect(stakeManager.connect(validator2).reviveAsValidator()).to.be.revertedWith("CratD2CStakeManager: no withdraw call");
          await expect(stakeManager.connect(validator1).reviveAsValidator()).to.be.revertedWith("CratD2CStakeManager: too low value");
          await expect(stakeManager.setValidatorsLimit(0)).to.be.revertedWith("CratD2CStakeManager: wrong limit");
          await stakeManager.setValidatorsLimit(1);
          await expect(stakeManager.connect(validator1).reviveAsValidator({value: ethers.parseEther('100')})).to.be.revertedWith("CratD2CStakeManager: limit reached");
          await stakeManager.setValidatorsLimit(101);

          await time.increase(time.duration.days(16)); // claim cooldown for delegators

          await distributor.sendTransaction({to: stakeManager.target, value: ethers.parseEther('100')});
          await expect(stakeManager.connect(delegator1).claim()).to.changeEtherBalances([stakeManager, delegator1], [-(d1Reward[0] + d1Reward[1]), d1Reward[0] + d1Reward[1]]);
          await stakeManager.connect(delegator1).delegatorCallForWithdraw();
          assert.equal((await stakeManager.delegatorEarned(delegator1))[0], 0);
          assert.equal((await stakeManager.delegatorEarned(delegator1))[1], 0);
          assert.equal((await stakeManager.getDelegatorInfo(delegator1)).calledForWithdraw, await time.latest());
          // total balances hasn't been changed (cause this delegator is stopped)
          assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('190'));
          assert.equal(await stakeManager.totalDelegatorsPool(),ethers.parseEther('19'));
          assert.equal(await stakeManager.stoppedValidatorsPool(), 0);
          assert.equal(await stakeManager.stoppedDelegatorsPool(), ethers.parseEther('36.575')); // (30*0.95) * 0.95 + 9.5

          await expect(stakeManager.connect(validator1).withdrawAsValidator()).to.changeEtherBalances([stakeManager, validator1, delegator1, owner], [-(ownerReward[0] + ownerReward[1] + ethers.parseEther('27.075')), 0, ethers.parseEther('9.025'), ownerReward[0] + ownerReward[1] + ethers.parseEther('18.05')]);
        })

        it("Revive mechanics", async ()=> {
          const { stakeManager, validator1, delegator1, delegator2_1, distributor } = await loadFixture(deployFixture);

          await stakeManager.setValidatorsAmountToSlash(ethers.parseEther('10'));

          await stakeManager.connect(validator1).depositAsValidator(100, {value: ethers.parseEther('100')}); // to be slashed under the threshold
          let v1Start = await time.latest();
          await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('10')}); // to be slashed under the threshold
          await stakeManager.connect(delegator2_1).depositAsDelegator(validator1, {value: ethers.parseEther('20')}); // to be slashed above the threshold

          await time.increase(86400);

          await stakeManager.connect(distributor).distributeRewards([validator1], [ethers.parseEther('12')], {value: ethers.parseEther('12')});
          // let currentTime = await time.latest();

          await stakeManager.connect(distributor).slash([validator1]);

          let v1Reward = await stakeManager.validatorEarned(validator1);
          let d1Reward = await stakeManager.delegatorEarned(delegator1);
          let d21Reward = await stakeManager.delegatorEarned(delegator2_1);

          assert.equal((await stakeManager.getValidatorInfo(validator1)).calledForWithdraw, await time.latest());
          assert.equal(await stakeManager.stoppedValidatorsPool(), ethers.parseEther('90'));
          assert.equal(await stakeManager.stoppedDelegatorsPool(), ethers.parseEther('30') * BigInt(95) / BigInt(100));

          await time.increase(86400);

          // one user call for withdraw
          await stakeManager.connect(delegator1).delegatorCallForWithdraw();
          let d1CalledForWithdraw = await time.latest();

          await time.increase(86400);

          await stakeManager.connect(validator1).reviveAsValidator({value: ethers.parseEther('10')});
          assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('100'));
          assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('20') * BigInt(95) / BigInt(100));
          assert.equal(await stakeManager.stoppedValidatorsPool(), 0);
          assert.equal(await stakeManager.stoppedDelegatorsPool(), ethers.parseEther('10') * BigInt(95) / BigInt(100));
          let validatorInfo = await stakeManager.getValidatorInfo(validator1);
          assert.equal(validatorInfo.amount, ethers.parseEther('100'));
          assert.equal(validatorInfo.commission, 100);
          assert.equal(validatorInfo.lastClaim, v1Start);
          assert.equal(validatorInfo.calledForWithdraw, 0);
          assert.equal(validatorInfo.fixedReward.apr, 1500);
          assert.equal(validatorInfo.fixedReward.lastUpdate, await time.latest());
          assert.equal(validatorInfo.fixedReward.fixedReward, v1Reward[0]);
          assert.equal(validatorInfo.variableReward, v1Reward[1]);
          assert.equal(validatorInfo.delegatedAmount, ethers.parseEther('20') * BigInt(95) / BigInt(100));
          assert.equal(validatorInfo.stoppedDelegatedAmount, ethers.parseEther('10') * BigInt(95) / BigInt(100));
          assert.equal(validatorInfo.delegators.length, 2);

          assert.equal((await stakeManager.validatorEarned(validator1))[0], v1Reward[0]);
          assert.equal((await stakeManager.validatorEarned(validator1))[1], v1Reward[1]);

          let delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);
          assert.equal(delegatorInfo.amount, ethers.parseEther('10') * BigInt(95) / BigInt(100));
          assert.equal(delegatorInfo.validator, validator1.address);
          assert.equal(delegatorInfo.lastClaim, v1Start + 1);
          assert.equal(delegatorInfo.calledForWithdraw, d1CalledForWithdraw);
          assert.equal(delegatorInfo.fixedReward.apr, 1300);
          assert.equal(delegatorInfo.fixedReward.lastUpdate, d1CalledForWithdraw);
          assert.equal(delegatorInfo.fixedReward.fixedReward, d1Reward[0]);
          assert.equal(delegatorInfo.variableReward.variableReward, d1Reward[1]);

          assert.equal((await stakeManager.delegatorEarned(delegator1))[0], d1Reward[0]);
          assert.equal((await stakeManager.delegatorEarned(delegator1))[1], d1Reward[1]);

          delegatorInfo = await stakeManager.getDelegatorInfo(delegator2_1);
          assert.equal(delegatorInfo.amount, ethers.parseEther('20') * BigInt(95) / BigInt(100));
          assert.equal(delegatorInfo.validator, validator1.address);
          assert.equal(delegatorInfo.lastClaim, v1Start + 2);
          assert.equal(delegatorInfo.calledForWithdraw, 0);
          assert.equal(delegatorInfo.fixedReward.apr, 1300);
          assert.equal(delegatorInfo.fixedReward.lastUpdate, await time.latest());
          assert.equal(delegatorInfo.fixedReward.fixedReward, d21Reward[0]);
          assert.equal(delegatorInfo.variableReward.variableReward, d21Reward[1]);

          assert.equal((await stakeManager.delegatorEarned(delegator2_1))[0], d21Reward[0]);
          assert.equal((await stakeManager.delegatorEarned(delegator2_1))[1], d21Reward[1]);

          await time.increase(86400);
          assert.equal((await stakeManager.validatorEarned(validator1))[0], v1Reward[0] + ethers.parseEther('100') * BigInt(15) * BigInt(86400) / BigInt(100*86400*365));
          assert.equal((await stakeManager.validatorEarned(validator1))[1], v1Reward[1]);
          assert.equal((await stakeManager.delegatorEarned(delegator1))[0], d1Reward[0]);
          assert.equal((await stakeManager.delegatorEarned(delegator1))[1], d1Reward[1]);
          assert.equal((await stakeManager.delegatorEarned(delegator2_1))[0], d21Reward[0] + (ethers.parseEther('20') * BigInt(95) / BigInt(100)) * BigInt(13) * BigInt(86400) / BigInt(100*86400*365));
          assert.equal((await stakeManager.delegatorEarned(delegator2_1))[1], d21Reward[1]);

          await stakeManager.connect(delegator1).reviveAsDelegator({value: ethers.parseEther('0.5')});
          delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);
          assert.equal(delegatorInfo.amount, ethers.parseEther('10'));
          assert.equal(delegatorInfo.validator, validator1.address);
          assert.equal(delegatorInfo.lastClaim, v1Start + 1);
          assert.equal(delegatorInfo.calledForWithdraw, 0);
          assert.equal(delegatorInfo.fixedReward.apr, 1300);
          assert.equal(delegatorInfo.fixedReward.lastUpdate, await time.latest());
          assert.equal(delegatorInfo.fixedReward.fixedReward, d1Reward[0]);
          assert.equal(delegatorInfo.variableReward.variableReward, d1Reward[1]);
          assert.equal((await stakeManager.delegatorEarned(delegator1))[0], d1Reward[0]);
          assert.equal((await stakeManager.delegatorEarned(delegator1))[1], d1Reward[1]);
          assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('100'));
          assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('10') + ethers.parseEther('20') * BigInt(95) / BigInt(100));
          assert.equal(await stakeManager.stoppedValidatorsPool(), 0);
          assert.equal(await stakeManager.stoppedDelegatorsPool(), 0);
          assert.equal((await stakeManager.getValidatorInfo(validator1)).delegatedAmount, ethers.parseEther('10') + ethers.parseEther('20') * BigInt(95) / BigInt(100));
          assert.equal((await stakeManager.getValidatorInfo(validator1)).stoppedDelegatedAmount, 0);

          await time.increase(86400);

          assert.equal((await stakeManager.delegatorEarned(delegator1))[0], d1Reward[0] + BigInt(86400) * ethers.parseEther('10') * BigInt(13) / BigInt(100*365*86400));
          assert.equal((await stakeManager.delegatorEarned(delegator1))[1], d1Reward[1]);
        })

        it("Other admin methods", async ()=> {
          const { stakeManager, distributor } = await loadFixture(deployFixture);

          await expect(stakeManager.connect(distributor).initialize(ZERO_ADDRESS, ZERO_ADDRESS)).to.be.revertedWithCustomError(stakeManager, "InvalidInitialization");
          await expect(stakeManager.connect(distributor).setSlashReceiver(ZERO_ADDRESS)).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount");
          await expect(stakeManager.connect(distributor).setValidatorsWithdrawCooldown(0)).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount");
          await expect(stakeManager.connect(distributor).setDelegatorsWithdrawCooldown(0)).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount");
          await expect(stakeManager.connect(distributor).setValidatorsMinimum(0)).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount");
          await expect(stakeManager.connect(distributor).setDelegatorsMinimum(0)).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount");
          await expect(stakeManager.connect(distributor).setDelegatorsPercToSlash(0)).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount");
          await expect(stakeManager.connect(distributor).setValidatorsAPR(0)).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount");
          await expect(stakeManager.connect(distributor).setDelegatorsAPR(0)).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount");
          await expect(stakeManager.connect(distributor).setValidatorsClaimCooldown(0)).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount");
          await expect(stakeManager.connect(distributor).setDelegatorsClaimCooldown(0)).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount");

          await expect(stakeManager.setSlashReceiver(ZERO_ADDRESS)).to.be.revertedWith("CratD2CStakeManager: 0x00");
          await expect(stakeManager.setDelegatorsPercToSlash(10001)).to.be.revertedWith("CratD2CStakeManager: wrong percent");

          await stakeManager.setSlashReceiver(distributor);
          await stakeManager.setValidatorsWithdrawCooldown(0);
          await stakeManager.setDelegatorsWithdrawCooldown(0);
          await stakeManager.setDelegatorsPercToSlash(0);
          await stakeManager.setValidatorsAPR(0);
          await stakeManager.setDelegatorsAPR(0);
          await stakeManager.setValidatorsClaimCooldown(0);
          await stakeManager.setDelegatorsClaimCooldown(0);

          let settings = await stakeManager.settings();
          assert.equal(settings.slashReceiver, distributor.address);
          assert.equal(settings.validatorsSettings.apr, 0);
          // assert.equal(settings.validatorsSettings.toSlash, 0); // didn't change
          // assert.equal(settings.validatorsSettings.minimumThreshold, 0); // didn't change
          assert.equal(settings.validatorsSettings.claimCooldown, 0);
          assert.equal(settings.validatorsSettings.withdrawCooldown, 0);
          assert.equal(settings.delegatorsSettings.apr, 0);
          assert.equal(settings.delegatorsSettings.toSlash, 0);
          // assert.equal(settings.delegatorsSettings.minimumThreshold, 0); // didn't change
          assert.equal(settings.delegatorsSettings.claimCooldown, 0);
          assert.equal(settings.delegatorsSettings.withdrawCooldown, 0);
        })

        it("initialize else branches close", async ()=> {
          const {owner} = await loadFixture(deployFixture);

          let StakeManager = await ethers.getContractFactory("CratD2CStakeManager");

          await expect(upgrades.deployProxy(StakeManager, [ZERO_ADDRESS, ZERO_ADDRESS])).to.be.revertedWith("CratD2CStakeManager: 0x00");
          await upgrades.deployProxy(StakeManager, [ZERO_ADDRESS, owner.address]);
        })

        it("Add depositForVaidator method", async ()=> {
          const { stakeManager, validator1, swap, owner } = await loadFixture(deployFixture);

          await expect(stakeManager.depositForValidator(ZERO_ADDRESS, 0, 0)).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount");

          await stakeManager.grantRole(await stakeManager.SWAP_ROLE(), swap.address);

          await expect(stakeManager.connect(swap).depositForValidator(ZERO_ADDRESS, 0, 0)).to.be.revertedWith("CratD2CStakeManager: 0x00");
          await expect(stakeManager.connect(swap).depositForValidator(validator1, 0, 0)).to.be.revertedWith("CratD2CStakeManager: wrong vesting end");
          await expect(stakeManager.connect(swap).depositForValidator(validator1, 0, await time.latest() + 300)).to.be.revertedWith("CratD2CStakeManager: wrong input amount");
          await expect(stakeManager.connect(swap).depositForValidator(validator1, 0, await time.latest() + 300, {value: ethers.parseEther('99.9')})).to.be.revertedWith("CratD2CStakeManager: wrong input amount");
          await stakeManager.setValidatorsLimit(0);
          await expect(stakeManager.connect(swap).depositForValidator(validator1, 0, await time.latest() + 300, {value: ethers.parseEther('100')})).to.be.revertedWith("CratD2CStakeManager: limit reached");
          await stakeManager.setValidatorsLimit(101);

          let vestingEnd = await time.latest() + 86400*30;

          await stakeManager.connect(swap).depositForValidator(validator1, 0, vestingEnd, {value: ethers.parseEther('100')});
          let stakeTime = await time.latest();
          let validatorInfo = await stakeManager.getValidatorInfo(validator1);
          assert.equal(validatorInfo.amount, ethers.parseEther('100'));
          assert.equal(validatorInfo.commission, 0);
          assert.equal(validatorInfo.lastClaim, stakeTime);
          assert.equal(validatorInfo.calledForWithdraw, 0);
          assert.equal(validatorInfo.vestingEnd, vestingEnd);
          assert.equal(validatorInfo.fixedReward.apr, 1500);
          assert.equal(validatorInfo.fixedReward.lastUpdate, stakeTime);
          assert.equal(validatorInfo.fixedReward.fixedReward, 0);
          assert.equal(validatorInfo.variableReward, 0);
          assert.equal(validatorInfo.delegatedAmount, 0);
          assert.equal(validatorInfo.stoppedDelegatedAmount, 0);
          assert.equal(validatorInfo.delegatorsAcc, 0);
          assert.equal(validatorInfo.delegators.length, 0);

          // second deposit for this validator
          await expect(stakeManager.connect(swap).depositForValidator(validator1, 1, vestingEnd - 1)).to.be.revertedWith("CratD2CStakeManager: wrong vesting end");

          await stakeManager.connect(swap).depositForValidator(validator1, 1, vestingEnd + 1, {value: ethers.parseEther('1')});

          validatorInfo = await stakeManager.getValidatorInfo(validator1);
          assert.equal(validatorInfo.amount, ethers.parseEther('101'));
          assert.equal(validatorInfo.commission, 0);
          assert.equal(validatorInfo.lastClaim, stakeTime);
          assert.equal(validatorInfo.calledForWithdraw, 0);
          assert.equal(validatorInfo.vestingEnd, vestingEnd + 1);

          // revert for delegator
          await stakeManager.depositAsDelegator(validator1, {value: ethers.parseEther('10')});
          await expect(stakeManager.connect(swap).depositForValidator(owner, 0, await time.latest() + 300, {value: ethers.parseEther('100')})).to.be.revertedWith("CratD2CStakeManager: validators only");

          // can not early withdraw (till the vesting end)
          await stakeManager.connect(validator1).validatorCallForWithdraw();
          validatorInfo = await stakeManager.getValidatorInfo(validator1);
          assert.equal(validatorInfo.calledForWithdraw, await time.latest());

          await time.increase(time.duration.days(14));

          assert.isBelow(validatorInfo.calledForWithdraw + (await stakeManager.settings()).validatorsSettings.withdrawCooldown, await time.latest());

          await expect(stakeManager.connect(validator1).withdrawAsValidator()).to.be.revertedWith("CratD2CStakeManager: withdraw cooldown");
        })
    })
});
  