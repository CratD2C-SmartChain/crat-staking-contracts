// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@quant-finance/solidity-datetime/contracts/DateTime.sol";

contract CratVesting is AccessControl, ReentrancyGuard {
    uint256 public constant PRECISION = 100_00;
    uint256 public constant TOTAL_SUPPLY = 300_000_000 * 10 ** 18;

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
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    // ownable methods

    function startDistribution(
        address[10] memory allocators
    ) external payable onlyRole(DEFAULT_ADMIN_ROLE) {
        require(msg.value == TOTAL_SUPPLY, "CratVesting: wrong vesting supply");
        _startYear = 2024;
        _endYear = 2038;

        _allocators = allocators;

        for (uint256 i; i < 10; i++) {
            require(allocators[i] != address(0), "CratVesting: 0x00");
            _addressToInfo[allocators[i]].hasShedule = true;
        }

        _addressToInfo[allocators[0]].shedule = [1_71, 0, 0, 0, 0, 0, 0, 0];
        _addressToInfo[allocators[1]].shedule = [
            0,
            1_00,
            3_00,
            5_12,
            3_00,
            6_29,
            4_59,
            7_00
        ];
        _addressToInfo[allocators[2]].shedule = [6_67, 0, 0, 0, 0, 0, 0, 0];
        _addressToInfo[allocators[3]].shedule = [
            0,
            20,
            70,
            60,
            2_50,
            3_90,
            50,
            1_60
        ];
        _addressToInfo[allocators[4]].shedule = [1_00, 0, 0, 0, 0, 0, 0, 0];
        _addressToInfo[allocators[5]].shedule = [
            10,
            50,
            60,
            2_80,
            1_00,
            2_20,
            1_30,
            1_50
        ];
        _addressToInfo[allocators[6]].shedule = [
            27,
            1_00,
            2_00,
            3_00,
            3_00,
            3_69,
            2_00,
            3_03
        ];
        _addressToInfo[allocators[7]].shedule = [
            0,
            20,
            40,
            2_50,
            1_90,
            1_50,
            2_00,
            1_50
        ];
        _addressToInfo[allocators[8]].shedule = [25, 0, 0, 0, 0, 0, 0, 0];
        _addressToInfo[allocators[9]].shedule = [
            0,
            1_10,
            1_90,
            1_78,
            1_20,
            1_92,
            1_41,
            3_07
        ];
    }

    function claim(
        address to,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        uint256 totalPending = pending(to);
        require(
            totalPending >= amount && amount > 0,
            "CratVesting: wrong amount"
        );
        _claim(to, amount);
    }

    function claimAll(address to) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        uint256 totalPending = pending(to);
        require(totalPending > 0, "CratVesting: nothing to claim");
        _claim(to, totalPending);
    }

    // view methods

    function pending(address user) public view returns (uint256 unlocked) {
        if (_startYear == 0 || !_addressToInfo[user].hasShedule) return 0;

        uint16 currentYear = uint16(DateTime.getYear(block.timestamp));
        currentYear = currentYear > _endYear ? _endYear : currentYear;
        uint256 indexTill = (currentYear - _startYear) / 2;
        for (uint256 i; i <= indexTill; i++) {
            unlocked +=
                (_addressToInfo[user].shedule[i] * TOTAL_SUPPLY) /
                PRECISION;
        }
        unlocked -= _addressToInfo[user].claimed;
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
        require(success, "CratVesting: native transfer failed");
    }
}
