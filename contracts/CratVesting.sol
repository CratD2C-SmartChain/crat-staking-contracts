// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// import "@quant-finance/solidity-datetime/contracts/DateTime.sol";

contract CratVesting {
    uint256 public constant PRECISION = 100_00;
    uint256 public constant TOTAL_SUPPLY = 300_000_000 * 10 ** 18;
    // uint256[8] public periods = [10_00, 4_00, 8_60, 15_80, 12_60, 19_50, 11_80, 17_70];
    address[10] public allocators; // [early adoptors, royalties, ico, CTVG, ieo, team, staking rewards, liquidity, airdrop, manual distribution]

    mapping(address => AddressInfo) private _addressToInfo;

    struct AddressInfo {
        bool hasShedule;
        uint256[10] shedule;
    }

    constructor(address[10] memory _allocators) {
        allocators = _allocators;

        _addressToInfo[_allocators[0]].hasShedule = true;
        _addressToInfo[_allocators[1]].hasShedule = true;
        _addressToInfo[_allocators[2]].hasShedule = true;
        _addressToInfo[_allocators[3]].hasShedule = true;
        _addressToInfo[_allocators[4]].hasShedule = true;
        _addressToInfo[_allocators[5]].hasShedule = true;
        _addressToInfo[_allocators[6]].hasShedule = true;
        _addressToInfo[_allocators[7]].hasShedule = true;
        _addressToInfo[_allocators[8]].hasShedule = true;
        _addressToInfo[_allocators[9]].hasShedule = true;

        _addressToInfo[_allocators[0]].shedule = [1_71, 0, 0, 0, 0, 0, 0, 0];
        _addressToInfo[_allocators[1]].shedule = [0, 1_00, 3_00, 5_12, 3_00, 6_29, 4_59, 7_00];
        _addressToInfo[_allocators[2]].shedule = [6_67, 0, 0, 0, 0, 0, 0, 0];
        _addressToInfo[_allocators[3]].shedule = [0, 20, 70, 60, 2_50, 3_90, 50, 1_60];
        _addressToInfo[_allocators[4]].shedule = [1_00, 0, 0, 0, 0, 0, 0, 0];
        _addressToInfo[_allocators[5]].shedule = [10, 50, 60, 2_80, 1_00, 2_20, 1_30, 1_50];
        _addressToInfo[_allocators[6]].shedule = [27, 1_00, 2_00, 3_00, 3_00, 3_69, 2_00, 3_03];
        _addressToInfo[_allocators[7]].shedule = [0, 20, 40, 2_50, 1_90, 1_50, 2_00, 1_50];
        _addressToInfo[_allocators[8]].shedule = [25, 0, 0, 0, 0, 0, 0, 0];
        _addressToInfo[_allocators[9]].shedule = [0, 1_10, 1_90, 1_78, 1_20, 1_92, 1_41, 3_07];
    }

    function getAddressInfo(
        address account
    ) external view returns (bool hasShedule, uint256[10] memory shedule) {
        return (
            _addressToInfo[account].hasShedule,
            _addressToInfo[account].shedule
        );
    }


}
