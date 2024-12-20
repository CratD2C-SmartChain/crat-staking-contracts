const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect, assert } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { validator, eth } = require("web3");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("CRATStakeManager", function () {
  async function deployFixture() {
    const [owner, distributor, slashReceiver, validator1, delegator1, validator2, delegator2_1, delegator2_2, swap] = await ethers.getSigners();

    const CRATStakeManager = await ethers.getContractFactory("CRATStakeManager");
    const stakeManager = await upgrades.deployProxy(CRATStakeManager, [distributor.address, slashReceiver.address]);

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

          await expect(stakeManager.connect(validator1).depositAsValidator(0)).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(0);
          await expect(stakeManager.connect(validator1).depositAsValidator(0, {value: ethers.parseEther('1')})).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(ethers.parseEther('1'));
          await expect(stakeManager.connect(validator1).depositAsValidator(10001, {value: ethers.parseEther('100')})).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(10001);

          await expect(stakeManager.connect(validator1).depositAsDelegator(validator1)).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(0);
          await expect(stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('1')})).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(ethers.parseEther('1'));
          await expect(stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('10')})).to.be.revertedWithCustomError(stakeManager, "ValidatorsOnly").withArgs(validator1.address);

          // becomes a validator
          await stakeManager.connect(validator1).depositAsValidator(500, {value: ethers.parseEther('100')});
          let currentTime = await time.latest();
          await expect(stakeManager.connect(validator1).depositAsDelegator(delegator1, {value: ethers.parseEther('10')})).to.be.revertedWithCustomError(stakeManager, "DelegatorsOnly").withArgs(validator1.address);

          let validator1Info = await stakeManager.getValidatorInfo(validator1);
          assert.equal(validator1Info.amount, ethers.parseEther('100'));
          assert.equal(validator1Info.commission, 500);
          assert.equal(validator1Info.lastClaim, currentTime);
          assert.equal(validator1Info.calledForWithdraw, 0);
          assert.equal(validator1Info.fixedReward.apr, 1500);
          assert.equal(validator1Info.fixedReward.lastUpdate, currentTime);
          assert.equal(validator1Info.fixedReward.fixedReward, 0);
          assert.equal(validator1Info.variableReward.variableReward, 0);
          assert.equal(validator1Info.variableReward.totalClaimed, 0);
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
          
          // console.log(await stakeManager.validatorEarned(validator1));
          // console.log(BigInt(await time.latest() - currentTime) * validator1Info.amounts[0][0] * BigInt(15) / BigInt(86400*365*100));
          let toCheckFixed = BigInt(await time.latest() - currentTime + 1) * validator1Info.amounts[0][0] * BigInt(15) / BigInt(86400*365*100);

          // await expect(stakeManager.connect(validator1).claimAsValidator()).to.be.revertedWithCustomError(stakeManager, "NotEnoughFixedRewards")/* .withArgs(toCheckFixed,0) */;
          await owner.sendTransaction({value:ethers.parseEther('100'), to:stakeManager.target});
          await expect(stakeManager.connect(validator1).claimAsValidator()).to.be.revertedWithCustomError(stakeManager, "Cooldown").withArgs(true, currentTime + time.duration.days(14));
          await expect(stakeManager.connect(delegator1).claimAsValidator()).to.be.revertedWithCustomError(stakeManager, "ValidatorsOnly").withArgs(delegator1);
          await expect(stakeManager.connect(validator1).restakeAsValidator()).to.be.revertedWithCustomError(stakeManager, "Cooldown").withArgs(true, currentTime + time.duration.days(14));
          await expect(stakeManager.connect(delegator1).restakeAsValidator()).to.be.revertedWithCustomError(stakeManager, "ValidatorsOnly").withArgs(delegator1);

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
          assert.equal(validator1Info.variableReward.variableReward, 0);
          assert.equal(validator1Info.variableReward.totalClaimed, 0);
          assert.equal(validator1Info.delegatedAmount, 0);
          assert.equal(validator1Info.stoppedDelegatedAmount, 0);
          assert.equal(validator1Info.delegatorsAcc, 0);
          assert.equal(validator1Info.delegators.length, 0);
          assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('101'));

          let delegator1Info = await stakeManager.getDelegatorInfo(delegator1);
          assert.equal(delegator1Info.validatorsArr.length, 0);
          assert.equal(delegator1Info.delegatorPerValidatorArr.length, 0);

          // becomes a delegator
          await expect(stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('10')})).to.changeEtherBalances([stakeManager, delegator1], [ethers.parseEther('10'), -ethers.parseEther('10')]);
          currentTime = await time.latest();
          delegator1Info = await stakeManager.getDelegatorInfo(delegator1);
          assert.equal(delegator1Info.validatorsArr.length, 1);
          assert.equal(delegator1Info.delegatorPerValidatorArr.length, 1);
          assert.equal(delegator1Info.validatorsArr[0], validator1.address);

          assert.equal(delegator1Info.delegatorPerValidatorArr[0].amount, ethers.parseEther('10'));
          assert.equal(delegator1Info.delegatorPerValidatorArr[0].lastClaim, currentTime);
          assert.equal(delegator1Info.delegatorPerValidatorArr[0].calledForWithdraw, 0);
          assert.equal(delegator1Info.delegatorPerValidatorArr[0].fixedReward.apr, 1300);
          assert.equal(delegator1Info.delegatorPerValidatorArr[0].fixedReward.lastUpdate, currentTime);
          assert.equal(delegator1Info.delegatorPerValidatorArr[0].fixedReward.fixedReward, 0);
          assert.equal(delegator1Info.delegatorPerValidatorArr[0].fixedReward.totalClaimed, 0);
          assert.equal(delegator1Info.delegatorPerValidatorArr[0].storedValidatorAcc, 0);
          assert.equal(delegator1Info.delegatorPerValidatorArr[0].variableReward.variableReward, 0);
          assert.equal(delegator1Info.delegatorPerValidatorArr[0].variableReward.totalClaimed, 0);

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
          await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('1')});
          currentTime2 = await time.latest();
          delegator1Info = await stakeManager.getDelegatorInfo(delegator1);
          assert.equal(delegator1Info.validatorsArr.length, 1);
          assert.equal(delegator1Info.delegatorPerValidatorArr.length, 1);
          assert.equal(delegator1Info.validatorsArr[0], validator1.address);
          assert.equal(delegator1Info.delegatorPerValidatorArr[0].amount, ethers.parseEther('11'));
          assert.equal(delegator1Info.delegatorPerValidatorArr[0].lastClaim, currentTime);
          assert.equal(delegator1Info.delegatorPerValidatorArr[0].calledForWithdraw, 0);
          assert.equal(delegator1Info.delegatorPerValidatorArr[0].fixedReward.apr, 1300);
          assert.equal(delegator1Info.delegatorPerValidatorArr[0].fixedReward.lastUpdate, currentTime2);
          assert.equal(delegator1Info.delegatorPerValidatorArr[0].fixedReward.fixedReward, BigInt(currentTime2 - currentTime) * BigInt(13) * ethers.parseEther('10') / BigInt(100) / BigInt(365*86400));
          assert.equal(delegator1Info.delegatorPerValidatorArr[0].storedValidatorAcc, 0);
          assert.equal(delegator1Info.delegatorPerValidatorArr[0].variableReward.variableReward, 0);
          assert.equal(delegator1Info.delegatorPerValidatorArr[0].variableReward.totalClaimed, 0);
          assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('11'));

          fixedValidatorReward += BigInt(currentTime2 - currentTime) * ethers.parseEther('101') * BigInt(15) / BigInt(100) / BigInt(365 * 86400);

          assert.equal((await stakeManager.validatorEarned(validator1))[0], fixedValidatorReward);
          assert.equal((await stakeManager.validatorEarned(validator1))[1], 0);
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[0], delegator1Info.delegatorPerValidatorArr[0].fixedReward.fixedReward);
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[1], 0);

          await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator1)).to.be.revertedWithCustomError(stakeManager, "Cooldown");
          await expect(stakeManager.connect(delegator1).restakeAsDelegator(validator1)).to.be.revertedWithCustomError(stakeManager, "Cooldown");
          await expect(stakeManager.connect(delegator1).depositAsValidator(0, {value: ethers.parseEther('100')})).to.be.revertedWithCustomError(stakeManager, "ValidatorsOnly").withArgs(delegator1);

          await expect(stakeManager.connect(validator1).withdrawExcessFixedReward(ethers.parseEther('200'))).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount")
          await expect(stakeManager.withdrawExcessFixedReward(ethers.parseEther('200'))).to.be.revertedWithCustomError(stakeManager, "WrongValue");
          await expect(stakeManager.withdrawExcessFixedReward(ethers.parseEther('100'))).to.changeEtherBalances([stakeManager, owner], [-ethers.parseEther('100'), ethers.parseEther('100')]);
      })

      it("Distribute rewards & claim", async ()=> {
          const { stakeManager, validator1, delegator1, delegator2_1, distributor } = await loadFixture(deployFixture);

          await expect(stakeManager.distributeRewards([], [])).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount");
          await expect(stakeManager.connect(distributor).distributeRewards([], [])).to.be.revertedWithCustomError(stakeManager, "WrongValidatorsLength");
          await expect(stakeManager.connect(distributor).distributeRewards([validator1], [])).to.be.revertedWithCustomError(stakeManager, "WrongValidatorsLength");

          await expect(stakeManager.connect(distributor).distributeRewards([validator1], [ethers.parseEther('1')], {value: ethers.parseEther('1')})).to.changeEtherBalances([stakeManager, distributor], [0,0]);

          // create validator
          await stakeManager.connect(validator1).depositAsValidator(500, {value: ethers.parseEther('100')});
          let v1Start = await time.latest();

          // await expect(stakeManager.connect(distributor).distributeRewards([validator1], [ethers.parseEther('1')])).to.be.revertedWith("CRATStakeManager: not enough coins");
          await expect(stakeManager.connect(distributor).distributeRewards([validator1], [ethers.parseEther('1')])).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(0);
          await expect(stakeManager.connect(distributor).distributeRewards([validator1], [ethers.parseEther('1')], {value:ethers.parseEther('1')})).to.changeEtherBalances([stakeManager, distributor],[ethers.parseEther('1'), -ethers.parseEther('1')]);

          let validatorInfo = await stakeManager.getValidatorInfo(validator1);
          let v1VariableReward = ethers.parseEther('1');
          assert.equal(validatorInfo.variableReward.variableReward, v1VariableReward);
          assert.equal(validatorInfo.variableReward.totalClaimed, 0);
          assert.equal(validatorInfo.delegatorsAcc, 0);
          assert.equal((await stakeManager.validatorEarned(validator1))[0], BigInt(await time.latest() - v1Start) * ethers.parseEther('100') * BigInt(15) / BigInt(100*86400*365));
          assert.equal((await stakeManager.validatorEarned(validator1))[1], v1VariableReward);

          // create delegator
          await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('10')});
          let d1Start = await time.latest();

          await stakeManager.connect(distributor).distributeRewards([validator1, delegator1], [ethers.parseEther('1'), ethers.parseEther('1')], {value: ethers.parseEther('1')});
          validatorInfo = await stakeManager.getValidatorInfo(validator1);
          let d1VariableReward  = ethers.parseEther('1') * BigInt(95) / BigInt(100);
          assert.equal(validatorInfo.delegatorsAcc, d1VariableReward * ethers.parseEther('1') / ethers.parseEther('10'));
          v1VariableReward += ethers.parseEther('1') - d1VariableReward;
          assert.equal((await stakeManager.validatorEarned(validator1))[1], v1VariableReward);
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[0], BigInt(await time.latest() - d1Start) * ethers.parseEther('10') * BigInt(13) / BigInt(100*86400*365));
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[1], d1VariableReward);

          // add another delegator
          await stakeManager.connect(delegator2_1).depositAsDelegator(validator1, {value: ethers.parseEther('40')});
          let d2Start = await time.latest();
          let delegatorInfo = await stakeManager.getDelegatorInfo(delegator2_1);
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].storedValidatorAcc, validatorInfo.delegatorsAcc);

          await stakeManager.connect(distributor).distributeRewards([validator1], [ethers.parseEther('1')], {value: ethers.parseEther('1')});
          let fee = ethers.parseEther('1') * BigInt(95) / BigInt(100);
          assert.equal((await stakeManager.getValidatorInfo(validator1)).delegatorsAcc, validatorInfo.delegatorsAcc + fee * ethers.parseEther('1') / ethers.parseEther('50'));
          v1VariableReward += ethers.parseEther('1') - fee;
          d1VariableReward += fee / BigInt(5);
          let d2VariableReward = fee * BigInt(4) / BigInt(5);
          assert.equal((await stakeManager.validatorEarned(validator1))[1], v1VariableReward);
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[1], d1VariableReward);
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator1))[0], BigInt(await time.latest() - d2Start) * ethers.parseEther('40') * BigInt(13) / BigInt(100*86400*365));
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator1))[1], d2VariableReward);

          // validator claim
          await time.increase(time.duration.days(14));

          // await expect(stakeManager.connect(validator1).claimAsValidator()).to.be.revertedWithCustomError(stakeManager, "NotEnoughFixedRewards");
          let fixedReward = BigInt(await time.latest() + 2 - v1Start) * ethers.parseEther('100') * BigInt(15) / BigInt(100 * 86400 * 365);
          await distributor.sendTransaction({value: fixedReward, to: stakeManager.target});
          await expect(stakeManager.connect(validator1).claimAsValidator()).to.changeEtherBalances([validator1, stakeManager], [v1VariableReward + fixedReward, -(v1VariableReward + fixedReward)]);
          v1Start = await time.latest();
          assert.equal((await stakeManager.validatorEarned(validator1))[0], 0);
          assert.equal((await stakeManager.validatorEarned(validator1))[1], 0);
          validatorInfo = await stakeManager.getValidatorInfo(validator1);
          assert.equal(validatorInfo.variableReward.variableReward, 0);
          assert.equal(validatorInfo.variableReward.totalClaimed, v1VariableReward);
          assert.equal(validatorInfo.fixedReward.fixedReward, 0);
          assert.equal(validatorInfo.fixedReward.lastUpdate, v1Start);
          assert.equal(validatorInfo.fixedReward.totalClaimed, fixedReward);
          assert.equal(validatorInfo.lastClaim, v1Start);
          await validator1.sendTransaction({to:stakeManager.target, value: ethers.parseEther('100')});
          await expect(stakeManager.connect(validator1).claimAsValidator()).to.be.revertedWithCustomError(stakeManager, "Cooldown");
          await stakeManager.withdrawExcessFixedReward(ethers.parseEther('100'));

          let fixedClaimed = validatorInfo.fixedReward.totalClaimed;
          let varClaimed = validatorInfo.variableReward.totalClaimed;

          await time.increase(time.duration.days(14));
          // validator restake
          // await expect(stakeManager.connect(validator1).restakeAsValidator()).to.be.revertedWithCustomError(stakeManager, "NotEnoughFixedRewards");
          fixedReward = BigInt(await time.latest() + 2 - v1Start) * ethers.parseEther('100') * BigInt(15) / BigInt(100 * 86400 * 365);
          await distributor.sendTransaction({value: fixedReward, to: stakeManager.target});
          await expect(stakeManager.connect(validator1).restakeAsValidator()).to.changeEtherBalances([validator1, stakeManager], [0,0]);
          v1Start = await time.latest();
          validatorInfo = await stakeManager.getValidatorInfo(validator1);
          assert.equal(validatorInfo.amount, ethers.parseEther('100') + fixedReward);
          assert.equal(validatorInfo.commission, 500);
          assert.equal(validatorInfo.lastClaim, v1Start);
          assert.equal(validatorInfo.calledForWithdraw, 0);
          assert.equal(validatorInfo.fixedReward.apr, 1500);
          assert.equal(validatorInfo.fixedReward.lastUpdate, v1Start);
          assert.equal(validatorInfo.fixedReward.fixedReward, 0);
          assert.equal(validatorInfo.fixedReward.totalClaimed, fixedClaimed + fixedReward);
          assert.equal(validatorInfo.variableReward.variableReward, 0);
          assert.equal(validatorInfo.variableReward.totalClaimed, varClaimed);
          assert.equal(await stakeManager.totalValidatorsPool(), validatorInfo.amount);

          await time.increase(time.duration.days(2));

          // delegator claim
          // await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator1)).to.be.revertedWithCustomError(stakeManager, "NotEnoughFixedRewards");
          fixedReward = BigInt(await time.latest() + 2 - d1Start) * ethers.parseEther('10') * BigInt(13) / BigInt(100 * 86400 * 365);
          await distributor.sendTransaction({value: fixedReward, to: stakeManager.target});
          await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator1)).to.changeEtherBalances([delegator1, stakeManager], [fixedReward + d1VariableReward, -(fixedReward + d1VariableReward)]);
          d1Start = await time.latest();
          delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].amount, ethers.parseEther('10'));
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].lastClaim, d1Start);
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.lastUpdate, d1Start);
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, 0);
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.variableReward, 0);
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].storedValidatorAcc, validatorInfo.delegatorsAcc);
          assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('50'));
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[0], 0);
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[1], 0);
          await validator1.sendTransaction({value: ethers.parseEther('100'), to: stakeManager.target});
          await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator1)).to.be.revertedWithCustomError(stakeManager, "Cooldown");
          await expect(stakeManager.connect(delegator1).restakeAsDelegator(validator1)).to.be.revertedWithCustomError(stakeManager, "Cooldown");
          await stakeManager.withdrawExcessFixedReward(ethers.parseEther('100'));

          // delegator restake
          // await expect(stakeManager.connect(delegator2_1).restakeAsDelegator(validator1)).to.be.revertedWithCustomError(stakeManager, "NotEnoughFixedRewards");
          fixedReward = BigInt(await time.latest() + 2 - d2Start) * ethers.parseEther('40') * BigInt(13) / BigInt(100 * 86400 * 365);
          await distributor.sendTransaction({value: fixedReward, to: stakeManager.target});
          await expect(stakeManager.connect(delegator2_1).restakeAsDelegator(validator1)).to.changeEtherBalances([stakeManager, delegator2_1], [0,0]);
          d2Start = await time.latest();
          delegatorInfo = await stakeManager.getDelegatorInfo(delegator2_1);
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].amount, ethers.parseEther('40') + fixedReward + d2VariableReward);
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].lastClaim, d2Start);
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.lastUpdate, d2Start);
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, 0);
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.variableReward, 0);
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].storedValidatorAcc, validatorInfo.delegatorsAcc);
          assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('50') + fixedReward + d2VariableReward);
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator1))[0], 0);
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator1))[1], 0);
          await validator1.sendTransaction({value: ethers.parseEther('100'), to: stakeManager.target});
          await expect(stakeManager.connect(delegator2_1).claimAsDelegatorPerValidator(validator1)).to.be.revertedWithCustomError(stakeManager, "Cooldown");
          await expect(stakeManager.connect(delegator2_1).restakeAsDelegator(validator1)).to.be.revertedWithCustomError(stakeManager, "Cooldown");
      })

      it("Call for withdraw & withdraw cases", async ()=> {
          const { stakeManager, validator1, validator2, delegator1, delegator2_1, delegator2_2, distributor, owner } = await loadFixture(deployFixture);

          await expect(stakeManager.connect(validator1).depositAsValidator(0,{value: ethers.parseEther('100')})).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(0);
          await stakeManager.connect(validator1).depositAsValidator(3000,{value: ethers.parseEther('100')});
          let v1Start = await time.latest();
          await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('10')});
          let d1Start = await time.latest();
          await stakeManager.connect(validator2).depositAsValidator(2310, {value: ethers.parseEther('200')});
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
          let fee = ethers.parseEther('50') * BigInt(2310) / BigInt(10000);
          let currentTime = await time.latest();
          let v2Earned = await stakeManager.validatorEarned(validator2);
          let v1Earned = await stakeManager.validatorEarned(validator1);
          let d21Earned = await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator2);
          let d22Earned = await stakeManager.delegatorEarnedPerValidator(delegator2_2, validator2);
          let d1Earned = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);
          assert.equal(v2Earned[0], BigInt(currentTime - v2Start) * BigInt(15) * ethers.parseEther('200') / BigInt(86400*365*100));
          assert.equal(v2Earned[1], fee);
          assert.equal(d21Earned[0], BigInt(currentTime - d21Start) * BigInt(13) * ethers.parseEther('10') / BigInt(86400*365*100));
          assert.equal(d21Earned[1], (ethers.parseEther('50') - fee) / BigInt(5));
          assert.equal(d22Earned[0], BigInt(currentTime - d22Start) * BigInt(13) * ethers.parseEther('40') / BigInt(86400*365*100));
          assert.equal(d22Earned[1], (ethers.parseEther('50') - fee) * BigInt(4) / BigInt(5));
          assert.equal(v1Earned[0], BigInt(currentTime - v1Start) * BigInt(15) * ethers.parseEther('100') / BigInt(86400*365*100));
          assert.equal(v1Earned[1], ethers.parseEther('30') * BigInt(3) / BigInt(10));
          assert.equal(d1Earned[0], BigInt(currentTime - d1Start) * BigInt(13) * ethers.parseEther('10') / BigInt(86400*365*100));
          assert.equal(d1Earned[1], ethers.parseEther('30') - ethers.parseEther('30') * BigInt(3) / BigInt(10));

          // delegator call for withdraw
          await expect(stakeManager.connect(validator1).withdrawAsValidator()).to.be.revertedWithCustomError(stakeManager, "InStoplistStatus").withArgs(validator1, false);
          await expect(stakeManager.connect(delegator1).withdrawAsDelegator(validator1)).to.be.revertedWithCustomError(stakeManager, "InStoplistStatus").withArgs(delegator1, false);
          await expect(stakeManager.connect(validator1).delegatorCallForWithdraw(validator1)).to.be.revertedWithCustomError(stakeManager, "DelegatorsOnly").withArgs(validator1);
          await expect(stakeManager.connect(delegator1).validatorCallForWithdraw()).to.be.revertedWithCustomError(stakeManager, "ValidatorsOnly").withArgs(delegator1);

          await stakeManager.connect(delegator2_1).delegatorCallForWithdraw(validator2);
          let d21CalledForWithdraw = await time.latest();
          assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('50'));
          assert.equal(await stakeManager.stoppedDelegatorsPool(), ethers.parseEther('10'));
          let delegatorInfo = await stakeManager.getDelegatorInfo(delegator2_1);
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].amount, ethers.parseEther('10'));
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].lastClaim, d21Start);
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].calledForWithdraw, d21CalledForWithdraw);
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.lastUpdate, d21CalledForWithdraw);
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, BigInt(d21CalledForWithdraw - d21Start) * BigInt(13) * ethers.parseEther('10') / BigInt(86400*100*365));
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.variableReward, (ethers.parseEther('50') - fee) / BigInt(5));
          assert.equal(delegatorInfo.delegatorPerValidatorArr[0].storedValidatorAcc, (ethers.parseEther('50') - fee) * ethers.parseEther('1') / ethers.parseEther('50'));
          let validatorInfo = await stakeManager.getValidatorInfo(validator2);
          assert.equal(validatorInfo.delegators.length, 2);
          assert.equal(validatorInfo.delegators[0], delegator2_1.address);
          assert.equal(validatorInfo.delegators[1], delegator2_2.address);
          assert.equal(validatorInfo.delegatedAmount, ethers.parseEther('40'));
          assert.equal(validatorInfo.stoppedDelegatedAmount, ethers.parseEther('10'));
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator2))[0], BigInt(d21CalledForWithdraw - d21Start) * BigInt(13) * ethers.parseEther('10') / BigInt(86400*365*100));
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator2))[1], d21Earned[1]);
          d21Earned = await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator2);

          await time.increase(100);

          // check fixed reward stop increase
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator2))[0], d21Earned[0]);
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator2))[1], d21Earned[1]);

          await expect(stakeManager.connect(delegator2_1).delegatorCallForWithdraw(validator2)).to.be.revertedWithCustomError(stakeManager, "InStoplistStatus").withArgs(delegator2_1, true);
          await expect(stakeManager.connect(delegator2_1).withdrawAsDelegator(validator2)).to.be.revertedWithCustomError(stakeManager, "Cooldown");
          await expect(stakeManager.connect(delegator2_1).depositAsDelegator(validator2, {value: ethers.parseEther('1')})).to.be.revertedWithCustomError(stakeManager, "InStoplistStatus").withArgs(delegator2_1, true);

          // check still share variable rewards
          await stakeManager.connect(distributor).distributeRewards([validator1, validator2], [ethers.parseEther('10'), ethers.parseEther('20')], {value:ethers.parseEther('30')});
          fee = ethers.parseEther('20') * BigInt(2310) / BigInt(10000);
          currentTime = await time.latest();
          assert.equal((await stakeManager.validatorEarned(validator2))[0], BigInt(currentTime - v2Start) * BigInt(15) * ethers.parseEther('200') / BigInt(86400*365*100));
          assert.equal((await stakeManager.validatorEarned(validator2))[1], v2Earned[1] + fee);
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator2))[0], d21Earned[0]);
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator2))[1], d21Earned[1] + (ethers.parseEther('20') - fee) / BigInt(5));
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_2, validator2))[0], BigInt(currentTime - d22Start) * BigInt(13) * ethers.parseEther('40') / BigInt(86400*365*100));
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_2, validator2))[1], d22Earned[1] + (ethers.parseEther('20') - fee) * BigInt(4) / BigInt(5));
          assert.equal((await stakeManager.validatorEarned(validator1))[0], BigInt(currentTime - v1Start) * BigInt(15) * ethers.parseEther('100') / BigInt(86400*365*100));
          assert.equal((await stakeManager.validatorEarned(validator1))[1], v1Earned[1] + ethers.parseEther('10') * BigInt(3) / BigInt(10));
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[0], BigInt(currentTime - d1Start) * BigInt(13) * ethers.parseEther('10') / BigInt(86400*365*100));
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[1], d1Earned[1] + ethers.parseEther('10') - ethers.parseEther('10') * BigInt(3) / BigInt(10));

          v2Earned = await stakeManager.validatorEarned(validator2);
          v1Earned = await stakeManager.validatorEarned(validator1);
          d21Earned = await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator2);
          d22Earned = await stakeManager.delegatorEarnedPerValidator(delegator2_2, validator2);
          d1Earned = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);

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
          assert.equal(validatorInfo.variableReward.variableReward, v2Earned[1]);
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
          assert.equal(v2Earned[1], validatorInfo.variableReward.variableReward);

          // check stop fixed reward increase
          await time.increase(100);
          assert.equal((await stakeManager.validatorEarned(validator2))[0], validatorInfo.fixedReward.fixedReward);
          assert.equal((await stakeManager.validatorEarned(validator2))[1], validatorInfo.variableReward.variableReward);
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator2))[0], d21Earned[0]);
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator2))[1], d21Earned[1]);
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_2, validator2))[0], BigInt(v2CalledForWithdraw - d22Start) * BigInt(13) * ethers.parseEther('40') / BigInt(100*86400*365));
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_2, validator2))[1], d22Earned[1]);

          v2Earned = await stakeManager.validatorEarned(validator2);
          d21Earned = await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator2);
          d22Earned = await stakeManager.delegatorEarnedPerValidator(delegator2_2, validator2);

          await expect(stakeManager.connect(validator2).validatorCallForWithdraw()).to.be.revertedWithCustomError(stakeManager, "InStoplistStatus").withArgs(validator2, true);
          await expect(stakeManager.connect(validator2).withdrawAsValidator()).to.be.revertedWithCustomError(stakeManager, "Cooldown");
          await expect(stakeManager.connect(validator2).depositAsValidator(0, {value: ethers.parseEther('1')})).to.be.revertedWithCustomError(stakeManager, "InStoplistStatus").withArgs(validator2, true);

          // still earn variable reward
          await stakeManager.connect(distributor).distributeRewards([validator1, validator2], [ethers.parseEther('1'), ethers.parseEther('1')], {value: ethers.parseEther('2')});
          currentTime = await time.latest();
          fee = ethers.parseEther('1') * BigInt(2310) / BigInt(10000);
          assert.equal((await stakeManager.validatorEarned(validator2))[0], v2Earned[0]);
          assert.equal((await stakeManager.validatorEarned(validator2))[1], v2Earned[1] + fee);
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator2))[0], d21Earned[0]);
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator2))[1], d21Earned[1] + (ethers.parseEther('1') - fee) / BigInt(5));
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_2, validator2))[0], d22Earned[0]);
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_2, validator2))[1], d22Earned[1] + (ethers.parseEther('1') - fee) * BigInt(4) / BigInt(5));

          assert.equal((await stakeManager.validatorEarned(validator1))[0], BigInt(currentTime - v1Start) * BigInt(15) * ethers.parseEther('100') / BigInt(86400*100*365));
          assert.equal((await stakeManager.validatorEarned(validator1))[1], v1Earned[1] + ethers.parseEther('1') * BigInt(3) / BigInt(10));
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[0], BigInt(currentTime - d1Start) * ethers.parseEther('10') * BigInt(13) / BigInt(86400*100*365));
          assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[1], d1Earned[1] + ethers.parseEther('1') - ethers.parseEther('1') * BigInt(3) / BigInt(10));

          v2Earned = await stakeManager.validatorEarned(validator2);
          v1Earned = await stakeManager.validatorEarned(validator1);
          d21Earned = await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator2);
          d22Earned = await stakeManager.delegatorEarnedPerValidator(delegator2_2, validator2);
          d1Earned = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);

          assert.equal(await stakeManager.forFixedReward(), 0);
          await owner.sendTransaction({to: stakeManager.target, value: ethers.parseEther('100')});
          assert.equal(await stakeManager.forFixedReward(), ethers.parseEther('100'));
          await expect(stakeManager.connect(validator2).claimAsValidator()).to.changeEtherBalances([stakeManager, validator2], [-(v2Earned[0] + v2Earned[1]), v2Earned[0] + v2Earned[1]]);
          let fixedRewardPool = await stakeManager.forFixedReward();
          assert.equal(fixedRewardPool, ethers.parseEther('100') - v2Earned[0]);
          assert.equal((await stakeManager.validatorEarned(validator2))[0], 0);
          assert.equal((await stakeManager.validatorEarned(validator2))[1], 0);

          await time.increase(time.duration.days(14));
          await expect(stakeManager.connect(validator2).restakeAsValidator()).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(0);
          await expect(stakeManager.connect(validator2).claimAsValidator()).to.changeEtherBalances([stakeManager, validator2], [0,0]);

          // delegator withdraw
          await expect(stakeManager.connect(delegator2_1).withdrawAsDelegator(validator2)).to.changeEtherBalances([stakeManager, delegator2_1], [-(ethers.parseEther('10') + d21Earned[0] + d21Earned[1]), ethers.parseEther('10') + d21Earned[0] + d21Earned[1]]);
          delegatorInfo = await stakeManager.getDelegatorInfo(delegator2_1);
          assert.equal(delegatorInfo.delegatorPerValidatorArr.length, 0);
          assert.equal(delegatorInfo.validatorsArr.length, 0);
          // assert.equal(delegatorInfo.delegatorPerValidatorArr[0].amount, 0);
          // assert.equal(delegatorInfo.delegatorPerValidatorArr[0].lastClaim, 0);
          // assert.equal(delegatorInfo.delegatorPerValidatorArr[0].calledForWithdraw, 0);
          // assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.apr, 0);
          // assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.lastUpdate, 0);
          // assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, 0);
          // assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.variableReward, 0);
          // assert.equal(delegatorInfo.delegatorPerValidatorArr[0].storedValidatorAcc, 0);

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
          assert.equal(validatorInfo.variableReward.variableReward, 0);
          assert.equal(validatorInfo.delegatedAmount, 0);
          assert.equal(validatorInfo.stoppedDelegatedAmount, 0);
          assert.equal(validatorInfo.delegatorsAcc, 0);
          delegatorInfo = await stakeManager.getDelegatorInfo(delegator2_2);
          assert.equal(delegatorInfo.delegatorPerValidatorArr.length, 0);
          assert.equal(delegatorInfo.validatorsArr.length, 0);
          // assert.equal(delegatorInfo.amount, 0);
          // assert.equal(delegatorInfo.lastClaim, 0);
          // assert.equal(delegatorInfo.calledForWithdraw, 0);
          // assert.equal(delegatorInfo.fixedReward.apr, 0);
          // assert.equal(delegatorInfo.fixedReward.lastUpdate, 0);
          // assert.equal(delegatorInfo.fixedReward.fixedReward, 0);
          // assert.equal(delegatorInfo.variableReward.variableReward.variableReward, 0);
          // assert.equal(delegatorInfo.variableReward.storedAcc, 0);

          // close validators limit
          await expect(stakeManager.connect(validator1).setValidatorsLimit(0)).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount");
          await stakeManager.setValidatorsLimit(1);
          await expect(stakeManager.connect(validator2).depositAsValidator(0, {value: ethers.parseEther('100')})).to.be.revertedWithCustomError(stakeManager, "WrongValidatorsLength");

          await stakeManager.connect(validator1).validatorCallForWithdraw();
          let v1CalledForWithdraw = await time.latest();
          await time.increase(time.duration.days(5));

          await expect(stakeManager.connect(validator1).withdrawAsValidator()).to.be.revertedWithCustomError(stakeManager, "Cooldown");
          let fixedReward = BigInt(v1CalledForWithdraw - d1Start) * BigInt(13) * ethers.parseEther('10') / BigInt(100*86400*365);
          await expect(stakeManager.withdrawForDelegators(validator1, [delegator1])).to.changeEtherBalances([delegator1, stakeManager], [ethers.parseEther('10') + d1Earned[1] + fixedReward, -(ethers.parseEther('10') + d1Earned[1] + fixedReward)]);
          assert.equal(await stakeManager.forFixedReward(), fixedRewardPool - fixedReward);
          delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);
          assert.equal(delegatorInfo.delegatorPerValidatorArr.length, 0);
          assert.equal(delegatorInfo.validatorsArr.length, 0);
          // assert.equal(delegatorInfo.validator, ZERO_ADDRESS);
          // assert.equal(delegatorInfo.amount, 0);
          // assert.equal(delegatorInfo.lastClaim, 0);
          // assert.equal(delegatorInfo.calledForWithdraw, 0);
          // assert.equal(delegatorInfo.fixedReward.apr, 0);
          // assert.equal(delegatorInfo.fixedReward.lastUpdate, 0);
          // assert.equal(delegatorInfo.fixedReward.fixedReward, 0);
          // assert.equal(delegatorInfo.variableReward.variableReward.variableReward, 0);
          // assert.equal(delegatorInfo.variableReward.storedAcc, 0);
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

        await stakeManager.connect(validator1).depositAsValidator(700, {value: ethers.parseEther('100')}); // to be slashed under the threshold
        await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('10')}); // to be slashed under the threshold
        await stakeManager.connect(owner).depositAsDelegator(validator1, {value: ethers.parseEther('20')}); // to be slashed above the threshold

        await stakeManager.connect(validator2).depositAsValidator(1200, {value: ethers.parseEther('200')}); // to be slashed above the threshold
        await stakeManager.connect(delegator2_1).depositAsDelegator(validator2, {value: ethers.parseEther('10')}); // to be slashed under the threshold
        await stakeManager.connect(delegator2_2).depositAsDelegator(validator2, {value: ethers.parseEther('20')}); // to be slashed above the threshold

        // distribute rewards
        await stakeManager.connect(distributor).distributeRewards([validator1, validator2],[ethers.parseEther('4'), ethers.parseEther('4')], {value: ethers.parseEther('8')});

        let v1Reward = await stakeManager.validatorEarned(validator1);
        let v2Reward = await stakeManager.validatorEarned(validator2);
        let d1Reward = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);
        let d21Reward = await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator2);
        let d22Reward = await stakeManager.delegatorEarnedPerValidator(delegator2_2, validator2);
        let ownerReward = await stakeManager.delegatorEarnedPerValidator(owner, validator1);

        await expect(stakeManager.slash([])).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount");
        await expect(stakeManager.connect(distributor).slash([owner])).to.changeEtherBalances([stakeManager, slashReceiver], [0,0]);

        let totalSlashed = ethers.parseEther('20') + ethers.parseEther('60') * BigInt(5) / BigInt(100);
        await expect(stakeManager.connect(distributor).slash([validator1, validator2])).to.changeEtherBalances([stakeManager, slashReceiver], [-totalSlashed,totalSlashed]);
        let currentTime = await time.latest();

        let validatorInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validatorInfo.amount , ethers.parseEther('90'));
        assert.equal(validatorInfo.calledForWithdraw, currentTime);
        assert.equal(validatorInfo.fixedReward.fixedReward, v1Reward[0] + BigInt(3) * ethers.parseEther('100') * BigInt(15) / BigInt(100 * 86400 * 365) + BigInt(1));
        assert.equal(validatorInfo.variableReward.variableReward, v1Reward[1]);

        validatorInfo = await stakeManager.getValidatorInfo(validator2);
        assert.equal(validatorInfo.amount , ethers.parseEther('190'));
        assert.equal(validatorInfo.calledForWithdraw, 0);
        assert.equal(validatorInfo.fixedReward.fixedReward, v2Reward[0] + BigInt(3) * ethers.parseEther('200') * BigInt(15) / BigInt(100 * 86400 * 365) + BigInt(1));
        assert.equal(validatorInfo.variableReward.variableReward, v2Reward[1]);

        let delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].amount, ethers.parseEther('10') - ethers.parseEther('10') * BigInt(5) / BigInt(100));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].calledForWithdraw, currentTime);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, d1Reward[0] + BigInt(3) * ethers.parseEther('10') * BigInt(13) / BigInt(100 * 86400 * 365) + BigInt(1));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.variableReward, d1Reward[1]);

        delegatorInfo = await stakeManager.getDelegatorInfo(owner);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].amount, ethers.parseEther('20') - ethers.parseEther('20') * BigInt(5) / BigInt(100));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].calledForWithdraw, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, ownerReward[0] + BigInt(3) * ethers.parseEther('20') * BigInt(13) / BigInt(100 * 86400 * 365));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.variableReward, ownerReward[1]);

        delegatorInfo = await stakeManager.getDelegatorInfo(delegator2_1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].amount, ethers.parseEther('10') - ethers.parseEther('10') * BigInt(5) / BigInt(100));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].calledForWithdraw, currentTime);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, d21Reward[0] + BigInt(3) * ethers.parseEther('10') * BigInt(13) / BigInt(100 * 86400 * 365) + BigInt(1));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.variableReward, d21Reward[1]);

        delegatorInfo = await stakeManager.getDelegatorInfo(delegator2_2);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].amount, ethers.parseEther('20') - ethers.parseEther('20') * BigInt(5) / BigInt(100));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].calledForWithdraw, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, d22Reward[0] + BigInt(3) * ethers.parseEther('20') * BigInt(13) / BigInt(100 * 86400 * 365) + BigInt(1));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.variableReward, d22Reward[1]);

        assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('190'));
        assert.equal(await stakeManager.totalDelegatorsPool(),ethers.parseEther('19'));
        assert.equal(await stakeManager.stoppedValidatorsPool(), ethers.parseEther('90'));
        assert.equal(await stakeManager.stoppedDelegatorsPool(), ethers.parseEther('38'));

        v1Reward = await stakeManager.validatorEarned(validator1);
        v2Reward = await stakeManager.validatorEarned(validator2);
        d1Reward = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);
        d21Reward = await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator2);
        d22Reward = await stakeManager.delegatorEarnedPerValidator(delegator2_2, validator2);
        ownerReward = await stakeManager.delegatorEarnedPerValidator(owner, validator1);

        await time.increase(time.duration.days(1));

        assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, v1Reward.fixedReward);
        assert.equal((await stakeManager.validatorEarned(validator2)).fixedReward, v2Reward.fixedReward + BigInt(86400) * ethers.parseEther('190') * BigInt(15) / BigInt(86400 * 365 * 100));
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, d1Reward.fixedReward);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(owner, validator1)).fixedReward, ownerReward.fixedReward);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator2)).fixedReward, d21Reward.fixedReward);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_2, validator2)).fixedReward, d22Reward.fixedReward + BigInt(86400) * ethers.parseEther('19') * BigInt(13) / BigInt(86400 * 365 * 100));

        // another slashing call for already stopped validator (withdraw all of his funds!!!)
        totalSlashed = ethers.parseEther('90') + (ethers.parseEther('9.5') + ethers.parseEther('19')) * BigInt(5) / BigInt(100);
        await stakeManager.setValidatorsAmountToSlash(ethers.parseEther('100'));
        await expect(stakeManager.connect(distributor).slash([validator1])).to.changeEtherBalances([stakeManager, slashReceiver], [-totalSlashed, totalSlashed]);

        validatorInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validatorInfo.amount , 0);
        assert.equal(validatorInfo.calledForWithdraw, currentTime);
        assert.equal(validatorInfo.fixedReward.fixedReward, v1Reward.fixedReward);
        assert.equal(validatorInfo.variableReward.variableReward, v1Reward.variableReward);

        assert.equal((await stakeManager.validatorEarned(validator1))[0], v1Reward[0]);
        assert.equal((await stakeManager.validatorEarned(validator1))[1], v1Reward[1]);

        delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].amount, ethers.parseEther('9.5') - ethers.parseEther('9.5') * BigInt(5) / BigInt(100));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].calledForWithdraw, currentTime);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, d1Reward[0]);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.variableReward, d1Reward[1]);

        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[0], d1Reward[0]);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[1], d1Reward[1]);

        delegatorInfo = await stakeManager.getDelegatorInfo(owner);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].amount, ethers.parseEther('19') - ethers.parseEther('19') * BigInt(5) / BigInt(100));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].calledForWithdraw, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, ownerReward[0]);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.variableReward, ownerReward[1]);

        assert.equal((await stakeManager.delegatorEarnedPerValidator(owner, validator1))[0], ownerReward[0]);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(owner, validator1))[1], ownerReward[1]);

        assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('190'));
        assert.equal(await stakeManager.totalDelegatorsPool(),ethers.parseEther('19'));
        assert.equal(await stakeManager.stoppedValidatorsPool(), 0);
        assert.equal(await stakeManager.stoppedDelegatorsPool(), ethers.parseEther('36.575')); // (30*0.95) * 0.95 + 9.5

        await time.increase(time.duration.days(13));
        await owner.sendTransaction({value: v1Reward[0] , to: stakeManager.target});

        // not possible to restake
        await expect(stakeManager.connect(validator1).restakeAsValidator()).to.be.revertedWithCustomError(stakeManager, "InStoplistStatus").withArgs(validator1, true);

        // but possible to claim rewards
        await expect(stakeManager.connect(validator1).claimAsValidator()).to.changeEtherBalances([stakeManager, validator1], [-v1Reward[0] -v1Reward[1], v1Reward[0] + v1Reward[1]]);
        assert.equal((await stakeManager.validatorEarned(validator1))[0], 0);
        assert.equal((await stakeManager.validatorEarned(validator1))[1], 0);
        assert.equal((await stakeManager.getValidatorInfo(validator1)).lastClaim, await time.latest());
        await expect(stakeManager.connect(validator1).claimAsValidator()).to.changeEtherBalances([stakeManager, validator1], [0, 0]);
        assert.equal((await stakeManager.getValidatorInfo(validator1)).lastClaim, await time.latest() - 1);

        // await expect(stakeManager.connect(distributor).slash([validator1])).to.changeEtherBalances([stakeManager, slashReceiver], [-ethers.parseEther('1.35375'), ethers.parseEther('1.35375')]); // try to slash validator with 0 amount - passed

        await expect(stakeManager.connect(delegator1).reviveAsDelegator(validator1, {value: 0})).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(0); // under the threshold
        await expect(stakeManager.connect(delegator1).reviveAsDelegator(validator1, {value: ethers.parseEther('10')})).to.be.revertedWithCustomError(stakeManager, "InStoplistStatus").withArgs(validator1, true); // validator stopped
        await expect(stakeManager.connect(delegator2_2).reviveAsDelegator(validator2, {value: ethers.parseEther('10')})).to.be.revertedWithCustomError(stakeManager, "InStoplistStatus").withArgs(delegator2_2, false); // this delegator didn't call for withdraw

        await expect(stakeManager.connect(delegator1).reviveAsValidator()).to.be.revertedWithCustomError(stakeManager, "ValidatorsOnly").withArgs(delegator1);
        await expect(stakeManager.connect(validator2).reviveAsValidator()).to.be.revertedWithCustomError(stakeManager, "InStoplistStatus").withArgs(validator2, false);
        await expect(stakeManager.connect(validator1).reviveAsValidator()).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(0);
        // await expect(stakeManager.setValidatorsLimit(0)).to.be.revertedWithCustomError(stakeManager, "CRATStakeManager: wrong limit");
        await expect(stakeManager.setValidatorsLimit(0)).to.be.revertedWithCustomError(stakeManager, "WrongValidatorsLength");
        await stakeManager.setValidatorsLimit(1);
        await expect(stakeManager.connect(validator1).reviveAsValidator({value: ethers.parseEther('100')})).to.be.revertedWithCustomError(stakeManager, "WrongValidatorsLength");
        await stakeManager.setValidatorsLimit(101);

        await time.increase(time.duration.days(16)); // claim cooldown for delegators

        await distributor.sendTransaction({to: stakeManager.target, value: ethers.parseEther('100')});
        await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator1)).to.changeEtherBalances([stakeManager, delegator1], [-(d1Reward[0] + d1Reward[1]), d1Reward[0] + d1Reward[1]]);
        // await stakeManager.connect(delegator1).delegatorCallForWithdraw(validator1);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[0], 0);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[1], 0);
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).delegatorPerValidatorArr[0].calledForWithdraw, currentTime /* await time.latest() */);
        // total balances hasn't been changed (cause this delegator is stopped)
        assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('190'));
        assert.equal(await stakeManager.totalDelegatorsPool(),ethers.parseEther('19'));
        assert.equal(await stakeManager.stoppedValidatorsPool(), 0);
        assert.equal(await stakeManager.stoppedDelegatorsPool(), ethers.parseEther('36.575')); // (30*0.95) * 0.95 + 9.5

        await expect(stakeManager.withdrawForValidator(validator1)).to.changeEtherBalances([stakeManager, validator1, delegator1, owner], [-(ownerReward[0] + ownerReward[1] + ethers.parseEther('27.075')), 0, ethers.parseEther('9.025'), ownerReward[0] + ownerReward[1] + ethers.parseEther('18.05')]);
      })

      it("Revive mechanics", async ()=> {
        const { stakeManager, validator1, delegator1, delegator2_1, distributor } = await loadFixture(deployFixture);

        await stakeManager.setValidatorsAmountToSlash(ethers.parseEther('10'));

        await stakeManager.connect(validator1).depositAsValidator(700, {value: ethers.parseEther('100')}); // to be slashed under the threshold
        let v1Start = await time.latest();
        await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('10')}); // to be slashed under the threshold
        await stakeManager.connect(delegator2_1).depositAsDelegator(validator1, {value: ethers.parseEther('20')}); // to be slashed above the threshold

        await time.increase(86400);

        await stakeManager.connect(distributor).distributeRewards([validator1], [ethers.parseEther('12')], {value: ethers.parseEther('12')});
        // let currentTime = await time.latest();

        await stakeManager.connect(distributor).slash([validator1]);
        let d1CalledForWithdraw = await time.latest();

        let v1Reward = await stakeManager.validatorEarned(validator1);
        let d1Reward = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);
        let d21Reward = await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator1);

        assert.equal((await stakeManager.getValidatorInfo(validator1)).calledForWithdraw, await time.latest());
        assert.equal(await stakeManager.stoppedValidatorsPool(), ethers.parseEther('90'));
        assert.equal(await stakeManager.stoppedDelegatorsPool(), ethers.parseEther('30') * BigInt(95) / BigInt(100));

        await time.increase(86401);

        // one user call for withdraw
        // await stakeManager.connect(delegator1).delegatorCallForWithdraw(validator1);
        // let d1CalledForWithdraw = await time.latest();

        await time.increase(86400);

        await stakeManager.connect(validator1).reviveAsValidator({value: ethers.parseEther('10')});
        assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('100'));
        assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('20') * BigInt(95) / BigInt(100));
        assert.equal(await stakeManager.stoppedValidatorsPool(), 0);
        assert.equal(await stakeManager.stoppedDelegatorsPool(), ethers.parseEther('10') * BigInt(95) / BigInt(100));
        let validatorInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validatorInfo.amount, ethers.parseEther('100'));
        assert.equal(validatorInfo.commission, 700);
        assert.equal(validatorInfo.lastClaim, v1Start);
        assert.equal(validatorInfo.calledForWithdraw, 0);
        assert.equal(validatorInfo.fixedReward.apr, 1500);
        assert.equal(validatorInfo.fixedReward.lastUpdate, await time.latest());
        assert.equal(validatorInfo.fixedReward.fixedReward, v1Reward[0]);
        assert.equal(validatorInfo.variableReward.variableReward, v1Reward[1]);
        assert.equal(validatorInfo.delegatedAmount, ethers.parseEther('20') * BigInt(95) / BigInt(100));
        assert.equal(validatorInfo.stoppedDelegatedAmount, ethers.parseEther('10') * BigInt(95) / BigInt(100));
        assert.equal(validatorInfo.delegators.length, 2);

        assert.equal((await stakeManager.validatorEarned(validator1))[0], v1Reward[0]);
        assert.equal((await stakeManager.validatorEarned(validator1))[1], v1Reward[1]);

        let delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].amount, ethers.parseEther('10') * BigInt(95) / BigInt(100));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].lastClaim, v1Start + 1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].calledForWithdraw, d1CalledForWithdraw);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.apr, 1300);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.lastUpdate, d1CalledForWithdraw);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, d1Reward[0]);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.variableReward, d1Reward[1]);

        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[0], d1Reward[0]);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[1], d1Reward[1]);

        delegatorInfo = await stakeManager.getDelegatorInfo(delegator2_1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].amount, ethers.parseEther('20') * BigInt(95) / BigInt(100));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].lastClaim, v1Start + 2);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].calledForWithdraw, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.apr, 1300);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.lastUpdate, await time.latest());
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, d21Reward[0]);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.variableReward, d21Reward[1]);

        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator1))[0], d21Reward[0]);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator1))[1], d21Reward[1]);

        await time.increase(86400);
        assert.equal((await stakeManager.validatorEarned(validator1))[0], v1Reward[0] + ethers.parseEther('100') * BigInt(15) * BigInt(86400) / BigInt(100*86400*365));
        assert.equal((await stakeManager.validatorEarned(validator1))[1], v1Reward[1]);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[0], d1Reward[0]);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[1], d1Reward[1]);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator1))[0], d21Reward[0] + (ethers.parseEther('20') * BigInt(95) / BigInt(100)) * BigInt(13) * BigInt(86400) / BigInt(100*86400*365));
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator1))[1], d21Reward[1]);

        await stakeManager.connect(delegator1).reviveAsDelegator(validator1, {value: ethers.parseEther('0.5')});
        delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].amount, ethers.parseEther('10'));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].lastClaim, v1Start + 1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].calledForWithdraw, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.apr, 1300);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.lastUpdate, await time.latest());
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, d1Reward[0]);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.variableReward, d1Reward[1]);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[0], d1Reward[0]);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[1], d1Reward[1]);
        assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('100'));
        assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('10') + ethers.parseEther('20') * BigInt(95) / BigInt(100));
        assert.equal(await stakeManager.stoppedValidatorsPool(), 0);
        assert.equal(await stakeManager.stoppedDelegatorsPool(), 0);
        assert.equal((await stakeManager.getValidatorInfo(validator1)).delegatedAmount, ethers.parseEther('10') + ethers.parseEther('20') * BigInt(95) / BigInt(100));
        assert.equal((await stakeManager.getValidatorInfo(validator1)).stoppedDelegatedAmount, 0);

        await time.increase(86400);

        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[0], d1Reward[0] + BigInt(86400) * ethers.parseEther('10') * BigInt(13) / BigInt(100*365*86400));
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1))[1], d1Reward[1]);
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

        // await expect(stakeManager.setSlashReceiver(ZERO_ADDRESS)).to.be.revertedWith("CRATStakeManager: 0x00");
        await expect(stakeManager.setSlashReceiver(ZERO_ADDRESS)).to.be.revertedWithCustomError(stakeManager, "ZeroAddress");
        // await expect(stakeManager.setDelegatorsPercToSlash(10001)).to.be.revertedWith("CRATStakeManager: wrong percent");
        await expect(stakeManager.setDelegatorsPercToSlash(10001)).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(10001);

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

        let StakeManager = await ethers.getContractFactory("CRATStakeManager");

        // await expect(upgrades.deployProxy(StakeManager, [ZERO_ADDRESS, ZERO_ADDRESS])).to.be.revertedWith("CRATStakeManager: 0x00");
        // await upgrades.deployProxy(StakeManager, [ZERO_ADDRESS, ZERO_ADDRESS]);
        // await expect(upgrades.deployProxy(StakeManager, [ZERO_ADDRESS, ZERO_ADDRESS])).to.be.revertedWithoutReason();
        await upgrades.deployProxy(StakeManager, [ZERO_ADDRESS, owner.address]);
      })

      it("Add depositForVaidator method", async ()=> {
        const { stakeManager, validator1, swap, owner } = await loadFixture(deployFixture);

        await expect(stakeManager.depositForValidator(ZERO_ADDRESS, 0, 0)).to.be.revertedWithCustomError(stakeManager, "AccessControlUnauthorizedAccount");

        await stakeManager.grantRole(await stakeManager.SWAP_ROLE(), swap.address);

        await expect(stakeManager.connect(swap).depositForValidator(ZERO_ADDRESS, 0, 0)).to.be.revertedWithCustomError(stakeManager, "ZeroAddress");
        await expect(stakeManager.connect(swap).depositForValidator(validator1, 0, 0)).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(0);
        await expect(stakeManager.connect(swap).depositForValidator(validator1, 0, await time.latest() + 300)).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(0);
        await expect(stakeManager.connect(swap).depositForValidator(validator1, 0, await time.latest() + 300, {value: ethers.parseEther('99.9')})).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(ethers.parseEther('99.9'));
        await stakeManager.setValidatorsLimit(0);
        await expect(stakeManager.connect(swap).depositForValidator(validator1, 0, await time.latest() + 300, {value: ethers.parseEther('100')})).to.be.revertedWithCustomError(stakeManager, "WrongValidatorsLength");
        await stakeManager.setValidatorsLimit(101);

        let vestingEnd = await time.latest() + 86400*30;

        await stakeManager.connect(swap).depositForValidator(validator1, 500, vestingEnd, {value: ethers.parseEther('100')});
        let stakeTime = await time.latest();
        let validatorInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validatorInfo.amount, ethers.parseEther('100'));
        assert.equal(validatorInfo.commission, 500);
        assert.equal(validatorInfo.lastClaim, stakeTime);
        assert.equal(validatorInfo.calledForWithdraw, 0);
        assert.equal(validatorInfo.vestingEnd, vestingEnd);
        assert.equal(validatorInfo.fixedReward.apr, 1500);
        assert.equal(validatorInfo.fixedReward.lastUpdate, stakeTime);
        assert.equal(validatorInfo.fixedReward.fixedReward, 0);
        assert.equal(validatorInfo.variableReward.variableReward, 0);
        assert.equal(validatorInfo.delegatedAmount, 0);
        assert.equal(validatorInfo.stoppedDelegatedAmount, 0);
        assert.equal(validatorInfo.delegatorsAcc, 0);
        assert.equal(validatorInfo.delegators.length, 0);

        // second deposit for this validator
        await expect(stakeManager.connect(swap).depositForValidator(validator1, 1, vestingEnd - 1)).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(vestingEnd - 1);

        await stakeManager.connect(swap).depositForValidator(validator1, 1100, vestingEnd + 1, {value: ethers.parseEther('1')});

        validatorInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validatorInfo.amount, ethers.parseEther('101'));
        assert.equal(validatorInfo.commission, 500);
        assert.equal(validatorInfo.lastClaim, stakeTime);
        assert.equal(validatorInfo.calledForWithdraw, 0);
        assert.equal(validatorInfo.vestingEnd, vestingEnd + 1);

        // revert for delegator
        await stakeManager.depositAsDelegator(validator1, {value: ethers.parseEther('10')});
        await expect(stakeManager.connect(swap).depositForValidator(owner, 0, await time.latest() + 300, {value: ethers.parseEther('100')})).to.be.revertedWithCustomError(stakeManager, "ValidatorsOnly").withArgs(owner);

        // can not early withdraw (till the vesting end)
        await stakeManager.connect(validator1).validatorCallForWithdraw();
        validatorInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validatorInfo.calledForWithdraw, await time.latest());

        await time.increase(time.duration.days(14));

        assert.isBelow(validatorInfo.calledForWithdraw + (await stakeManager.settings()).validatorsSettings.withdrawCooldown, await time.latest());

        await expect(stakeManager.connect(validator1).withdrawAsValidator()).to.be.revertedWithCustomError(stakeManager, "Cooldown");
      })

      it("Total rewards calculation check", async ()=> {
        const { stakeManager, validator1, owner, delegator1 , distributor } = await loadFixture(deployFixture);

        let totalRewards = await stakeManager.totalValidatorsRewards();
        assert.equal(totalRewards.fixedReward, 0);
        assert.equal(totalRewards.variableReward, 0);

        totalRewards = await stakeManager.totalDelegatorsRewards();
        assert.equal(totalRewards.fixedReward, 0);
        assert.equal(totalRewards.variableReward, 0);

        await stakeManager.connect(validator1).depositAsValidator(500, {value: ethers.parseEther('100')});
        // let v1Start = await time.latest();

        totalRewards = await stakeManager.totalValidatorsRewards();
        assert.equal(totalRewards.fixedReward, 0);
        assert.equal(totalRewards.variableReward, 0);

        totalRewards = await stakeManager.totalDelegatorsRewards();
        assert.equal(totalRewards.fixedReward, 0);
        assert.equal(totalRewards.variableReward, 0);

        await time.increase(5);
        totalRewards = await stakeManager.totalValidatorsRewards();
        assert.equal(totalRewards.fixedReward, ethers.parseEther('100') * BigInt(15 * 5) / BigInt(100 * 86400 * 365));
        assert.equal(totalRewards.variableReward, 0);

        totalRewards = await stakeManager.totalDelegatorsRewards();
        assert.equal(totalRewards.fixedReward, 0);
        assert.equal(totalRewards.variableReward, 0);

        await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('10')});
        // let d1Start = await time.latest();

        totalRewards = await stakeManager.totalDelegatorsRewards();
        assert.equal(totalRewards.fixedReward, 0);
        assert.equal(totalRewards.variableReward, 0);

        await time.increase(5);

        totalRewards = await stakeManager.totalDelegatorsRewards();
        assert.equal(totalRewards.fixedReward, ethers.parseEther('10') * BigInt(13 * 5) / BigInt(100 * 86400 * 365));
        assert.equal(totalRewards.variableReward, 0);

        await stakeManager.connect(validator1).depositAsValidator(0, {value: ethers.parseEther('10')});

        totalRewards = await stakeManager.totalValidatorsRewards();
        let fixedReward = ethers.parseEther('100') * BigInt(15 * 12) / BigInt(100 * 86400 * 365)
        assert.equal(totalRewards.fixedReward, fixedReward);
        assert.equal(totalRewards.variableReward, 0);

        await time.increase(5);

        totalRewards = await stakeManager.totalValidatorsRewards();
        assert.equal(totalRewards.fixedReward, fixedReward + ethers.parseEther('110') * BigInt(15 * 5) / BigInt(100 * 86400 * 365));
        assert.equal(totalRewards.variableReward, 0);

        // distribute variable rewards
        await stakeManager.connect(distributor).distributeRewards([validator1], [ethers.parseEther('25')], {value: ethers.parseEther('25')});
        let fee = ethers.parseEther('25') / BigInt(20);

        totalRewards = await stakeManager.totalValidatorsRewards();
        assert.equal(totalRewards.fixedReward, fixedReward + ethers.parseEther('110') * BigInt(15 * 6) / BigInt(100 * 86400 * 365));
        assert.equal(totalRewards.variableReward, fee);

        totalRewards = await stakeManager.totalDelegatorsRewards();
        assert.equal(totalRewards.fixedReward, ethers.parseEther('10') * BigInt(13 * 12) / BigInt(100 * 86400 * 365));
        assert.equal(totalRewards.variableReward, ethers.parseEther('25') - fee);
      })

      it("Total rewards calculation per validator/delegator check", async ()=> {
        const { stakeManager, validator1, owner, delegator1 , distributor } = await loadFixture(deployFixture);

        let totalRewards = await stakeManager.totalValidatorReward(validator1);
        assert.equal(totalRewards.fixedReward, 0);
        assert.equal(totalRewards.variableReward, 0);

        totalRewards = await stakeManager.totalDelegatorRewardPerValidator(delegator1, validator1);
        assert.equal(totalRewards.fixedReward, 0);
        assert.equal(totalRewards.variableReward, 0);

        await stakeManager.connect(validator1).depositAsValidator(500, {value: ethers.parseEther('100')});
        // let v1Start = await time.latest();

        totalRewards = await stakeManager.totalValidatorReward(validator1);
        assert.equal(totalRewards.fixedReward, 0);
        assert.equal(totalRewards.variableReward, 0);

        totalRewards = await stakeManager.totalDelegatorRewardPerValidator(delegator1, validator1);
        assert.equal(totalRewards.fixedReward, 0);
        assert.equal(totalRewards.variableReward, 0);

        await time.increase(5);
        totalRewards = await stakeManager.totalValidatorReward(validator1);
        assert.equal(totalRewards.fixedReward, ethers.parseEther('100') * BigInt(15 * 5) / BigInt(100 * 86400 * 365));
        assert.equal(totalRewards.variableReward, 0);

        totalRewards = await stakeManager.totalDelegatorRewardPerValidator(delegator1, validator1);
        assert.equal(totalRewards.fixedReward, 0);
        assert.equal(totalRewards.variableReward, 0);

        await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('10')});
        // let d1Start = await time.latest();

        totalRewards = await stakeManager.totalDelegatorRewardPerValidator(delegator1, validator1);
        assert.equal(totalRewards.fixedReward, 0);
        assert.equal(totalRewards.variableReward, 0);

        await time.increase(5);

        totalRewards = await stakeManager.totalDelegatorRewardPerValidator(delegator1, validator1);
        assert.equal(totalRewards.fixedReward, ethers.parseEther('10') * BigInt(13 * 5) / BigInt(100 * 86400 * 365));
        assert.equal(totalRewards.variableReward, 0);

        await stakeManager.connect(validator1).depositAsValidator(0, {value: ethers.parseEther('10')});

        totalRewards = await stakeManager.totalValidatorReward(validator1);
        let fixedReward = ethers.parseEther('100') * BigInt(15 * 12) / BigInt(100 * 86400 * 365)
        assert.equal(totalRewards.fixedReward, fixedReward);
        assert.equal(totalRewards.variableReward, 0);

        await time.increase(5);

        totalRewards = await stakeManager.totalValidatorReward(validator1);
        assert.equal(totalRewards.fixedReward, fixedReward + ethers.parseEther('110') * BigInt(15 * 5) / BigInt(100 * 86400 * 365));
        assert.equal(totalRewards.variableReward, 0);

        // distribute variable rewards
        await stakeManager.connect(distributor).distributeRewards([validator1], [ethers.parseEther('25')], {value: ethers.parseEther('25')});
        let fee = ethers.parseEther('25') / BigInt(20);

        totalRewards = await stakeManager.totalValidatorReward(validator1);
        assert.equal(totalRewards.fixedReward, fixedReward + ethers.parseEther('110') * BigInt(15 * 6) / BigInt(100 * 86400 * 365));
        assert.equal(totalRewards.variableReward, fee);

        totalRewards = await stakeManager.totalDelegatorRewardPerValidator(delegator1, validator1);
        assert.equal(totalRewards.fixedReward, ethers.parseEther('10') * BigInt(13 * 12) / BigInt(100 * 86400 * 365));
        assert.equal(totalRewards.variableReward, ethers.parseEther('25') - fee);

        await time.increase(86400*30);

        fixedReward += ethers.parseEther('110') * BigInt(15 * (8 + 86400*30)) / BigInt(100 * 86400 * 365);
        await owner.sendTransaction({value: fixedReward, to: stakeManager});
        await stakeManager.connect(validator1).claimAsValidator();
        let info = await stakeManager.getValidatorInfo(validator1);
        assert.equal(info.fixedReward.totalClaimed, fixedReward);
        assert.equal(info.variableReward.totalClaimed, fee);

        await time.increase(5);

        await stakeManager.connect(distributor).distributeRewards([validator1], [ethers.parseEther('14')], {value: ethers.parseEther('14')});
        fee = ethers.parseEther('39') / BigInt(20);

        totalRewards = await stakeManager.totalValidatorReward(validator1);
        assert.equal(totalRewards.fixedReward, fixedReward + ethers.parseEther('110') * BigInt(15 * 6) / BigInt(100 * 86400 * 365));
        assert.equal(totalRewards.variableReward, fee);

        totalRewards = await stakeManager.totalDelegatorRewardPerValidator(delegator1, validator1);
        assert.equal(totalRewards.fixedReward, ethers.parseEther('10') * BigInt(13 * (20 + 86400*30)) / BigInt(100 * 86400 * 365));
        assert.equal(totalRewards.variableReward, ethers.parseEther('39') - fee);

        let fixedRewardD = ethers.parseEther('10') * BigInt(13 * (22 + 86400*30)) / BigInt(100 * 86400 * 365);
        await owner.sendTransaction({value: fixedRewardD, to: stakeManager});
        await stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator1);
        info = await stakeManager.getDelegatorInfo(delegator1);
        assert.equal(info.delegatorPerValidatorArr[0].variableReward.totalClaimed, ethers.parseEther('39') - fee);
        assert.equal(info.delegatorPerValidatorArr[0].fixedReward.totalClaimed, fixedRewardD);

        await time.increase(5);

        await stakeManager.connect(distributor).distributeRewards([validator1], [ethers.parseEther('2')], {value: ethers.parseEther('2')});

        totalRewards = await stakeManager.totalDelegatorRewardPerValidator(delegator1, validator1);
        assert.equal(totalRewards.fixedReward, fixedRewardD + ethers.parseEther('10') * BigInt(13 * 6) / BigInt(100 * 86400 * 365));
        assert.equal(totalRewards.variableReward, ethers.parseEther('41') * BigInt(95) / BigInt(100));
      })

      it("Deposit as delegator into several validators", async ()=> {
        const { stakeManager, validator1, validator2, owner, delegator1, delegator2_1, distributor } = await loadFixture(deployFixture);

        assert.equal((await stakeManager.totalValidatorsRewards()).fixedReward, 0);

        await stakeManager.connect(validator1).depositAsValidator(500, {value: ethers.parseEther('100')});
        let v1Start = await time.latest();
        await stakeManager.setValidatorsAPR(1600);
        let totalValidatorsRewards = ethers.parseEther('100') * BigInt(15) / BigInt(100 * time.duration.years(1));
        assert.equal((await stakeManager.totalValidatorsRewards()).fixedReward, totalValidatorsRewards);
        await stakeManager.connect(validator2).depositAsValidator(1100, {value: ethers.parseEther('100')});
        let v2Start = await time.latest();
        totalValidatorsRewards += ethers.parseEther('100') * BigInt(16) / BigInt(100 * time.duration.years(1));
        assert.equal((await stakeManager.totalValidatorsRewards()).fixedReward, totalValidatorsRewards);
        await stakeManager.connect(owner).depositAsValidator(1000, {value: ethers.parseEther('100')});
        let ownerStart = await time.latest();
        totalValidatorsRewards += ethers.parseEther('200') * BigInt(16) / BigInt(100 * time.duration.years(1));
        assert.equal((await stakeManager.totalValidatorsRewards()).fixedReward, totalValidatorsRewards);

        await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('10')});
        let start1 = await time.latest();
        await stakeManager.setDelegatorsAPR(1400);
        await stakeManager.connect(delegator1).depositAsDelegator(validator2, {value: ethers.parseEther('10')});
        let start2 = await time.latest();
        await stakeManager.connect(delegator2_1).depositAsDelegator(owner, {value: ethers.parseEther('10')});
        let startOwner2_1 = await time.latest();

        totalValidatorsRewards += ethers.parseEther('300') * BigInt(16 * 4) / BigInt(100 * time.duration.years(1));
        assert.equal((await stakeManager.totalValidatorsRewards()).fixedReward, totalValidatorsRewards);

        let delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);
        assert.equal(delegatorInfo.validatorsArr.length, 2);
        assert.equal(delegatorInfo.delegatorPerValidatorArr.length, 2);

        assert.equal(delegatorInfo.validatorsArr[0], validator1.address);
        assert.equal(delegatorInfo.validatorsArr[1], validator2.address);

        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].amount, ethers.parseEther('10'));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].storedValidatorAcc, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].calledForWithdraw, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].lastClaim, start1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.apr, 1300);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.lastUpdate, start1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.totalClaimed, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.variableReward, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.totalClaimed, 0);

        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].amount, ethers.parseEther('10'));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].storedValidatorAcc, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].calledForWithdraw, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].lastClaim, start2);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].fixedReward.apr, 1400);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].fixedReward.lastUpdate, start2);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].fixedReward.fixedReward, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].fixedReward.totalClaimed, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].variableReward.variableReward, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].variableReward.totalClaimed, 0);

        assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('300'));
        assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('30'));
        assert.equal(await stakeManager.isDelegator(delegator1), true);
        assert.equal(await stakeManager.isDelegator(delegator2_1), true);
        assert.equal(await stakeManager.isDelegator(owner), false);
        assert.equal(await stakeManager.isValidator(delegator1), false);
        assert.equal(await stakeManager.isValidator(validator1), true);
        assert.equal(await stakeManager.isValidator(validator2), true);
        assert.equal(await stakeManager.isValidator(owner), true);

        await time.increase(100);

        let reward = ethers.parseEther('5');
        await stakeManager.connect(distributor).distributeRewards([validator1, validator2, owner], [reward, reward, reward], {value: reward * BigInt(3)});

        let currentTime = await time.latest();

        assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, ethers.parseEther('100') * BigInt(currentTime - v1Start) * BigInt(15) / BigInt(100 * time.duration.years(1)));
        assert.equal((await stakeManager.validatorEarned(validator1)).variableReward, reward / BigInt(20));

        assert.equal((await stakeManager.validatorEarned(validator2)).fixedReward, ethers.parseEther('100') * BigInt(currentTime - v2Start) * BigInt(16) / BigInt(100 * time.duration.years(1)));
        assert.equal((await stakeManager.validatorEarned(validator2)).variableReward, reward * BigInt(11) / BigInt(100));

        assert.equal((await stakeManager.validatorEarned(owner)).fixedReward, ethers.parseEther('100') * BigInt(currentTime - ownerStart) * BigInt(16) / BigInt(100 * time.duration.years(1)));
        assert.equal((await stakeManager.validatorEarned(owner)).variableReward, reward / BigInt(10));

        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, ethers.parseEther('10') * BigInt(currentTime - start1) * BigInt(13) / BigInt(100 * time.duration.years(1)));
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).variableReward, reward - reward / BigInt(20));

        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator2)).fixedReward, ethers.parseEther('10') * BigInt(currentTime - start2) * BigInt(14) / BigInt(100 * time.duration.years(1)));
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator2)).variableReward, reward - reward * BigInt(11) / BigInt(100));

        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, owner)).fixedReward, 0);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, owner)).variableReward, 0);

        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, owner)).fixedReward, ethers.parseEther('10') * BigInt(currentTime - startOwner2_1) * BigInt(14) / BigInt(100 * time.duration.years(1)));
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, owner)).variableReward, reward - reward / BigInt(10));

        await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(owner)).to.be.revertedWithCustomError(stakeManager, "ValidatorsOnly").withArgs(owner);
        await expect(stakeManager.connect(delegator1).restakeAsDelegator(owner)).to.be.revertedWithCustomError(stakeManager, "DelegatorsOnly").withArgs(delegator1);

        await stakeManager.connect(validator2).validatorCallForWithdraw();
        let v2CalledForWithdraw = await time.latest();
        totalValidatorsRewards += ethers.parseEther('300') * BigInt(v2CalledForWithdraw - startOwner2_1) * BigInt(16) / BigInt(100 * time.duration.years(1)) + BigInt(1);
        assert.equal((await stakeManager.totalValidatorsRewards()).fixedReward, totalValidatorsRewards);
        assert.equal((await stakeManager.getValidatorInfo(validator2)).calledForWithdraw, v2CalledForWithdraw);

        await time.increase(5);
        assert.equal((await stakeManager.validatorEarned(validator2)).fixedReward, ethers.parseEther('100') * BigInt(16) * BigInt(v2CalledForWithdraw - v2Start) / BigInt(100 * time.duration.years(1)));
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator2)).fixedReward, ethers.parseEther('10') * BigInt(14) * BigInt(v2CalledForWithdraw - start2) / BigInt(100 * time.duration.years(1)));

        assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('200'));
        assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('20'));

        assert.equal(await stakeManager.stoppedValidatorsPool(), ethers.parseEther('100'));
        assert.equal(await stakeManager.stoppedDelegatorsPool(), ethers.parseEther('10'));

        await stakeManager.connect(delegator1).depositAsDelegator(owner, {value: ethers.parseEther('10')});
        let startOwner1 = await time.latest();
        delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);

        assert.equal(delegatorInfo.validatorsArr.length, 3);
        assert.equal(delegatorInfo.validatorsArr[0], validator1.address);
        assert.equal(delegatorInfo.validatorsArr[1], validator2.address);
        assert.equal(delegatorInfo.validatorsArr[2], owner.address);

        assert.equal(delegatorInfo.delegatorPerValidatorArr.length, 3);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].amount, ethers.parseEther('10'));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].storedValidatorAcc, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].calledForWithdraw, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].lastClaim, start1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.apr, 1300);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.lastUpdate, start1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.totalClaimed, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.variableReward, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.totalClaimed, 0);

        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].amount, ethers.parseEther('10'));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].storedValidatorAcc, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].calledForWithdraw, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].lastClaim, start2);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].fixedReward.apr, 1400);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].fixedReward.fixedReward, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].fixedReward.lastUpdate, start2);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].fixedReward.totalClaimed, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].variableReward.variableReward, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].variableReward.totalClaimed, 0);

        assert.equal(delegatorInfo.delegatorPerValidatorArr[2].amount, ethers.parseEther('10'));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[2].storedValidatorAcc, (reward - reward / BigInt(10)) * ethers.parseEther('1') / ethers.parseEther('10'));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[2].calledForWithdraw, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[2].lastClaim, startOwner1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[2].fixedReward.apr, 1400);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[2].fixedReward.fixedReward, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[2].fixedReward.lastUpdate, startOwner1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[2].fixedReward.totalClaimed, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[2].variableReward.variableReward, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[2].variableReward.totalClaimed, 0);

        await stakeManager.setValidatorsAmountToSlash(0);

        await stakeManager.connect(distributor).slash([validator1]);
        currentTime = await time.latest();
        let validator1Info = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validator1Info.amount, ethers.parseEther("100"));
        assert.equal(validator1Info.commission, 500);
        assert.equal(validator1Info.lastClaim, v1Start);
        assert.equal(validator1Info.calledForWithdraw, 0);
        assert.equal(validator1Info.vestingEnd, 0);
        assert.equal(validator1Info.fixedReward.apr, 1600);
        assert.equal(validator1Info.fixedReward.lastUpdate, currentTime);
        assert.equal(validator1Info.fixedReward.fixedReward, ethers.parseEther("100") * BigInt(currentTime - v1Start) * BigInt(15) / BigInt(100 * time.duration.years(1)));
        assert.equal(validator1Info.fixedReward.totalClaimed, 0);
        assert.equal(validator1Info.variableReward.variableReward, reward / BigInt(20));
        assert.equal(validator1Info.variableReward.totalClaimed, 0);
        assert.equal(validator1Info.delegatedAmount, 0);
        assert.equal(validator1Info.stoppedDelegatedAmount, ethers.parseEther('10') * BigInt(95) / BigInt(100));
        assert.equal(validator1Info.delegatorsAcc, (reward - reward / BigInt(20)) * ethers.parseEther('1') / ethers.parseEther('10'));
        assert.equal(validator1Info.delegators.length, 1);
        assert.equal(validator1Info.delegators[0], delegator1.address);

        delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].amount, ethers.parseEther('10') * BigInt(95) / BigInt(100));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].storedValidatorAcc, (reward - reward / BigInt(20)) * ethers.parseEther('1') / ethers.parseEther('10'));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].calledForWithdraw, currentTime);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].lastClaim, start1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.apr, 1400);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, ethers.parseEther('10') * BigInt(currentTime - start1) * BigInt(13) / BigInt(100 * time.duration.years(1)));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.lastUpdate, currentTime);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.totalClaimed, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.variableReward, reward - reward / BigInt(20));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.totalClaimed, 0);

        let rewards = await stakeManager.delegatorEarnedPerValidators(delegator1, [validator1, validator2, owner]);
        assert.equal(rewards.fixedRewards.length, 3);
        assert.equal(rewards.variableRewards.length, 3);
        assert.equal(rewards.fixedRewards[0], delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward);
        assert.equal(rewards.fixedRewards[1], ethers.parseEther('10') * BigInt(14) * BigInt(v2CalledForWithdraw - start2) / BigInt(100 * time.duration.years(1)));
        assert.equal(rewards.fixedRewards[2], ethers.parseEther('10') * BigInt(14) * BigInt(await time.latest() - startOwner1) / BigInt(100*time.duration.years(1)));
        assert.equal(rewards.variableRewards[0], reward - reward / BigInt(20));
        assert.equal(rewards.variableRewards[1], reward - reward * BigInt(11) / BigInt(100));
        assert.equal(rewards.variableRewards[2], 0);

        assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('20'));
        assert.equal(await stakeManager.stoppedDelegatorsPool(), ethers.parseEther('10') + ethers.parseEther('10') * BigInt(95) / BigInt(100));

        assert.equal((await stakeManager.totalValidatorsRewards()).variableReward, reward / BigInt(20) + reward / BigInt(10) + reward * BigInt(11) / BigInt(100));
        totalValidatorsRewards += ethers.parseEther('200') * BigInt(16) * BigInt(currentTime - v2CalledForWithdraw) / BigInt(100 * time.duration.years(1));
        assert.equal((await stakeManager.totalValidatorsRewards()).fixedReward, totalValidatorsRewards);

        assert.equal((await stakeManager.totalDelegatorsRewards()).variableReward, reward * BigInt(3) - reward / BigInt(20) - reward / BigInt(10) - reward * BigInt(11) / BigInt(100));
        assert.equal((await stakeManager.totalDelegatorsRewards()).fixedReward, 
          ethers.parseEther('10') * BigInt(13) / BigInt(100*time.duration.years(1)) + 
          ethers.parseEther('10') * BigInt(14) / BigInt(100*time.duration.years(1)) + 
          ethers.parseEther('20') * BigInt(14) / BigInt(100*time.duration.years(1)) + 
          ethers.parseEther('30') * BigInt(14) * BigInt(v2CalledForWithdraw - startOwner2_1) / BigInt(100*time.duration.years(1)) + 
          ethers.parseEther('20') * BigInt(14) * BigInt(startOwner1 - v2CalledForWithdraw) / BigInt(100*time.duration.years(1)) + 
          ethers.parseEther('30') * BigInt(14) * BigInt(currentTime - startOwner1) / BigInt(100*time.duration.years(1))
        );

        await time.increase(time.duration.days(30));

        let fixedReward = ethers.parseEther('10') * BigInt(14) * BigInt(v2CalledForWithdraw - start2) / BigInt(100 * time.duration.years(1));
        await owner.sendTransaction({to: stakeManager.target, value: fixedReward});
        await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator2)).to.changeEtherBalances([stakeManager, delegator1], [-fixedReward - reward + reward * BigInt(11) / BigInt(100) , fixedReward + reward - reward * BigInt(11) / BigInt(100)]);
        
        await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator2)).to.changeEtherBalances([stakeManager, delegator1], [0,0]);
        await expect(stakeManager.connect(delegator1).restakeAsDelegator(validator2)).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(0);

        // check removing validators from delegator info
        fixedReward = ethers.parseEther('100') * BigInt(16) * BigInt(v2CalledForWithdraw - v2Start) / BigInt(100 * time.duration.years(1));
        await owner.sendTransaction({to: stakeManager.target, value: fixedReward});
        await expect(stakeManager.connect(validator2).withdrawAsValidator()).to.changeEtherBalances([stakeManager, validator2, delegator1], [-(fixedReward + ethers.parseEther('100') + reward * BigInt(11) / BigInt(100) + ethers.parseEther('10')), ethers.parseEther('100') + fixedReward + reward * BigInt(11) / BigInt(100), ethers.parseEther('10')]);

        delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);
        assert.equal(delegatorInfo.validatorsArr.length, 2);
        assert.equal(delegatorInfo.validatorsArr[0], validator1.address);
        assert.equal(delegatorInfo.validatorsArr[1], owner.address);
        assert.equal(delegatorInfo.delegatorPerValidatorArr.length, 2);

        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].amount, ethers.parseEther('10') * BigInt(95) / BigInt(100));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].storedValidatorAcc, (reward - reward / BigInt(20)) * ethers.parseEther('1') / ethers.parseEther('10'));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].calledForWithdraw, currentTime);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].lastClaim, start1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.apr, 1400);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, ethers.parseEther('10') * BigInt(currentTime - start1) * BigInt(13) / BigInt(100 * time.duration.years(1)));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.lastUpdate, currentTime);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.totalClaimed, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.variableReward, reward - reward / BigInt(20));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.totalClaimed, 0);

        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].amount, ethers.parseEther('10'));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].storedValidatorAcc, (reward - reward / BigInt(10)) * ethers.parseEther('1') / ethers.parseEther('10'));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].calledForWithdraw, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].lastClaim, startOwner1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].fixedReward.apr, 1400);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].fixedReward.fixedReward, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].fixedReward.lastUpdate, startOwner1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].fixedReward.totalClaimed, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].variableReward.variableReward, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[1].variableReward.totalClaimed, 0);

        fixedReward = delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward;
        await owner.sendTransaction({to: stakeManager.target, value: fixedReward});
        await expect(stakeManager.connect(delegator1).withdrawAsDelegator(validator1)).to.changeEtherBalances([stakeManager, delegator1], [-(ethers.parseEther('10') * BigInt(95) / BigInt(100) + fixedReward + reward - reward / BigInt(20)), ethers.parseEther('10') * BigInt(95) / BigInt(100) + fixedReward + reward - reward / BigInt(20)])

        delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);
        assert.equal(delegatorInfo.validatorsArr.length, 1);
        assert.equal(delegatorInfo.validatorsArr[0], owner.address);
        assert.equal(delegatorInfo.delegatorPerValidatorArr.length, 1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].amount, ethers.parseEther('10'));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].storedValidatorAcc, (reward - reward / BigInt(10)) * ethers.parseEther('1') / ethers.parseEther('10'));
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].calledForWithdraw, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].lastClaim, startOwner1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.apr, 1400);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.lastUpdate, startOwner1);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.totalClaimed, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.variableReward, 0);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].variableReward.totalClaimed, 0);

        assert.equal(await stakeManager.isDelegator(delegator1), true); // still delegator
      })

      // passed false test to find and fix a bug
      /* it("Delegator with not-enough deposit amount revives after reviveAsValidator", async ()=> {
        const { stakeManager, validator1, delegator1, distributor, slashReceiver } = await loadFixture(deployFixture);

        await stakeManager.connect(validator1).depositAsValidator(500, {value: ethers.parseEther('100')});
        let v1Start = await time.latest();

        await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('10')});
        let d1Start = await time.latest();

        await time.increase(86400);

        await stakeManager.connect(validator1).validatorCallForWithdraw();
        let cfw = await time.latest();

        await time.increase(5);

        let currentTime = await time.latest();

        assert.equal((await stakeManager.getValidatorInfo(validator1)).calledForWithdraw, cfw);
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).delegatorPerValidatorArr[0].calledForWithdraw, 0);

        let vReward = BigInt(cfw - v1Start) * BigInt(15) * ethers.parseEther('100') / BigInt(86400*365*100);
        let dReward = BigInt(cfw - d1Start) * BigInt(13) * ethers.parseEther('10') / BigInt(86400*365*100);
        assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, vReward);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, dReward);

        // slash (validator and delegator becomes lower than minimum)

        await expect(stakeManager.connect(distributor).slash([validator1])).to.changeEtherBalance(slashReceiver, ethers.parseEther('100') + ethers.parseEther('0.5'));
        assert.equal((await stakeManager.getValidatorInfo(validator1)).amount , 0);
        assert.equal((await stakeManager.getValidatorInfo(validator1)).calledForWithdraw , cfw);
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).delegatorPerValidatorArr[0].amount , ethers.parseEther('9.5'));
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).delegatorPerValidatorArr[0].calledForWithdraw , 0);

        assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, vReward);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, dReward);

        await stakeManager.connect(validator1).reviveAsValidator({value: ethers.parseEther('100')});
        let reviveTime = await time.latest();
        assert.equal((await stakeManager.getValidatorInfo(validator1)).amount, ethers.parseEther('100'));
        assert.equal((await stakeManager.getValidatorInfo(validator1)).calledForWithdraw, 0);
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).delegatorPerValidatorArr[0].amount, ethers.parseEther('9.5'));
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).delegatorPerValidatorArr[0].calledForWithdraw, 0);

        assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, vReward);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, dReward);

        assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('100'));
        assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('9.5'));
        assert.equal(await stakeManager.stoppedValidatorsPool(), 0);
        assert.equal(await stakeManager.stoppedDelegatorsPool(), 0);

        await time.increase(86400);

        assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, vReward + BigInt(86400) * ethers.parseEther('100') * BigInt(15) / BigInt(100*86400*365));
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, dReward + BigInt(86400) * ethers.parseEther('9.5') * BigInt(13) / BigInt(100*86400*365));
      }) */

      // passed correct test
      it("Do not revive delegators with not enough deposit amount after reviveAsValidator", async ()=> {
        const { stakeManager, validator1, delegator1, distributor, slashReceiver } = await loadFixture(deployFixture);

        await stakeManager.connect(validator1).depositAsValidator(500, {value: ethers.parseEther('100')});
        const v1Start = await time.latest();

        await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('10')});
        let d1Start = await time.latest();

        await time.increase(86400);

        await stakeManager.connect(validator1).validatorCallForWithdraw();
        let cfw = await time.latest();

        await time.increase(5);

        assert.equal((await stakeManager.getValidatorInfo(validator1)).calledForWithdraw, cfw);
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).delegatorPerValidatorArr[0].calledForWithdraw, 0);

        let vReward = BigInt(cfw - v1Start) * BigInt(15) * ethers.parseEther('100') / BigInt(86400*365*100);
        let dReward = BigInt(cfw - d1Start) * BigInt(13) * ethers.parseEther('10') / BigInt(86400*365*100);
        assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, vReward);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, dReward);

        // slash (validator and delegator becomes lower than minimum)

        await expect(stakeManager.connect(distributor).slash([validator1])).to.changeEtherBalance(slashReceiver, ethers.parseEther('100') + ethers.parseEther('0.5'));
        let cfwd = await time.latest();

        assert.equal((await stakeManager.getValidatorInfo(validator1)).amount , 0);
        assert.equal((await stakeManager.getValidatorInfo(validator1)).calledForWithdraw , cfw);
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).delegatorPerValidatorArr[0].amount , ethers.parseEther('9.5'));
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).delegatorPerValidatorArr[0].calledForWithdraw , cfwd);

        assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, vReward);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, dReward);

        await stakeManager.connect(validator1).reviveAsValidator({value: ethers.parseEther('100')});
        let reviveTime = await time.latest();
        assert.equal((await stakeManager.getValidatorInfo(validator1)).amount, ethers.parseEther('100'));
        assert.equal((await stakeManager.getValidatorInfo(validator1)).calledForWithdraw, 0);
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).delegatorPerValidatorArr[0].amount, ethers.parseEther('9.5'));
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).delegatorPerValidatorArr[0].calledForWithdraw, cfwd);

        assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, vReward);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, dReward);

        assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('100'));
        assert.equal(await stakeManager.totalDelegatorsPool(), 0);
        assert.equal(await stakeManager.stoppedValidatorsPool(), 0);
        assert.equal(await stakeManager.stoppedDelegatorsPool(), ethers.parseEther('9.5'));

        assert.equal((await stakeManager.getValidatorInfo(validator1)).delegatedAmount, 0);
        assert.equal((await stakeManager.getValidatorInfo(validator1)).stoppedDelegatedAmount, ethers.parseEther('9.5'));

        await time.increase(86400);

        vReward += BigInt(86400) * ethers.parseEther('100') * BigInt(15) / BigInt(100*86400*365);
        assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, vReward);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, dReward);

        // revive as delegator

        await stakeManager.connect(delegator1).reviveAsDelegator(validator1, {value: ethers.parseEther('1.5')});
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).delegatorPerValidatorArr[0].amount, ethers.parseEther('11'));
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).delegatorPerValidatorArr[0].calledForWithdraw, 0);
        assert.equal((await stakeManager.getValidatorInfo(validator1)).delegatedAmount, ethers.parseEther('11'));
        assert.equal((await stakeManager.getValidatorInfo(validator1)).stoppedDelegatedAmount, 0);
        assert.equal(await stakeManager.totalValidatorsPool(), ethers.parseEther('100'));
        assert.equal(await stakeManager.totalDelegatorsPool(), ethers.parseEther('11'));
        assert.equal(await stakeManager.stoppedValidatorsPool(), 0);
        assert.equal(await stakeManager.stoppedDelegatorsPool(), 0);

        vReward += ethers.parseEther('100') * BigInt(15) / BigInt(100*86400*365);
        assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, vReward);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, dReward);

        await time.increase(86400);
        vReward += BigInt(86400)*ethers.parseEther('100') * BigInt(15) / BigInt(100*86400*365);
        dReward += BigInt(86400)*ethers.parseEther('11') * BigInt(13) / BigInt(100*86400*365);
        assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, vReward);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, dReward);

        let info = await stakeManager.getDelegatorsInfoPerValidator(validator1);
        assert.equal(info.delegators.length, 1);
        assert.equal(info.delegators[0], delegator1.address);

        assert.equal(info.delegatorPerValidatorArr.length, 1);
        assert.equal(info.delegatorPerValidatorArr[0].amount, ethers.parseEther('11'));
      })

      // passed false test to wrong validators/delegators arrays accounting
      /* it("Wrong _validatorInfo[validator].delegators accounting check", async ()=> {
        const { stakeManager, validator1, delegator1, distributor } = await loadFixture(deployFixture);

        await stakeManager.setValidatorsWithdrawCooldown(5);
        await stakeManager.setDelegatorsWithdrawCooldown(5);
        await stakeManager.setValidatorsClaimCooldown(5);
        await stakeManager.setDelegatorsClaimCooldown(5);

        // TO USE, IMPLEMENT IT FIRST
         
          // TEST METHOD
          //function validatorContainsDelegator(address validator, address delegator) public view returns(bool) {
              //return _validatorInfo[validator].delegators.contains(delegator);
          //}

          //function delegatorContainsValidator(address validator, address delegator) public view returns(bool) {
              //return _delegatorInfo[delegator].validators.contains(validator);
          //}
        
        assert.equal(await stakeManager.validatorContainsDelegator(validator1, delegator1), false);
        assert.equal(await stakeManager.delegatorContainsValidator(validator1, delegator1), false);

        await stakeManager.connect(validator1).depositAsValidator('1000', {value: ethers.parseEther('100')});
        let vInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(vInfo.delegators.length, 0);
        assert.equal(vInfo.delegatedAmount, 0);
        assert.equal(await stakeManager.validatorContainsDelegator(validator1, delegator1), false);
        assert.equal(await stakeManager.delegatorContainsValidator(validator1, delegator1), false);

        await time.increase(5);
        await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('14')});
        let dInfo = await stakeManager.getDelegatorInfo(delegator1);
        assert.equal(dInfo.validatorsArr.length, 1);
        assert.equal(dInfo.validatorsArr[0], validator1.address);

        vInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(vInfo.delegators.length, 1);
        assert.equal(vInfo.delegators[0], delegator1.address);
        assert.equal(vInfo.delegatedAmount, ethers.parseEther('14'));
        assert.equal(await stakeManager.validatorContainsDelegator(validator1, delegator1), true);
        assert.equal(await stakeManager.delegatorContainsValidator(validator1, delegator1), true);

        await time.increase(100);

        await stakeManager.connect(validator1).validatorCallForWithdraw();
        let cfw = await time.latest();

        vInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(vInfo.stoppedDelegatedAmount, ethers.parseEther('14'));
        assert.equal(vInfo.delegatedAmount, 0);

        await time.increase(10);

        let vReward = await stakeManager.validatorEarned(validator1);
        let dReward = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);

        assert.equal(vReward.fixedReward, (BigInt(cfw) - vInfo.lastClaim) * ethers.parseEther('100') * BigInt(15) / BigInt(86400*100*365));
        assert.equal(vReward.variableReward, 0);
        assert.equal(dReward.fixedReward, (BigInt(cfw) - dInfo.delegatorPerValidatorArr[0].lastClaim) * ethers.parseEther('14') * BigInt(13) / BigInt(86400*100*365));
        assert.equal(dReward.variableReward, 0);

        await distributor.sendTransaction({to:stakeManager.target, value: vReward.fixedReward + dReward.fixedReward});

        // able to call for full withdraw
        await expect(stakeManager.connect(validator1).withdrawAsValidator()).to.changeEtherBalances(
          [stakeManager, validator1, delegator1], 
          [-(vReward.fixedReward + dReward.fixedReward + ethers.parseEther('114')), ethers.parseEther('100') + vReward.fixedReward, ethers.parseEther('14') + dReward.fixedReward]
        );

        vInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(vInfo.delegators.length, 0);
        assert.equal(vInfo.delegatedAmount, 0);
        assert.equal(vInfo.stoppedDelegatedAmount, 0);
        assert.equal(await stakeManager.validatorContainsDelegator(validator1, delegator1), true); // <-- THAT'S A BUG, IT'S FALSE BEHAVIOUR!!!!
        assert.equal(await stakeManager.delegatorContainsValidator(validator1, delegator1), false); // THAT'S RIGHT BEHAVIOUR!!

        dInfo = await stakeManager.getDelegatorInfo(delegator1);
        assert.equal(dInfo.validatorsArr.length, 0);
        assert.equal(dInfo.delegatorPerValidatorArr.length, 0);

        vReward = await stakeManager.validatorEarned(validator1);
        dReward = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);

        assert.equal(vReward.fixedReward, 0);
        assert.equal(vReward.variableReward, 0);
        assert.equal(dReward.fixedReward, 0);
        assert.equal(dReward.variableReward, 0);

        // another deposit from same validator
        await stakeManager.connect(validator1).depositAsValidator('200', {value: ethers.parseEther('200')});
        vInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(vInfo.amount, ethers.parseEther('200'));
        assert.equal(vInfo.commission, '200');
        assert.equal(vInfo.delegators.length, 0);
        assert.equal(vInfo.delegatedAmount, 0);
        assert.equal(vInfo.stoppedDelegatedAmount, 0);
        assert.equal(await stakeManager.validatorContainsDelegator(validator1, delegator1), true); // <-- THAT'S A BUG, IT'S FALSE BEHAVIOUR!!!!
        assert.equal(await stakeManager.delegatorContainsValidator(validator1, delegator1), false); // THAT'S RIGHT BEHAVIOUR!!

        // another deposit from same delegator
        await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('11')});
        dInfo = await stakeManager.getDelegatorInfo(delegator1);
        assert.equal(dInfo.validatorsArr.length, 1);
        assert.equal(dInfo.validatorsArr[0], validator1.address); // THAT'S RIGHT BEHAVIOUR!!

        vInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(vInfo.delegators.length, 0); // <-- THAT'S A BUG, IT'S FALSE BEHAVIOUR!!!!
        assert.equal(vInfo.delegatedAmount, ethers.parseEther('11'));
        assert.equal(vInfo.stoppedDelegatedAmount, 0);
      }) */

      // passed correct test
      it("Fix wrong _validatorInfo[validator].delegators accounting", async ()=> {
        const { stakeManager, validator1, delegator1, distributor } = await loadFixture(deployFixture);

        await stakeManager.setValidatorsWithdrawCooldown(5);
        await stakeManager.setDelegatorsWithdrawCooldown(5);
        await stakeManager.setValidatorsClaimCooldown(5);
        await stakeManager.setDelegatorsClaimCooldown(5);

        // TO USE, IMPLEMENT IT FIRST
        /* 
          // TEST METHOD
          function validatorContainsDelegator(address validator, address delegator) public view returns(bool) {
              return _validatorInfo[validator].delegators.contains(delegator);
          }

          function delegatorContainsValidator(address validator, address delegator) public view returns(bool) {
              return _delegatorInfo[delegator].validators.contains(validator);
          }
        */
        // assert.equal(await stakeManager.validatorContainsDelegator(validator1, delegator1), false);
        // assert.equal(await stakeManager.delegatorContainsValidator(validator1, delegator1), false);

        await stakeManager.connect(validator1).depositAsValidator('1000', {value: ethers.parseEther('100')});
        let vInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(vInfo.delegators.length, 0);
        assert.equal(vInfo.delegatedAmount, 0);
        // assert.equal(await stakeManager.validatorContainsDelegator(validator1, delegator1), false);
        // assert.equal(await stakeManager.delegatorContainsValidator(validator1, delegator1), false);

        await time.increase(5);
        await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('14')});
        let dInfo = await stakeManager.getDelegatorInfo(delegator1);
        assert.equal(dInfo.validatorsArr.length, 1);
        assert.equal(dInfo.validatorsArr[0], validator1.address);

        vInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(vInfo.delegators.length, 1);
        assert.equal(vInfo.delegators[0], delegator1.address);
        assert.equal(vInfo.delegatedAmount, ethers.parseEther('14'));
        // assert.equal(await stakeManager.validatorContainsDelegator(validator1, delegator1), true);
        // assert.equal(await stakeManager.delegatorContainsValidator(validator1, delegator1), true);

        await time.increase(100);

        await stakeManager.connect(validator1).validatorCallForWithdraw();
        let cfw = await time.latest();

        vInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(vInfo.stoppedDelegatedAmount, ethers.parseEther('14'));
        assert.equal(vInfo.delegatedAmount, 0);

        await time.increase(10);

        let vReward = await stakeManager.validatorEarned(validator1);
        let dReward = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);

        assert.equal(vReward.fixedReward, (BigInt(cfw) - vInfo.lastClaim) * ethers.parseEther('100') * BigInt(15) / BigInt(86400*100*365));
        assert.equal(vReward.variableReward, 0);
        assert.equal(dReward.fixedReward, (BigInt(cfw) - dInfo.delegatorPerValidatorArr[0].lastClaim) * ethers.parseEther('14') * BigInt(13) / BigInt(86400*100*365));
        assert.equal(dReward.variableReward, 0);

        await distributor.sendTransaction({to:stakeManager.target, value: vReward.fixedReward + dReward.fixedReward});

        // able to call for full withdraw
        await expect(stakeManager.connect(validator1).withdrawAsValidator()).to.changeEtherBalances(
          [stakeManager, validator1, delegator1], 
          [-(vReward.fixedReward + dReward.fixedReward + ethers.parseEther('114')), ethers.parseEther('100') + vReward.fixedReward, ethers.parseEther('14') + dReward.fixedReward]
        );

        vInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(vInfo.delegators.length, 0);
        assert.equal(vInfo.delegatedAmount, 0);
        assert.equal(vInfo.stoppedDelegatedAmount, 0);
        // assert.equal(await stakeManager.validatorContainsDelegator(validator1, delegator1), false); // THAT'S RIGHT BEHAVIOUR!!
        // assert.equal(await stakeManager.delegatorContainsValidator(validator1, delegator1), false); // THAT'S RIGHT BEHAVIOUR!!

        dInfo = await stakeManager.getDelegatorInfo(delegator1);
        assert.equal(dInfo.validatorsArr.length, 0);
        assert.equal(dInfo.delegatorPerValidatorArr.length, 0);

        vReward = await stakeManager.validatorEarned(validator1);
        dReward = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);

        assert.equal(vReward.fixedReward, 0);
        assert.equal(vReward.variableReward, 0);
        assert.equal(dReward.fixedReward, 0);
        assert.equal(dReward.variableReward, 0);

        // another deposit from same validator
        await stakeManager.connect(validator1).depositAsValidator('500', {value: ethers.parseEther('200')});
        vInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(vInfo.amount, ethers.parseEther('200'));
        assert.equal(vInfo.commission, '500');
        assert.equal(vInfo.delegators.length, 0);
        assert.equal(vInfo.delegatedAmount, 0);
        assert.equal(vInfo.stoppedDelegatedAmount, 0);
        // assert.equal(await stakeManager.validatorContainsDelegator(validator1, delegator1), false); // THAT'S RIGHT BEHAVIOUR!!
        // assert.equal(await stakeManager.delegatorContainsValidator(validator1, delegator1), false); // THAT'S RIGHT BEHAVIOUR!!

        // another deposit from same delegator
        await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('11')});
        dInfo = await stakeManager.getDelegatorInfo(delegator1);
        assert.equal(dInfo.validatorsArr.length, 1);
        assert.equal(dInfo.validatorsArr[0], validator1.address); // THAT'S RIGHT BEHAVIOUR!!

        vInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(vInfo.delegators.length, 1); // THAT'S RIGHT BEHAVIOUR!!
        assert.equal(vInfo.delegators[0], delegator1.address);
        assert.equal(vInfo.delegatedAmount, ethers.parseEther('11'));
        assert.equal(vInfo.stoppedDelegatedAmount, 0);
      })

      it("Update slash mechanics (after the 2nd slashing withdraw an additional penalty - fixed APR reward, earned since previous slashing); improves for validators only!", async ()=> {
        const {stakeManager, validator1, delegator1, delegator2_1, distributor, swap, slashReceiver} = await loadFixture(deployFixture);
        
        await stakeManager.grantRole(await stakeManager.SWAP_ROLE(), swap.address);

        await stakeManager.setValidatorsAmountToSlash(ethers.parseEther('10'));

        // validator deposit
        let vestingEnd = await time.latest() + 86400;
        await expect(stakeManager.connect(swap).depositForValidator(validator1, '1000', vestingEnd, {value: ethers.parseEther('200')})).to.changeEtherBalances([stakeManager, swap, validator1], [ethers.parseEther('200'), -ethers.parseEther('200'), 0]);
        let v1Start = await time.latest();

        let validatorInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validatorInfo.amount, ethers.parseEther('200'));
        assert.equal(validatorInfo.commission, '1000');
        assert.equal(validatorInfo.lastClaim, v1Start);
        assert.equal(validatorInfo.calledForWithdraw, 0);
        assert.equal(validatorInfo.vestingEnd, vestingEnd);
        assert.equal(validatorInfo.fixedReward.apr, '1500');
        assert.equal(validatorInfo.fixedReward.lastUpdate, v1Start);
        assert.equal(validatorInfo.fixedReward.fixedReward, 0);
        assert.equal(validatorInfo.fixedReward.totalClaimed, 0);
        assert.equal(validatorInfo.variableReward.variableReward, 0);
        assert.equal(validatorInfo.variableReward.totalClaimed, 0);
        assert.equal(validatorInfo.penalty.potentialPenalty, 0);
        assert.equal(validatorInfo.penalty.lastSlash, 0);
        assert.equal(validatorInfo.delegatedAmount, 0);
        assert.equal(validatorInfo.stoppedDelegatedAmount, 0);
        assert.equal(validatorInfo.delegatorsAcc, 0);
        assert.equal(validatorInfo.delegators.length, 0);

        // 1st distribute rewards, delegators pool == 0
        await time.increase(5);
        await expect(stakeManager.connect(distributor).distributeRewards([validator1, delegator1], [ethers.parseEther('1'), ethers.parseEther('1')], {value: ethers.parseEther('2')})).to.changeEtherBalances([stakeManager, distributor], [ethers.parseEther('1'), -ethers.parseEther('1')]);

        // 1st delegators deposit
        await time.increase(5);
        await expect(stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('12')})).to.changeEtherBalances([stakeManager, delegator1], [ethers.parseEther('12'), -ethers.parseEther('12')]);
        let d1Start = await time.latest();

        let validatorReward = await stakeManager.validatorEarned(validator1);
        assert.equal(validatorReward.fixedReward, BigInt(d1Start - v1Start) * ethers.parseEther('200') * BigInt(15) / BigInt(100*86400*365));
        assert.equal(validatorReward.variableReward, ethers.parseEther('1'));

        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, 0);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).variableReward, 0);

        validatorInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validatorInfo.amount, ethers.parseEther('200'));
        assert.equal(validatorInfo.commission, '1000');
        assert.equal(validatorInfo.lastClaim, v1Start);
        assert.equal(validatorInfo.calledForWithdraw, 0);
        assert.equal(validatorInfo.vestingEnd, vestingEnd);
        assert.equal(validatorInfo.fixedReward.apr, '1500');
        assert.equal(validatorInfo.fixedReward.lastUpdate, v1Start);
        assert.equal(validatorInfo.fixedReward.fixedReward, 0);
        assert.equal(validatorInfo.fixedReward.totalClaimed, 0);
        assert.equal(validatorInfo.variableReward.variableReward, ethers.parseEther('1'));
        assert.equal(validatorInfo.variableReward.totalClaimed, 0);
        assert.equal(validatorInfo.penalty.potentialPenalty, 0);
        assert.equal(validatorInfo.penalty.lastSlash, 0);
        assert.equal(validatorInfo.delegatedAmount, ethers.parseEther('12'));
        assert.equal(validatorInfo.stoppedDelegatedAmount, 0);
        assert.equal(validatorInfo.delegatorsAcc, 0);
        assert.equal(validatorInfo.delegators.length, 1);
        assert.equal(validatorInfo.delegators[0], delegator1.address);

        await time.increase(10);

        let slashAmount = ethers.parseEther('10') + ethers.parseEther('12') * BigInt(5) / BigInt(100);
        await expect(stakeManager.connect(distributor).slash([validator1])).to.changeEtherBalances([slashReceiver, stakeManager], [slashAmount, -slashAmount]);
        let slashTime = await time.latest();
        validatorInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validatorInfo.amount, ethers.parseEther('190'));
        assert.equal(validatorInfo.commission, '1000');
        assert.equal(validatorInfo.lastClaim, v1Start);
        assert.equal(validatorInfo.calledForWithdraw, 0);
        assert.equal(validatorInfo.vestingEnd, vestingEnd);
        assert.equal(validatorInfo.fixedReward.apr, '1500');
        assert.equal(validatorInfo.fixedReward.lastUpdate, slashTime);
        assert.equal(validatorInfo.fixedReward.fixedReward, validatorReward.fixedReward + BigInt(11 * 15) * ethers.parseEther('200') / BigInt(100*365*86400));
        assert.equal(validatorInfo.fixedReward.totalClaimed, 0);
        assert.equal(validatorInfo.variableReward.variableReward, ethers.parseEther('1'));
        assert.equal(validatorInfo.variableReward.totalClaimed, 0);
        assert.equal(validatorInfo.penalty.potentialPenalty, 0);
        assert.equal(validatorInfo.penalty.lastSlash, slashTime);
        assert.equal(validatorInfo.delegatedAmount, ethers.parseEther('12') * BigInt(95) / BigInt(100));
        assert.equal(validatorInfo.stoppedDelegatedAmount, 0);
        assert.equal(validatorInfo.delegatorsAcc, 0);
        assert.equal(validatorInfo.delegators.length, 1);
        assert.equal(validatorInfo.delegators[0], delegator1.address);

        let delegator1Info = await stakeManager.getDelegatorInfo(delegator1);
        assert.equal(delegator1Info.validatorsArr.length, 1);
        assert.equal(delegator1Info.validatorsArr[0], validator1.address);
        assert.equal(delegator1Info.delegatorPerValidatorArr.length, 1);
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].amount, ethers.parseEther('12') * BigInt(95) / BigInt(100));
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].storedValidatorAcc, 0);
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].calledForWithdraw, 0);
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].lastClaim, d1Start);
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].fixedReward.apr, '1300');
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].fixedReward.lastUpdate, slashTime);
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].fixedReward.fixedReward, BigInt(11 * 13) * ethers.parseEther('12') / BigInt(100*365*86400));
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].fixedReward.totalClaimed, 0);
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].variableReward.variableReward, 0);
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].variableReward.totalClaimed, 0);

        validatorReward = await stakeManager.validatorEarned(validator1);
        let delegator1Reward = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);

        await time.increase(100);

        await stakeManager.connect(distributor).distributeRewards([validator1], [ethers.parseEther('2')], {value: ethers.parseEther('2')});
        let distributeTime = await time.latest();
        let penalty = BigInt(distributeTime - slashTime) * validatorInfo.amount * BigInt(15) / BigInt(86400*365*100);
        assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, validatorReward.fixedReward + penalty);
        assert.equal((await stakeManager.validatorEarned(validator1)).variableReward, ethers.parseEther('2') / BigInt(10) + ethers.parseEther('1'));
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, delegator1Reward.fixedReward + BigInt(distributeTime - slashTime) * delegator1Info.delegatorPerValidatorArr[0].amount * BigInt(13) / BigInt(86400*365*100));
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).variableReward, ethers.parseEther('2') * BigInt(9) / BigInt(10) - BigInt(2));

        delegator1Reward = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);

        await time.increase(100);

        penalty += BigInt(101) * validatorInfo.amount * BigInt(15) / BigInt(86400*365*100);
        slashAmount = ethers.parseEther('10') + delegator1Info.delegatorPerValidatorArr[0].amount * BigInt(5) / BigInt(100) + penalty;
        await expect(stakeManager.connect(distributor).slash([validator1])).to.changeEtherBalances([stakeManager, slashReceiver], [-slashAmount, slashAmount]);
        slashTime = await time.latest();

        assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, validatorReward.fixedReward + penalty);
        assert.equal((await stakeManager.validatorEarned(validator1)).variableReward, ethers.parseEther('2') / BigInt(10) + ethers.parseEther('1'));
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, delegator1Reward.fixedReward + BigInt(slashTime - distributeTime) * delegator1Info.delegatorPerValidatorArr[0].amount * BigInt(13) / BigInt(86400*365*100) + BigInt(1));
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).variableReward, ethers.parseEther('2') * BigInt(9) / BigInt(10) - BigInt(2));

        validatorReward = await stakeManager.validatorEarned(validator1);
        delegator1Reward = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);

        validatorInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validatorInfo.amount, ethers.parseEther('180') - penalty);
        assert.equal(validatorInfo.commission, '1000');
        assert.equal(validatorInfo.lastClaim, v1Start);
        assert.equal(validatorInfo.calledForWithdraw, 0);
        assert.equal(validatorInfo.vestingEnd, vestingEnd);
        assert.equal(validatorInfo.fixedReward.apr, '1500');
        assert.equal(validatorInfo.fixedReward.lastUpdate, slashTime);
        assert.equal(validatorInfo.fixedReward.fixedReward, validatorReward.fixedReward);
        assert.equal(validatorInfo.fixedReward.totalClaimed, 0);
        assert.equal(validatorInfo.variableReward.variableReward, ethers.parseEther('1') + ethers.parseEther('2') / BigInt(10));
        assert.equal(validatorInfo.variableReward.totalClaimed, 0);
        assert.equal(validatorInfo.penalty.potentialPenalty, 0);
        assert.equal(validatorInfo.penalty.lastSlash, slashTime);
        assert.equal(validatorInfo.delegatedAmount, delegator1Info.delegatorPerValidatorArr[0].amount * BigInt(95) / BigInt(100));
        assert.equal(validatorInfo.stoppedDelegatedAmount, 0);
        assert.equal(validatorInfo.delegatorsAcc, ethers.parseEther('2') * BigInt(9) / BigInt(10) * ethers.parseEther('1') / delegator1Info.delegatorPerValidatorArr[0].amount);
        assert.equal(validatorInfo.delegators.length, 1);
        assert.equal(validatorInfo.delegators[0], delegator1.address);

        delegator1Info = await stakeManager.getDelegatorInfo(delegator1);
        assert.equal(delegator1Info.validatorsArr.length, 1);
        assert.equal(delegator1Info.validatorsArr[0], validator1.address);
        assert.equal(delegator1Info.delegatorPerValidatorArr.length, 1);
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].amount, validatorInfo.delegatedAmount);
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].storedValidatorAcc, validatorInfo.delegatorsAcc);
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].calledForWithdraw, 0);
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].lastClaim, d1Start);
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].fixedReward.apr, '1300');
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].fixedReward.lastUpdate, slashTime);
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].fixedReward.fixedReward, delegator1Reward.fixedReward);
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].fixedReward.totalClaimed, 0);
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].variableReward.variableReward, ethers.parseEther('2') * BigInt(9) / BigInt(10) - BigInt(2));
        assert.equal(delegator1Info.delegatorPerValidatorArr[0].variableReward.totalClaimed, 0);
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).claimAvailable[0], BigInt(d1Start+86400*30));
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).withdrawAvailable[0], 0);

        await time.increase(100);

        await stakeManager.connect(delegator2_1).depositAsDelegator(validator1, {value: ethers.parseEther('10')});
        let d2Start = await time.latest();

        penalty = BigInt(d2Start - slashTime) * validatorInfo.amount * BigInt(15) / BigInt(100*365*86400);
        assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, validatorReward.fixedReward + penalty);
        assert.equal((await stakeManager.validatorEarned(validator1)).variableReward, validatorReward.variableReward);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, delegator1Reward.fixedReward + BigInt(d2Start - slashTime) * delegator1Info.delegatorPerValidatorArr[0].amount * BigInt(13) / BigInt(86400*365*100));
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).variableReward, delegator1Reward.variableReward);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator1)).fixedReward, 0);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator1)).variableReward, 0);

        delegator1Reward = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);

        let delegator2Info = await stakeManager.getDelegatorInfo(delegator2_1);
        assert.equal(delegator2Info.validatorsArr.length, 1);
        assert.equal(delegator2Info.validatorsArr[0], validator1.address);
        assert.equal(delegator2Info.delegatorPerValidatorArr.length, 1);
        assert.equal(delegator2Info.delegatorPerValidatorArr[0].amount, ethers.parseEther('10'));
        assert.equal(delegator2Info.delegatorPerValidatorArr[0].storedValidatorAcc, validatorInfo.delegatorsAcc);
        assert.equal(delegator2Info.delegatorPerValidatorArr[0].calledForWithdraw, 0);
        assert.equal(delegator2Info.delegatorPerValidatorArr[0].lastClaim, d2Start);
        assert.equal(delegator2Info.delegatorPerValidatorArr[0].fixedReward.apr, '1300');
        assert.equal(delegator2Info.delegatorPerValidatorArr[0].fixedReward.lastUpdate, d2Start);
        assert.equal(delegator2Info.delegatorPerValidatorArr[0].fixedReward.fixedReward, 0);
        assert.equal(delegator2Info.delegatorPerValidatorArr[0].fixedReward.totalClaimed, 0);
        assert.equal(delegator2Info.delegatorPerValidatorArr[0].variableReward.variableReward, 0);
        assert.equal(delegator2Info.delegatorPerValidatorArr[0].variableReward.totalClaimed, 0);

        // change apr for validator
        await stakeManager.setValidatorsAPR(1800);
        await stakeManager.setValidatorsClaimCooldown(5);

        penalty += BigInt(4 * 15) * validatorInfo.amount / BigInt(100*365*86400) + BigInt(1);
        await distributor.sendTransaction({value: validatorReward.fixedReward + penalty, to:stakeManager.target});

        await stakeManager.connect(validator1).restakeAsValidator();
        let v1Restake = await time.latest();
        assert.equal((await stakeManager.getValidatorInfo(validator1)).amount, validatorInfo.amount + validatorReward.fixedReward + penalty + validatorReward.variableReward);
        assert.equal((await stakeManager.getValidatorInfo(validator1)).lastClaim, v1Restake);
        assert.equal((await stakeManager.getValidatorInfo(validator1)).fixedReward.apr, '1800');
        assert.equal((await stakeManager.getValidatorInfo(validator1)).fixedReward.lastUpdate, v1Restake);
        assert.equal((await stakeManager.getValidatorInfo(validator1)).fixedReward.fixedReward, 0);
        assert.equal((await stakeManager.getValidatorInfo(validator1)).fixedReward.totalClaimed, validatorReward.fixedReward + penalty);
        assert.equal((await stakeManager.getValidatorInfo(validator1)).variableReward.variableReward, 0);
        assert.equal((await stakeManager.getValidatorInfo(validator1)).variableReward.totalClaimed, validatorReward.variableReward);
        assert.equal((await stakeManager.getValidatorInfo(validator1)).penalty.potentialPenalty, penalty);
        assert.equal((await stakeManager.getValidatorInfo(validator1)).penalty.lastSlash, slashTime);

        validatorReward = await stakeManager.validatorEarned(validator1);
        assert.equal(validatorReward.fixedReward, 0);
        assert.equal(validatorReward.variableReward, 0);

        validatorInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validatorInfo.claimAvailable, v1Restake + 5);
        assert.equal(validatorInfo.withdrawAvailable, 0);

        await time.increase(100);

        await stakeManager.setValidatorsAmountToSlash(ethers.parseEther('90')); // to send this validator in stop list
        slashTime = await time.latest() + 1;
        let addRew = BigInt(slashTime - v1Restake) * validatorInfo.amount * BigInt(18) / BigInt(100*86400*365);
        penalty += addRew;
        slashAmount = ethers.parseEther('90') + penalty + delegator2Info.delegatorPerValidatorArr[0].amount / BigInt(20) + delegator1Info.delegatorPerValidatorArr[0].amount / BigInt(20);
        await expect(stakeManager.connect(distributor).slash([validator1])).to.changeEtherBalances([slashReceiver, stakeManager], [slashAmount, -slashAmount]);

        assert.equal((await stakeManager.getValidatorInfo(validator1)).amount, validatorInfo.amount - penalty - ethers.parseEther('90'));
        assert.equal((await stakeManager.getValidatorInfo(validator1)).calledForWithdraw, slashTime);
        assert.equal((await stakeManager.getValidatorInfo(validator1)).delegatedAmount, 0);
        assert.equal((await stakeManager.getValidatorInfo(validator1)).stoppedDelegatedAmount, validatorInfo.delegatedAmount - (delegator2Info.delegatorPerValidatorArr[0].amount + delegator1Info.delegatorPerValidatorArr[0].amount) / BigInt(20));

        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).delegatorPerValidatorArr[0].amount, delegator1Info.delegatorPerValidatorArr[0].amount * BigInt(95) / BigInt(100));
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).delegatorPerValidatorArr[0].calledForWithdraw, 0);
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).claimAvailable[0], BigInt(d1Start + 86400*30));
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).withdrawAvailable[0], BigInt(slashTime + 86400*5));

        assert.equal((await stakeManager.getDelegatorInfo(delegator2_1)).delegatorPerValidatorArr[0].amount, delegator2Info.delegatorPerValidatorArr[0].amount * BigInt(95) / BigInt(100));
        assert.equal((await stakeManager.getDelegatorInfo(delegator2_1)).delegatorPerValidatorArr[0].calledForWithdraw, slashTime);
        assert.equal((await stakeManager.getDelegatorInfo(delegator2_1)).withdrawAvailable[0], BigInt(slashTime + 86400*5));

        validatorReward = await stakeManager.validatorEarned(validator1);
        assert.equal(validatorReward.fixedReward, addRew);
        assert.equal(validatorReward.variableReward, 0);

        validatorInfo = await stakeManager.getValidatorInfo(validator1);

        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, delegator1Reward.fixedReward + BigInt(slashTime - d2Start) * delegator1Info.delegatorPerValidatorArr[0].amount * BigInt(13) / BigInt(100*86400*365) + BigInt(1));
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).variableReward, delegator1Reward.variableReward);

        delegator1Reward = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);

        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator1)).fixedReward, BigInt(slashTime - d2Start) * delegator2Info.delegatorPerValidatorArr[0].amount * BigInt(13) / BigInt(100*86400*365));
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator1)).variableReward, 0);

        let delegator2Reward = await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator1);

        // check do not slash with penalty if validator is stop-listed and no fixed reward earned
        await time.increase(100);

        assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, validatorReward.fixedReward);
        assert.equal((await stakeManager.validatorEarned(validator1)).variableReward, validatorReward.variableReward);

        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, delegator1Reward.fixedReward);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).variableReward, delegator1Reward.variableReward);

        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator1)).fixedReward, delegator2Reward.fixedReward);
        assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator1)).variableReward, delegator2Reward.variableReward);

        await stakeManager.setValidatorsAmountToSlash(ethers.parseEther('10'));

        delegator2Info = await stakeManager.getDelegatorInfo(delegator2_1);
        delegator1Info = await stakeManager.getDelegatorInfo(delegator1);

        // delegator1 becomes stop-listed
        slashAmount = ethers.parseEther('10') + (delegator1Info.delegatorPerValidatorArr[0].amount+delegator2Info.delegatorPerValidatorArr[0].amount) / BigInt(20);
        await expect(stakeManager.connect(distributor).slash([validator1])).to.changeEtherBalances([stakeManager, slashReceiver], [-slashAmount, slashAmount]);

        assert.equal((await stakeManager.getValidatorInfo(validator1)).amount, validatorInfo.amount - ethers.parseEther('10'));
        assert.equal((await stakeManager.getValidatorInfo(validator1)).calledForWithdraw, slashTime);
        assert.equal((await stakeManager.getValidatorInfo(validator1)).stoppedDelegatedAmount, validatorInfo.stoppedDelegatedAmount - (delegator2Info.delegatorPerValidatorArr[0].amount + delegator1Info.delegatorPerValidatorArr[0].amount) / BigInt(20));

        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).delegatorPerValidatorArr[0].amount, delegator1Info.delegatorPerValidatorArr[0].amount * BigInt(95) / BigInt(100));
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).delegatorPerValidatorArr[0].calledForWithdraw, await time.latest());
        assert.equal((await stakeManager.getDelegatorInfo(delegator2_1)).withdrawAvailable[0], BigInt(slashTime + 86400*5));

        assert.equal((await stakeManager.getDelegatorInfo(delegator2_1)).delegatorPerValidatorArr[0].amount, delegator2Info.delegatorPerValidatorArr[0].amount * BigInt(95) / BigInt(100));
        assert.equal((await stakeManager.getDelegatorInfo(delegator2_1)).delegatorPerValidatorArr[0].calledForWithdraw, slashTime);

        await time.increase(100);

        await distributor.sendTransaction({value: validatorReward.fixedReward, to:stakeManager.target});

        await expect(stakeManager.connect(validator1).claimAsValidator()).to.changeEtherBalances([stakeManager, validator1], [-validatorReward.fixedReward, validatorReward.fixedReward]);
        validatorInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validatorInfo.penalty.potentialPenalty, 0);

        await stakeManager.connect(distributor).slash([validator1]);
        assert.equal((await stakeManager.getValidatorInfo(validator1)).amount, validatorInfo.amount - ethers.parseEther('10'));
      })

      // it("Delegators limit check", async ()=> {
      //   const {stakeManager, validator1, distributor, slashReceiver} = await loadFixture(deployFixture);

      //   await stakeManager.connect(validator1).depositAsValidator(500, {value: ethers.parseEther('100')});

      //   let delegator;
      //   console.log("deposit");
      //   for(let i = 0; i < 1000; i++) {
      //     console.log(i);
      //     await time.increase(5);
      //     delegator = await ethers.getImpersonatedSigner(ethers.Wallet.createRandom().address);
      //     await ethers.provider.send("hardhat_setBalance", [delegator.address, '0x1158e460913d00000']);
      //     await stakeManager.connect(delegator).depositAsDelegator(validator1, {value: ethers.parseEther('10')});
      //   }

      //   await stakeManager.connect(distributor).distributeRewards([validator1], [ethers.parseEther('23')], {value: ethers.parseEther('23')});

      //   await stakeManager.connect(validator1).validatorCallForWithdraw();

      //   await time.increase(time.duration.days(30));
      //   await slashReceiver.sendTransaction({value: ethers.parseEther('50'), to: stakeManager});
      //   let txn = await stakeManager.connect(validator1).withdrawAsValidator();
      //   console.log((await txn.wait()).gasUsed);

      //   // 10 delegators = 1623446
      //   // 20 delegators = 3072308
      //   // 50 delegators = 7419265
      //   // 100 delegators = 14665417
      //   // 200 delegators = 29162316
      //   // 1k delegators = 145358000
      // })

      it("Do not check delegators' claim cooldown in withdrawAsValidator transaction", async ()=> {
        const {stakeManager, validator1, delegator1, delegator2_1, validator2, distributor} = await loadFixture(deployFixture);

        await stakeManager.connect(validator1).depositAsValidator("1000", {value: ethers.parseEther('100')});
        let v1Start = await time.latest();

        await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('10')});
        let d1Start = await time.latest();

        await time.increase(time.duration.days(23));
        await stakeManager.connect(delegator2_1).depositAsDelegator(validator1, {value: ethers.parseEther('20')});
        let d2Start = await time.latest();

        await time.increase(time.duration.days(7));
        await stakeManager.connect(distributor).distributeRewards([validator1], [ethers.parseEther('50')], {value: ethers.parseEther('50')});

        await stakeManager.connect(validator1).validatorCallForWithdraw();
        let endTime = await time.latest();

        await stakeManager.connect(validator2).depositAsValidator("1500", {value: ethers.parseEther('100')});
        await stakeManager.connect(delegator1).depositAsDelegator(validator2, {value: ethers.parseEther('10')});
        await time.increase(100);

        let v1Reward = await stakeManager.validatorEarned(validator1);
        assert.equal(v1Reward.fixedReward, BigInt(endTime - v1Start) * BigInt(15) * ethers.parseEther('100') / BigInt(time.duration.years(1)) / BigInt(100));
        assert.equal(v1Reward.variableReward, ethers.parseEther('50') / BigInt(10));

        let d1Reward = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);
        assert.equal(d1Reward.fixedReward, BigInt(endTime - d1Start) * BigInt(13) * ethers.parseEther('10') / BigInt(time.duration.years(1)) / BigInt(100));
        assert.equal(d1Reward.variableReward, ethers.parseEther('50') * BigInt(9) / BigInt(10 * 3));

        let d2Reward = await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator1);
        assert.equal(d2Reward.fixedReward, BigInt(endTime - d2Start) * BigInt(13) * ethers.parseEther('20') / BigInt(time.duration.years(1)) / BigInt(100));
        assert.equal(d2Reward.variableReward, ethers.parseEther('50') * BigInt(9 * 2) / BigInt(10 * 3));

        let v1Info = await stakeManager.getValidatorInfo(validator1);
        await time.increaseTo(v1Info.withdrawAvailable);

        await distributor.sendTransaction({to: stakeManager.target, value: d1Reward.fixedReward});
        await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator1)).to.changeEtherBalances([stakeManager, delegator1], [-d1Reward.fixedReward - d1Reward.variableReward, d1Reward.variableReward + d1Reward.fixedReward]);

        await stakeManager.connect(distributor).distributeRewards([validator1, validator2], [ethers.parseEther('1'), ethers.parseEther('1')], {value: ethers.parseEther('2')});
        
        d1Reward = await stakeManager.delegatorEarnedPerValidators(delegator1, [validator1, validator2]);
        assert.equal(d1Reward.fixedRewards[0], 0);
        assert.equal(d1Reward.variableRewards[0], ethers.parseEther('1') * BigInt(9) / BigInt(10 * 3));
        await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator1)).to.be.revertedWithCustomError(stakeManager, "Cooldown");
        assert.isAbove(await time.latest(), (await stakeManager.getDelegatorInfo(delegator1)).withdrawAvailable[0]);
        assert.isBelow(await time.latest(), (await stakeManager.getDelegatorInfo(delegator1)).claimAvailable[0]);
        await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator1)).to.be.revertedWithCustomError(stakeManager, "Cooldown");
        await expect(stakeManager.connect(delegator1).withdrawAsDelegator(validator1)).to.be.revertedWithCustomError(stakeManager, "Cooldown");

        v1Reward = await stakeManager.validatorEarned(validator1);
        d2Reward = await stakeManager.delegatorEarnedPerValidator(delegator2_1, validator1);

        assert.isAbove(await time.latest(), (await stakeManager.getValidatorInfo(validator1)).withdrawAvailable);
        assert.isAbove(await time.latest(), (await stakeManager.getValidatorInfo(validator1)).claimAvailable);

        await distributor.sendTransaction({to: stakeManager.target, value: v1Reward.fixedReward + d2Reward.fixedReward});
        await expect(stakeManager.connect(validator1).withdrawAsValidator()).to.changeEtherBalances([stakeManager, validator1, delegator1, delegator2_1], [-(v1Reward.fixedReward + v1Reward.variableReward + d1Reward.variableRewards[0] + d2Reward.fixedReward + d2Reward.variableReward + ethers.parseEther('130')), v1Reward.fixedReward + v1Reward.variableReward + ethers.parseEther('100'), d1Reward.variableRewards[0] + ethers.parseEther('10'), d2Reward.fixedReward + d2Reward.variableReward + ethers.parseEther('20')]);
        assert.equal((await stakeManager.getStoppedValidators()).validators.length, 0);
        assert.equal(await stakeManager.isValidator(validator1), false);
        assert.equal(await stakeManager.isDelegator(delegator1), true);
        assert.equal(await stakeManager.isDelegator(delegator2_1), false);
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).validatorsArr.length, 1);
        assert.equal((await stakeManager.getDelegatorInfo(delegator1)).validatorsArr[0], validator2.address);
      })
  });

  describe("After audit fixes", function() {
    it("Not enough fixed rewards pool balance, claim after validator's withdraw", async ()=> {
      const {stakeManager, validator1, delegator1, distributor} = await loadFixture(deployFixture);

      await stakeManager.connect(validator1).depositAsValidator(2000, {value: ethers.parseEther('100')});
      let start1 = await time.latest();

      await time.increase(86400);
      
      await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('20')});
      let start2 = await time.latest();

      await time.increase(86400);

      let rewardV = await stakeManager.validatorEarned(validator1);
      let rewardD = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);
      let currentTime = await time.latest();

      assert.equal(rewardV.fixedReward, BigInt(currentTime - start1) * ethers.parseEther('100') * BigInt(15) / BigInt(365 * 86400 * 100));
      assert.equal(rewardV.variableReward, 0);
      assert.equal(rewardD.fixedReward, BigInt(currentTime - start2) * ethers.parseEther('20') * BigInt(13) / BigInt(365 * 86400 * 100));
      assert.equal(rewardD.variableReward, 0);
      assert.equal(await stakeManager.forFixedReward(), 0);

      let validatorInfo = await stakeManager.getValidatorInfo(validator1);

      await expect(stakeManager.connect(validator1).claimAsValidator()).to.changeEtherBalances([stakeManager, validator1], [0,0]);
      assert.equal((await stakeManager.getValidatorInfo(validator1)).lastClaim, validatorInfo.lastClaim);

      let delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);

      await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator1)).to.changeEtherBalances([stakeManager, delegator1], [0,0]);
      assert.equal((await stakeManager.getDelegatorInfo(delegator1)).delegatorPerValidatorArr[0].lastClaim, delegatorInfo.delegatorPerValidatorArr[0].lastClaim);

      await expect(stakeManager.connect(validator1).restakeAsValidator()).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(0);
      await expect(stakeManager.connect(delegator1).restakeAsDelegator(validator1)).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(0);

      // distribute variable rewards
      await stakeManager.connect(distributor).distributeRewards([validator1], [ethers.parseEther('2')], {value: ethers.parseEther('2')});

      rewardV = await stakeManager.validatorEarned(validator1);
      rewardD = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);

      assert.equal(rewardV.variableReward, ethers.parseEther('2') / BigInt(5));
      assert.equal(rewardD.variableReward, ethers.parseEther('2') * BigInt(4) / BigInt(5));

      await time.increaseTo(validatorInfo.lastClaim + BigInt(time.duration.weeks(2)));

      await expect(stakeManager.connect(validator1).claimAsValidator()).to.changeEtherBalances([stakeManager, validator1], [-rewardV.variableReward, rewardV.variableReward]);
      currentTime = await time.latest();

      validatorInfo = await stakeManager.getValidatorInfo(validator1);

      assert.equal(validatorInfo.lastClaim, currentTime);
      assert.equal(validatorInfo.fixedReward.fixedReward, BigInt(currentTime - start1) * ethers.parseEther('100') * BigInt(15) / BigInt(86400*365*100) - BigInt(1));
      
      rewardV = await stakeManager.validatorEarned(validator1);
      assert.equal(rewardV.fixedReward, validatorInfo.fixedReward.fixedReward);
      assert.equal(rewardV.variableReward, 0);

      await time.increaseTo(delegatorInfo.delegatorPerValidatorArr[0].lastClaim + BigInt(time.duration.days(30)));

      await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator1)).to.changeEtherBalances([stakeManager, delegator1], [-rewardD.variableReward, rewardD.variableReward]);
      currentTime = await time.latest();

      delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);

      assert.equal(delegatorInfo.delegatorPerValidatorArr[0].lastClaim, currentTime);
      assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, BigInt(currentTime - start2) * ethers.parseEther('20') * BigInt(13) / BigInt(86400*365*100) - BigInt(1));

      rewardD = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);

      let tvr = await stakeManager.totalValidatorsRewards();
      assert.equal(tvr.fixedReward, BigInt(currentTime - start1) * ethers.parseEther('100') * BigInt(15) / BigInt(86400 * 100 * 365) - BigInt(1));
      assert.equal(tvr.variableReward, ethers.parseEther('2') / BigInt(5));

      tvr = await stakeManager.totalValidatorReward(validator1);
      assert.equal(tvr.fixedReward, BigInt(currentTime - start1) * ethers.parseEther('100') * BigInt(15) / BigInt(86400 * 100 * 365) - BigInt(1));
      assert.equal(tvr.variableReward, ethers.parseEther('2') / BigInt(5));

      let tdr = await stakeManager.totalDelegatorsRewards();
      assert.equal(tdr.fixedReward, BigInt(currentTime - start2) * ethers.parseEther('20') * BigInt(13) / BigInt(86400 * 100 * 365) - BigInt(3));
      assert.equal(tdr.variableReward, ethers.parseEther('2') * BigInt(4) / BigInt(5));

      tdr = await stakeManager.totalDelegatorRewardPerValidator(delegator1, validator1);
      assert.equal(tdr.fixedReward, BigInt(currentTime - start2) * ethers.parseEther('20') * BigInt(13) / BigInt(86400 * 100 * 365) - BigInt(1));
      assert.equal(tdr.variableReward, ethers.parseEther('2') * BigInt(4) / BigInt(5));

      // claim fixed rewards when it's possible
      await distributor.sendTransaction({value: ethers.parseEther('100'), to: stakeManager}); // increase fixed reward pool
      assert.equal(await stakeManager.forFixedReward(), ethers.parseEther('100'));

      // await expect(stakeManager.connect(validator1).claimAsValidator()).to.be.revertedWithCustomError(stakeManager, "Cooldown").withArgs(true, validatorInfo.lastClaim + BigInt(time.duration.weeks(2))); // cooldown passed
      await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator1)).to.be.revertedWithCustomError(stakeManager, "Cooldown").withArgs(true, delegatorInfo.delegatorPerValidatorArr[0].lastClaim + BigInt(time.duration.days(30)));

      currentTime = await time.latest() + 1;
      rewardV = BigInt(currentTime - start1) * ethers.parseEther('100') * BigInt(15) / BigInt(86400 * 365 * 100) - BigInt(1);
      await expect(stakeManager.connect(validator1).claimAsValidator()).to.changeEtherBalances([stakeManager, validator1], [-rewardV, rewardV]);

      rewardV = await stakeManager.validatorEarned(validator1);
      assert.equal(rewardV.fixedReward, 0);
      assert.equal(rewardV.variableReward, 0);

      validatorInfo = await stakeManager.getValidatorInfo(validator1);
      assert.equal(validatorInfo.lastClaim, currentTime);
      assert.equal(validatorInfo.fixedReward.fixedReward, 0);

      await time.increaseTo(delegatorInfo.delegatorPerValidatorArr[0].lastClaim + BigInt(time.duration.days(30)));

      currentTime = await time.latest() + 1;
      rewardD = BigInt(currentTime - start2) * ethers.parseEther('20') * BigInt(13) / BigInt(86400 * 365 * 100) - BigInt(1);
      await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator1)).to.changeEtherBalances([stakeManager, delegator1], [-rewardD, rewardD]);

      rewardD = await stakeManager.delegatorEarnedPerValidator(delegator1 ,validator1);
      assert.equal(rewardD.fixedReward, 0);
      assert.equal(rewardD.variableReward, 0);

      delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);
      assert.equal(delegatorInfo.delegatorPerValidatorArr[0].lastClaim, currentTime);
      assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, 0);

      await stakeManager.withdrawExcessFixedReward(await ethers.provider.getBalance(stakeManager) - ethers.parseEther('120'));
      assert.equal(await stakeManager.forFixedReward(), 0);

      // withdraw deposit while fixed reward pool is not enough
      await time.increase(86400);

      await stakeManager.connect(validator1).validatorCallForWithdraw();
      validatorInfo = await stakeManager.getValidatorInfo(validator1);
      assert.equal(validatorInfo.calledForWithdraw, await time.latest());

      rewardV = await stakeManager.validatorEarned(validator1);
      rewardD = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);
      assert.isAbove(rewardV.fixedReward, 0);
      assert.isAbove(rewardD.fixedReward, 0);

      await time.increase(time.duration.weeks(2));

      await expect(stakeManager.connect(validator1).withdrawAsValidator()).to.changeEtherBalances([stakeManager, validator1, delegator1], [-ethers.parseEther('120'), ethers.parseEther('100'), ethers.parseEther('20')]);

      assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, rewardV.fixedReward);
      assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, rewardD.fixedReward);

      validatorInfo = await stakeManager.getValidatorInfo(validator1);
      assert.equal(validatorInfo.amount, 0);
      assert.equal(validatorInfo.lastClaim, 0);
      assert.equal(validatorInfo.commission, 0);
      assert.equal(validatorInfo.calledForWithdraw, 0);
      assert.equal(validatorInfo.delegators.length, 0);
      // etc. == 0
      assert.equal(validatorInfo.fixedReward.fixedReward, rewardV.fixedReward);

      delegatorInfo = await stakeManager.getDelegatorInfo(delegator1);
      assert.equal(delegatorInfo.delegatorPerValidatorArr.length, 0);
      // assert.equal(delegatorInfo.delegatorPerValidatorArr[0].amount, 0); // OUT OF RANGE
      // assert.equal(delegatorInfo.delegatorPerValidatorArr[0].lastClaim, 0);
      // assert.equal(delegatorInfo.delegatorPerValidatorArr[0].calledForWithdraw, 0);
      // // etc. == 0
      // assert.equal(delegatorInfo.delegatorPerValidatorArr[0].fixedReward.fixedReward, rewardD.fixedReward);

      assert.equal((await stakeManager.getActiveValidators()).validators.length, 0);
      assert.equal((await stakeManager.getStoppedValidators()).validators.length, 0);

      // claim after withdraw
      await distributor.sendTransaction({value: ethers.parseEther('100'), to:stakeManager});

      await expect(stakeManager.connect(validator1).restakeAsValidator()).to.be.revertedWithCustomError(stakeManager, "ValidatorsOnly").withArgs(validator1);
      await expect(stakeManager.connect(delegator1).restakeAsDelegator(validator1)).to.be.revertedWithCustomError(stakeManager, "DelegatorsOnly").withArgs(delegator1);

      await expect(stakeManager.connect(validator1).claimAsValidator()).to.changeEtherBalances([stakeManager, validator1], [-rewardV.fixedReward, rewardV.fixedReward]);
      assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, 0);
      assert.equal((await stakeManager.getValidatorInfo(validator1)).fixedReward.fixedReward, 0);

      await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator1)).to.changeEtherBalances([stakeManager, delegator1], [-rewardD.fixedReward, rewardD.fixedReward]);
      assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, 0);

      await expect(stakeManager.connect(validator1).claimAsValidator()).to.be.revertedWithCustomError(stakeManager, "ValidatorsOnly").withArgs(validator1);
      await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator1)).to.be.revertedWithCustomError(stakeManager, "ValidatorsOnly").withArgs(validator1);
    })

    it("Not enough fixed rewards pool balance, claim after delegators's withdraw", async ()=> {
      const {stakeManager, validator1, delegator1, distributor} = await loadFixture(deployFixture);

      await stakeManager.connect(validator1).depositAsValidator(2000, {value: ethers.parseEther('100')});
      let start1 = await time.latest();

      await time.increase(86400);
      
      await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('20')});
      let start2 = await time.latest();

      await time.increase(86400);

      await stakeManager.connect(delegator1).delegatorCallForWithdraw(validator1);

      let rewardD = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);
      assert.isAbove(rewardD.fixedReward, 0);

      await time.increaseTo(start2 + time.duration.days(30));

      await expect(stakeManager.connect(delegator1).withdrawAsDelegator(validator1)).to.changeEtherBalances([stakeManager, delegator1], [-ethers.parseEther('20'), ethers.parseEther('20')]);
      assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, rewardD.fixedReward);
      assert.equal((await stakeManager.getValidatorInfo(validator1)).delegators.length, 0);
      assert.equal(await stakeManager.isDelegator(delegator1), false);

      await distributor.sendTransaction({value: rewardD.fixedReward, to:stakeManager});

      await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator1)).to.changeEtherBalances([stakeManager, delegator1], [-rewardD.fixedReward, rewardD.fixedReward]);
      assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, 0);

      await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator1)).to.be.revertedWithCustomError(stakeManager, "ValidatorsOnly").withArgs(validator1);
    })

    it("Not enough fixed rewards pool balance, deposit again after withdraw", async ()=> {
      const {stakeManager, validator1, delegator1, distributor} = await loadFixture(deployFixture);

      await stakeManager.connect(validator1).depositAsValidator(2000, {value: ethers.parseEther('100')});
      let start1 = await time.latest();

      await time.increase(86400);
      
      await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('20')});
      let start2 = await time.latest();

      await time.increase(86400);

      await stakeManager.connect(validator1).validatorCallForWithdraw();

      let rewardV = await stakeManager.validatorEarned(validator1);
      let rewardD = await stakeManager.delegatorEarnedPerValidator(delegator1, validator1);
      assert.isAbove(rewardV.fixedReward, 0);
      assert.isAbove(rewardD.fixedReward, 0);

      await time.increase(time.duration.weeks(2));

      await expect(stakeManager.connect(validator1).withdrawAsValidator()).to.changeEtherBalances([stakeManager, delegator1, validator1], [-ethers.parseEther('120'), ethers.parseEther('20'), ethers.parseEther('100')]);
      assert.equal((await stakeManager.getActiveValidators()).validators.length, 0);
      assert.equal(await stakeManager.isValidator(validator1), false);
      assert.equal(await stakeManager.isDelegator(delegator1), false);

      assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, rewardV.fixedReward);
      assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, rewardD.fixedReward);

      await expect(stakeManager.connect(validator1).depositAsValidator(2100, {value: ethers.parseEther('101')})).to.changeEtherBalances([stakeManager, validator1], [ethers.parseEther('101'), -ethers.parseEther('101')]);
      start1 = await time.latest();
      assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, rewardV.fixedReward);
      assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, rewardD.fixedReward);
      assert.equal((await stakeManager.getValidatorInfo(validator1)).delegators.length, 0);
      assert.equal(await stakeManager.isValidator(validator1), true);
      assert.equal(await stakeManager.isDelegator(delegator1), false);

      await time.increase(86400);

      assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, rewardV.fixedReward + BigInt(await time.latest() - start1) * ethers.parseEther('101') * BigInt(15) / BigInt(365*86400*100));
      assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, rewardD.fixedReward);

      await distributor.sendTransaction({value: ethers.parseEther("100"), to: stakeManager});

      await time.increaseTo(start1 + time.duration.days(14));

      let currentTime = await time.latest() + 1;
      rewardV = BigInt(currentTime - start1) * ethers.parseEther('101') * BigInt(15) / BigInt(365*86400*100) + rewardV.fixedReward;
      await expect(stakeManager.connect(validator1).claimAsValidator()).to.changeEtherBalances([stakeManager, validator1], [-rewardV, rewardV]);
      assert.equal((await stakeManager.validatorEarned(validator1)).fixedReward, 0);

      // delegator's deposit
      await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('21')});
      start2 = await time.latest();
      assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, rewardD.fixedReward);
      assert.equal(await stakeManager.isDelegator(delegator1), true);
      assert.equal((await stakeManager.getDelegatorInfo(delegator1)).delegatorPerValidatorArr[0].fixedReward.fixedReward, rewardD.fixedReward);

      await time.increaseTo(start2 + time.duration.days(30));

      currentTime = await time.latest() + 1;
      rewardD = BigInt(currentTime - start2) * ethers.parseEther('21') * BigInt(13) / BigInt(365*86400*100) + rewardD.fixedReward;
      await expect(stakeManager.connect(delegator1).claimAsDelegatorPerValidator(validator1)).to.changeEtherBalances([stakeManager, delegator1], [-rewardD, rewardD]);
      assert.equal((await stakeManager.delegatorEarnedPerValidator(delegator1, validator1)).fixedReward, 0);
    })

    it("Cooldown limit check", async ()=> {
      const {stakeManager} = await loadFixture(deployFixture);

      await expect(stakeManager.setValidatorsWithdrawCooldown(time.duration.years(1) + 1)).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(time.duration.years(1) + 1);
      await expect(stakeManager.setDelegatorsWithdrawCooldown(time.duration.years(1) + 1)).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(time.duration.years(1) + 1);
      await expect(stakeManager.setValidatorsClaimCooldown(time.duration.years(1) + 1)).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(time.duration.years(1) + 1);
      await expect(stakeManager.setDelegatorsClaimCooldown(time.duration.years(1) + 1)).to.be.revertedWithCustomError(stakeManager, "WrongValue").withArgs(time.duration.years(1) + 1);
    })

    it("Check current validator of the delegator while delegatorCallForWithdraw() call", async ()=> {
      const {stakeManager, validator1, validator2, delegator1} = await loadFixture(deployFixture);

      await stakeManager.connect(validator1).depositAsValidator(2000, {value: ethers.parseEther('100')});
      await stakeManager.connect(delegator1).depositAsDelegator(validator1, {value: ethers.parseEther('10')});

      await expect(stakeManager.connect(delegator1).delegatorCallForWithdraw(validator2)).to.be.revertedWithCustomError(stakeManager, "ValidatorsOnly").withArgs(validator2);
    })

    it("Check isDelegator while reviveAsDelegator() call", async ()=> {
      const {stakeManager, delegator1} = await loadFixture(deployFixture);

      await expect(stakeManager.connect(delegator1).reviveAsDelegator(delegator1)).to.be.revertedWithCustomError(stakeManager, "DelegatorsOnly").withArgs(delegator1);
    })

    // UNCOMMENT accounts IN hardhat.config.networks.hardhat TO MAKE IT SUCCESSFUL !!!
    it("Check delegators per 1 validator limit", async ()=> {
      const {stakeManager, validator1/* , owner */} = await loadFixture(deployFixture);

      await stakeManager.connect(validator1).depositAsValidator(2000, {value: ethers.parseEther('100')});

      let signers = await ethers.getSigners();

      for(let i = 9; i < 4809; i++) {
        await stakeManager.connect(signers[i]).depositAsDelegator(validator1, {value: ethers.parseEther('10')});
      }

      await expect(stakeManager.connect(signers[4809]).depositAsDelegator(validator1, {value: ethers.parseEther('10')})).to.be.revertedWithCustomError(stakeManager, "DelegatorsLimit");
    })

    it("Close zero addres brunch in deployment", async ()=> {
      const {stakeManager} = await loadFixture(deployFixture);

      const CRATStakeManager = await ethers.getContractFactory("CRATStakeManager");
      await expect(upgrades.deployProxy(CRATStakeManager, [ZERO_ADDRESS, ZERO_ADDRESS])).to.be.revertedWithCustomError(stakeManager, "ZeroAddress");
    })
  });

  describe("After DualDefense stage", function() {
    describe("Validator Withdrawal Denial via Malicious Delegator, fix upd in 19.12.24", function() {
      it("Malicious Delegator tries to claim and withdraw by itself", async ()=> {
        const {stakeManager, validator1, delegator1, distributor} = await loadFixture(deployFixture);

        await stakeManager.connect(validator1).depositAsValidator("1000", {value: ethers.parseEther('100')});

        const maliciousDelegator = await ethers.deployContract("MaliciousDelegator", [stakeManager]);
        await maliciousDelegator.connect(delegator1).deposit(validator1, {value: ethers.parseEther('10')});
        let d1Start = await time.latest();
        let validator1Info = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validator1Info.amount, ethers.parseEther('100'));
        assert.equal(validator1Info.delegatedAmount, ethers.parseEther('10'));
        assert.equal(validator1Info.stoppedDelegatedAmount, 0);
        assert.equal(validator1Info.delegators.length, 1);
        assert.equal(validator1Info.delegators[0], maliciousDelegator.target);
        assert.equal(await stakeManager.isDelegator(maliciousDelegator), true);
        assert.equal(await stakeManager.unusualDepositor(maliciousDelegator), 0);

        await time.increase(time.duration.days(30));
        await distributor.sendTransaction({
          to: stakeManager,
          value: ethers.parseEther('100')
        });
        await expect(maliciousDelegator.connect(delegator1).claim(validator1)).to.be.revertedWithCustomError(stakeManager, "NativeTransferFailed");

        await maliciousDelegator.connect(delegator1).callForWithdraw(validator1);
        let currentTime = await time.latest();
        let delegatorInfo = await stakeManager.getDelegatorInfo(maliciousDelegator);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].calledForWithdraw, currentTime);
        assert.equal(delegatorInfo.delegatorPerValidatorArr[0].lastClaim, d1Start);

        await time.increase(time.duration.days(5));

        await expect(maliciousDelegator.connect(delegator1).withdraw(validator1)).to.changeEtherBalances([stakeManager, maliciousDelegator], [0,0]);
        let finalAmount = BigInt(currentTime - d1Start) * BigInt(13) * ethers.parseEther('10') / BigInt(100 * 86400 * 365) + ethers.parseEther('10');
        assert.equal(await stakeManager.unusualDepositor(maliciousDelegator), finalAmount);
        validator1Info = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validator1Info.delegatedAmount, 0);
        assert.equal(validator1Info.delegators.length, 0);
        assert.equal(await stakeManager.isDelegator(maliciousDelegator), false);

        await expect(maliciousDelegator.connect(delegator1).claimAsUnusual(delegator1)).to.changeEtherBalances([stakeManager, delegator1], [-finalAmount, finalAmount]);
        await expect(maliciousDelegator.connect(delegator1).claimAsUnusual(delegator1)).to.changeEtherBalances([stakeManager, delegator1], [0, 0]);
      })

      it("Validator with Malicious Delegator tries to withdraw", async ()=> {
        const {stakeManager, validator1, delegator1, distributor} = await loadFixture(deployFixture);

        await stakeManager.connect(validator1).depositAsValidator("1000", {value: ethers.parseEther('100')});
        let v1Start = await time.latest();

        const maliciousDelegator = await ethers.deployContract("MaliciousDelegator", [stakeManager]);
        await maliciousDelegator.connect(delegator1).deposit(validator1, {value: ethers.parseEther('10')});
        let d1Start = await time.latest();
        let validator1Info = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validator1Info.amount, ethers.parseEther('100'));
        assert.equal(validator1Info.delegatedAmount, ethers.parseEther('10'));
        assert.equal(validator1Info.stoppedDelegatedAmount, 0);
        assert.equal(validator1Info.delegators.length, 1);
        assert.equal(validator1Info.delegators[0], maliciousDelegator.target);
        assert.equal(await stakeManager.isDelegator(maliciousDelegator), true);
        assert.equal(await stakeManager.unusualDepositor(maliciousDelegator), 0);

        await distributor.sendTransaction({
          to: stakeManager,
          value: ethers.parseEther('100')
        });

        await time.increase(time.duration.weeks(2));

        await stakeManager.connect(validator1).validatorCallForWithdraw();
        let currentTime = await time.latest();

        await time.increase(time.duration.weeks(1));

        let validatorAmount = ethers.parseEther('100') + ethers.parseEther('100') * BigInt(15) * BigInt(currentTime - v1Start) / BigInt(86400 * 365 * 100);
        let delegatorAmount = ethers.parseEther('10') + ethers.parseEther('10') * BigInt(13) * BigInt(currentTime - d1Start) / BigInt(86400 * 365 * 100);
        await expect(stakeManager.connect(validator1).withdrawAsValidator()).to.changeEtherBalances([stakeManager, validator1, maliciousDelegator], [-validatorAmount, validatorAmount, 0]);
        assert.equal(await stakeManager.unusualDepositor(maliciousDelegator), delegatorAmount);

        await expect(maliciousDelegator.connect(delegator1).claimAsUnusual(delegator1)).to.changeEtherBalances([stakeManager, delegator1], [-delegatorAmount, delegatorAmount]);
      })

      it("Malicious Validator tries to withdraw by itself", async ()=> {
        const {stakeManager, validator1, delegator1, distributor} = await loadFixture(deployFixture);

        const maliciousValidator = await ethers.deployContract("MaliciousValidator", [stakeManager]);

        await maliciousValidator.connect(validator1).deposit({value: ethers.parseEther('100')});
        let v1Start = await time.latest();

        await stakeManager.connect(delegator1).depositAsDelegator(maliciousValidator, {value: ethers.parseEther('10')});
        let d1Start = await time.latest();

        let validator1Info = await stakeManager.getValidatorInfo(maliciousValidator);
        assert.equal(validator1Info.amount, ethers.parseEther('100'));
        assert.equal(validator1Info.delegatedAmount, ethers.parseEther('10'));
        assert.equal(validator1Info.stoppedDelegatedAmount, 0);
        assert.equal(validator1Info.delegators.length, 1);
        assert.equal(validator1Info.delegators[0], delegator1.address);
        assert.equal(await stakeManager.isValidator(maliciousValidator), true);
        assert.equal(await stakeManager.unusualDepositor(maliciousValidator), 0);

        await distributor.sendTransaction({
          to: stakeManager,
          value: ethers.parseEther('100')
        });

        await time.increase(time.duration.weeks(2));

        await expect(maliciousValidator.connect(validator1).claim()).to.be.revertedWithCustomError(stakeManager, "NativeTransferFailed");
        assert.equal(await stakeManager.unusualDepositor(maliciousValidator), 0);

        await maliciousValidator.connect(validator1).callForWithdraw();
        let currentTime = await time.latest();

        await time.increase(time.duration.weeks(1));

        let validatorAmount = ethers.parseEther('100') + ethers.parseEther('100') * BigInt(15) * BigInt(currentTime - v1Start) / BigInt(86400 * 365 * 100);
        let delegatorAmount = ethers.parseEther('10') + ethers.parseEther('10') * BigInt(13) * BigInt(currentTime - d1Start) / BigInt(86400 * 365 * 100);
        await expect(maliciousValidator.connect(validator1).withdraw()).to.changeEtherBalances([stakeManager, maliciousValidator, delegator1], [-delegatorAmount, 0, delegatorAmount]);
        assert.equal(await stakeManager.unusualDepositor(maliciousValidator), validatorAmount);

        await expect(maliciousValidator.connect(validator1).claimAsUnusual(validator1)).to.changeEtherBalances([stakeManager, validator1], [-validatorAmount, validatorAmount]);
      })
    })

    describe("Fix unfair slashing mechanics", function() {
      it("Slash validator twice (interval more than probation period)", async ()=> {
        const {stakeManager, validator1, distributor, slashReceiver} = await loadFixture(deployFixture);

        const fixedSlashAmount = ethers.parseEther('10');
        await stakeManager.setValidatorsAmountToSlash(fixedSlashAmount);

        await stakeManager.connect(validator1).depositAsValidator("1000", {value: ethers.parseEther('200')});

        await expect(stakeManager.connect(distributor).slash([validator1])).to.changeEtherBalances([stakeManager, slashReceiver], [-fixedSlashAmount, fixedSlashAmount]);
        let currentTime = await time.latest();
        let validatorInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validatorInfo.penalty.lastSlash, currentTime);
        assert.equal(validatorInfo.amount, ethers.parseEther('190'));

        await time.increase(time.duration.days(90));

        await expect(stakeManager.connect(distributor).slash([validator1])).to.changeEtherBalances([stakeManager, slashReceiver], [-fixedSlashAmount, fixedSlashAmount]);
        currentTime = await time.latest();
        validatorInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validatorInfo.penalty.lastSlash, currentTime);
        assert.equal(validatorInfo.amount, ethers.parseEther('180'));

        await time.increase(time.duration.days(1));

        await stakeManager.connect(validator1).depositAsValidator(0, {value: ethers.parseEther('20')});
        let currentTime2 = await time.latest();
        validatorInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validatorInfo.penalty.lastSlash, currentTime);
        assert.equal(validatorInfo.amount, ethers.parseEther('200'));

        await time.increase(time.duration.days(1));

        let currentTime3 = await time.latest() + 1;
        let apr = BigInt(currentTime3 - currentTime2) * BigInt(15) * ethers.parseEther('200') / BigInt(365 * 86400 * 100) + BigInt(currentTime2 - currentTime) * BigInt(15) * ethers.parseEther('180') / BigInt(365 * 86400 * 100);
        await expect(stakeManager.connect(distributor).slash([validator1])).to.changeEtherBalances([stakeManager, slashReceiver], [-(fixedSlashAmount + apr), fixedSlashAmount + apr]);
        validatorInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validatorInfo.penalty.lastSlash, currentTime3);
        assert.equal(validatorInfo.penalty.potentialPenalty, 0);
        assert.equal(validatorInfo.amount, ethers.parseEther('190') - apr);

        // change probation period duration
        await stakeManager.setValidatorsProbationPeriod(time.duration.days(30));

        await time.increase(time.duration.days(30));

        await expect(stakeManager.connect(distributor).slash([validator1])).to.changeEtherBalances([stakeManager, slashReceiver], [-fixedSlashAmount, fixedSlashAmount]);
        currentTime = await time.latest();
        validatorInfo = await stakeManager.getValidatorInfo(validator1);
        assert.equal(validatorInfo.penalty.lastSlash, currentTime);
        assert.equal(validatorInfo.penalty.potentialPenalty, 0);
        assert.equal(validatorInfo.amount, ethers.parseEther('180') - apr);
      })
    })
  });
});
