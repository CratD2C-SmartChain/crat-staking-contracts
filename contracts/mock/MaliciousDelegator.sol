// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IStakeManager {
    function depositAsDelegator(address validator) external payable;
    function claimAsDelegatorPerValidator(address validator) external;
    function delegatorCallForWithdraw(address validator) external;
    function withdrawAsDelegator(address validator) external;
    function claimAsUnusualDepositor(address to) external;
}

contract MaliciousDelegator {
    IStakeManager public staking;

    constructor(address _staking) {
        staking = IStakeManager(_staking);
    }

    function deposit(address validator) public payable {
        staking.depositAsDelegator{value: msg.value}(validator);
    }

    function claim(address validator) public {
        staking.claimAsDelegatorPerValidator(validator);
    }

    function callForWithdraw(address validator) public {
        staking.delegatorCallForWithdraw(validator);
    }

    function withdraw(address validator) public {
        staking.withdrawAsDelegator(validator);
    }

    function claimAsUnusual(address to) public {
        staking.claimAsUnusualDepositor(to);
    }
}
