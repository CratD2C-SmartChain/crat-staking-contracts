// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IStakeManager {
    function depositAsValidator(uint256 commission) external payable;
    function claimAsValidator() external;
    function validatorCallForWithdraw() external;
    function withdrawAsValidator() external;
    function claimAsUnusualDepositor(address to) external;
}

contract MaliciousValidator {
    IStakeManager public staking;

    constructor(address _staking) {
        staking = IStakeManager(_staking);
    }

    function deposit() public payable {
        staking.depositAsValidator{value: msg.value}(2000);
    }

    function claim() public {
        staking.claimAsValidator();
    }

    function callForWithdraw() public {
        staking.validatorCallForWithdraw();
    }

    function withdraw() public {
        staking.withdrawAsValidator();
    }

    function claimAsUnusual(address to) public {
        staking.claimAsUnusualDepositor(to);
    }
}
