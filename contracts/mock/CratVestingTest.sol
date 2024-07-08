// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@quant-finance/solidity-datetime/contracts/DateTime.sol";

contract CRATVestingTest is AccessControl, ReentrancyGuard {
    uint256 public constant PRECISION = 10 ** 26;
    uint256 public constant TOTAL_SUPPLY = 300_000_000 * 10 ** 18;

    uint256 public testTime;

    uint16 private _startYear;
    uint16 private _endYear;

    address[10] private _allocators; // [early adoptors, royalties, ico, CTVG, ieo, team, staking rewards, liquidity, airdrop, manual distribution]
    mapping(address => AddressInfo) private _addressToInfo;

    struct AddressInfo {
        bool hasShedule;
        uint256 claimed;
        uint256[8] shedule;
    }

    constructor(address _admin) {
        require(_admin != address(0), "CRATVesting: 0x00");
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);

        testTime = block.timestamp;
    }

    function chnageTestTime(uint256 value) external {
        require(testTime < value);
        testTime = value;
    }

    // admin methods

    function startDistribution(
        address[10] memory allocators
    ) external payable onlyRole(DEFAULT_ADMIN_ROLE) {
        require(msg.value == TOTAL_SUPPLY, "CRATVesting: wrong vesting supply");
        _startYear = 2024;
        _endYear = 2038;

        _allocators = allocators;

        for (uint256 i; i < 10; i++) {
            require(allocators[i] != address(0), "CRATVesting: 0x00");
            _addressToInfo[allocators[i]].hasShedule = true;
        }

        _addressToInfo[allocators[0]].shedule = [
            1_709000000000000000000000,
            0,
            0,
            0,
            0,
            0,
            0,
            0
        ];
        _addressToInfo[allocators[1]].shedule = [
            0,
            1_000000000000000000000000,
            3_000000000000000000000000,
            5_119000000000000000000000,
            3_000000000000000000000000,
            6_291000000000000000000000,
            4_590000000000000000000000,
            7_000000000000000000000000
        ];
        _addressToInfo[allocators[2]].shedule = [
            6_666666666666666666666666,
            0,
            0,
            0,
            0,
            0,
            0,
            0
        ];
        _addressToInfo[allocators[3]].shedule = [
            0,
            200000000000000000000000,
            700000000000000000000000,
            600000000000000000000000,
            2_500000000000000000000000,
            3_900000000000000000000000,
            500000000000000000000000,
            1_600000000000000000000000
        ];
        _addressToInfo[allocators[4]].shedule = [
            1_000000000000000000000000,
            0,
            0,
            0,
            0,
            0,
            0,
            0
        ];
        _addressToInfo[allocators[5]].shedule = [
            100000000000000000000000,
            500000000000000000000000,
            600000000000000000000000,
            2_800000000000000000000000,
            1_000000000000000000000000,
            2_200000000000000000000000,
            1_300000000000000000000000,
            1_500000000000000000000000
        ];
        _addressToInfo[allocators[6]].shedule = [
            274333333333333333333333,
            1_000000000000000000000000,
            2_000000000000000000000000,
            3_000000000000000000000000,
            3_000000000000000000000000,
            3_692300000000000000000000,
            2_000000000000000000000000,
            3_033400000000000000000000
        ];
        _addressToInfo[allocators[7]].shedule = [
            0,
            200000000000000000000000,
            400000000000000000000000,
            2_500000000000000000000000,
            1_900000000000000000000000,
            1_500000000000000000000000,
            2_000000000000000000000000,
            1_500000000000000000000000
        ];
        _addressToInfo[allocators[8]].shedule = [
            250000000000000000000000,
            0,
            0,
            0,
            0,
            0,
            0,
            0
        ];
        _addressToInfo[allocators[9]].shedule = [
            0,
            1_100000000000000000000000,
            1_900000000000000000000000,
            1_781000000000000000000000,
            1_200000000000000000000000,
            1_916700000000000000000000,
            1_410000000000000000000000,
            3_066600000000000000000000
        ];
    }

    function claim(
        address to,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        uint256 totalPending = pending(to);
        require(
            totalPending >= amount && amount > 0,
            "CRATVesting: wrong amount"
        );
        _claim(to, amount);
    }

    function claimAll(
        address to
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        uint256 totalPending = pending(to);
        require(totalPending > 0, "CRATVesting: nothing to claim");
        _claim(to, totalPending);
    }

    // view methods

    function pending(address user) public view returns (uint256 unlocked) {
        if (_startYear == 0 || !_addressToInfo[user].hasShedule) return 0;

        uint256 currentYear = DateTime.getYear(testTime);
        currentYear = currentYear > _endYear ? _endYear : currentYear;
        uint256 indexTill = (currentYear - _startYear) / 2;
        uint256 perc;
        for (uint256 i; i <= indexTill; i++) {
            perc += _addressToInfo[user].shedule[i];
        }
        unlocked =
            (perc * TOTAL_SUPPLY) /
            PRECISION -
            _addressToInfo[user].claimed;
    }

    function getAddressInfo(
        address account
    )
        external
        view
        returns (bool hasShedule, uint256 claimed, uint256[8] memory shedule)
    {
        return (
            _addressToInfo[account].hasShedule,
            _addressToInfo[account].claimed,
            _addressToInfo[account].shedule
        );
    }

    function getAllocationAddresses()
        external
        view
        returns (address[10] memory)
    {
        return _allocators;
    }

    // internal methods

    function _claim(address to, uint256 amount) internal {
        _addressToInfo[to].claimed += amount;
        _safeTransferETH(to, amount);
    }

    function _safeTransferETH(address _to, uint256 _value) internal {
        (bool success, ) = _to.call{value: _value}(new bytes(0));
        require(success, "CRATVesting: native transfer failed");
    }
}
