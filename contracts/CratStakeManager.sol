// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

contract CratStakeManager is
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable
{
    using EnumerableSet for EnumerableSet.AddressSet;

    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    uint256 public constant PRECISION = 100_00;
    uint256 public constant YEAR_DURATION = 365 days;
    uint256 private constant _ACCURACY = 10 ** 18;

    GeneralSettings public settings;
    address public slashReceiver;

    uint256 public totalValidatorsPool;
    uint256 public totalDelegatorsPool;
    uint256 public stoppedValidatorsPool;
    uint256 public stoppedDelegatorsPool;

    EnumerableSet.AddressSet private _validators; // list of all active validators
    EnumerableSet.AddressSet private _stopListValidators; // waiting pool before `withdrawAsValidator`

    mapping(address => ValidatorInfo) private _validatorInfo; // all info for each validator
    mapping(address => DelegatorInfo) private _delegatorInfo; // all info for each delegator

    struct ValidatorInfo {
        uint256 amount;
        uint256 commission;
        uint256 lastClaim;
        uint256 calledForWithdraw;
        FixedReward fixedReward;
        uint256 variableReward;
        uint256 delegatedAmount;
        uint256 stoppedDelegatedAmount;
        uint256 delegatorsAcc;
        EnumerableSet.AddressSet delegators;
    }

    struct DelegatorInfo {
        address validator;
        uint256 amount;
        uint256 lastClaim;
        uint256 calledForWithdraw;
        FixedReward fixedReward;
        VariableReward variableReward;
    }

    struct FixedReward {
        uint256 apr;
        uint256 lastUpdate;
        uint256 fixedReward;
    }

    struct VariableReward {
        uint256 storedAcc;
        uint256 variableReward;
    }

    struct GeneralSettings {
        uint256 validatorsLimit;
        RoleSettings validatorsSettings;
        RoleSettings delegatorsSettings;
    }

    struct RoleSettings {
        uint256 apr;
        uint256 minimumThreshold;
        uint256 claimCooldown;
        uint256 withdrawCooldown;
    }

    constructor() {
        _disableInitializers();
    }

    receive() external payable {
        //
    }

    function initalize(
        address _distributor,
        address _receiver
    ) public initializer {
        require(_receiver != address(0), "CratStakeManager: 0x00");

        __AccessControl_init();
        __ReentrancyGuard_init();

        settings = GeneralSettings(
            101,
            RoleSettings(15_00, 100_000 * 10 ** 18, 2 weeks, 7 days),
            RoleSettings(13_00, 1000 * 10 ** 18, 30 days, 5 days)
        );

        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        if (_distributor != address(0))
            _grantRole(DISTRIBUTOR_ROLE, _distributor);
    }

    // admin methods

    function setSlashReceiver(
        address receiver
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(receiver != address(0), "CratStakeManager: 0x00");
        slashReceiver = receiver;
    }

    function setValidatorsLimit(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(value >= _validators.length(), "CratStakeManager: wrong limit");
        settings.validatorsLimit = value;
    }

    function setValidatorsWithdrawCooldown(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settings.validatorsSettings.withdrawCooldown = value;
    }

    function setDelegatorsWithdrawCooldown(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settings.delegatorsSettings.withdrawCooldown = value;
    }

    function setValidatorsMinimum(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settings.validatorsSettings.minimumThreshold = value;
    }

    function setDelegatorsMinimum(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settings.delegatorsSettings.minimumThreshold = value;
    }

    function setValidatorsAPR(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settings.validatorsSettings.apr = value;
    }

    function setDelegatorsAPR(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settings.delegatorsSettings.apr = value;
    }

    function setValidatorsClaimCooldown(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settings.validatorsSettings.claimCooldown = value;
    }

    function setDelegatorsClaimCooldown(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settings.delegatorsSettings.claimCooldown = value;
    }

    // distributor methods

    function distributeRewards(
        address[] calldata validators,
        uint256[] calldata amounts
    ) external payable onlyRole(DISTRIBUTOR_ROLE) nonReentrant {
        uint256 len = validators.length;
        require(amounts.length == len, "CratStakeManager: different length");

        uint256 totalReward;
        uint256 fee;

        for (uint256 i; i < len; i) {
            if (_validatorInfo[validators[i]].amount > 0 && amounts[i] > 0) {
                if (_validatorInfo[validators[i]].delegatedAmount > 0) {
                    fee =
                        (amounts[i] *
                            _validatorInfo[validators[i]].commission) /
                        PRECISION;
                    _validatorInfo[validators[i]].delegatorsAcc +=
                        (fee * _ACCURACY) /
                        (_validatorInfo[validators[i]].delegatedAmount +
                            _validatorInfo[validators[i]]
                                .stoppedDelegatedAmount);
                }
                _validatorInfo[validators[i]].variableReward +=
                    amounts[i] -
                    fee;
                totalReward += amounts[i];

                delete fee;
            }
        }

        require(msg.value == totalReward, "CratStakeManager: wrong amounts");
    }

    function slash(
        address[] calldata validators,
        uint256[] calldata amounts
    ) external onlyRole(DISTRIBUTOR_ROLE) nonReentrant {
        // TODO
    }

    // public methods

    function depositAsValidator(
        uint256 commission
    ) external payable nonReentrant {
        uint256 amount = msg.value;
        address sender = _msgSender();

        require(
            _validatorInfo[sender].calledForWithdraw == 0,
            "CratStakeManager: in stop list"
        );

        require(
            amount + _validatorInfo[sender].amount >=
                settings.validatorsSettings.minimumThreshold &&
                amount > 0,
            "CratStakeManager: wrong input amount"
        );
        require(
            _validators.length() < settings.validatorsLimit,
            "CratStakeManager: limit reached"
        );

        require(
            _delegatorInfo[sender].amount == 0,
            "CratStakeManager: validators only"
        );

        _depositAsValidator(sender, amount, commission);
    }

    function depositAsDelegator(
        address validator
    ) external payable nonReentrant {
        uint256 amount = msg.value;
        address sender = _msgSender();

        require(
            _delegatorInfo[sender].calledForWithdraw == 0,
            "CratStakeManager: in stop list"
        );

        require(
            _validatorInfo[sender].amount == 0,
            "CratStakeManager: delegators only"
        );
        require(
            amount > 0 &&
                _delegatorInfo[sender].amount + amount >=
                settings.delegatorsSettings.minimumThreshold,
            "CratStakeManager: wrong input amount"
        );

        _depositAsDelegator(sender, amount, validator);
    }

    function claim() external nonReentrant {
        address sender = _msgSender();
        uint256 reward;
        if (_validatorInfo[sender].amount > 0)
            reward = _claimAsValidator(sender);
        else reward = _claimAsDelegator(sender);
        if (reward > 0) _safeTransferETH(sender, reward);
    }

    function restake() external nonReentrant {
        address sender = _msgSender();
        bool isValidator = _validatorInfo[sender].amount > 0;
        uint256 reward;
        if (isValidator) reward = _claimAsValidator(sender);
        else reward = _claimAsDelegator(sender);
        require(reward > 0, "CratStakeManager: nothing to restake");
        if (isValidator) _depositAsValidator(sender, reward, 0); // not set zero commission, but keeps previous value
        _depositAsDelegator(sender, reward, address(0)); // not set zero validator address, but keeps previous value
    }

    function validatorCallForWithdraw() external nonReentrant {
        address sender = _msgSender();
        require(
            _validatorInfo[sender].amount > 0 &&
                _validatorInfo[sender].calledForWithdraw == 0,
            "CratStakeManager: not active validator"
        );

        _updateValidatorReward(sender);

        _validatorInfo[sender].calledForWithdraw = block.timestamp;
        _validators.remove(sender);
        _stopListValidators.add(sender);

        totalValidatorsPool -= _validatorInfo[sender].amount;
        totalDelegatorsPool -= _validatorInfo[sender].delegatedAmount;
        stoppedValidatorsPool += _validatorInfo[sender].amount;
        stoppedDelegatorsPool -= _validatorInfo[sender].delegatedAmount;

        _validatorInfo[sender].stoppedDelegatedAmount += _validatorInfo[sender]
            .delegatedAmount;
        delete _validatorInfo[sender].delegatedAmount;
    }

    function delegatorCallForWithdraw() external nonReentrant {
        address sender = _msgSender();
        require(
            _delegatorInfo[sender].amount > 0 &&
                _delegatorInfo[sender].calledForWithdraw == 0,
            "CratStakeManager: not active delegator"
        );

        _updateDelegatorReward(sender);

        _delegatorInfo[sender].calledForWithdraw = block.timestamp;

        address validator = _delegatorInfo[sender].validator;
        _validatorInfo[validator].delegators.remove(sender);
        if (_validatorInfo[validator].calledForWithdraw == 0) {
            totalDelegatorsPool -= _delegatorInfo[sender].amount;
            stoppedDelegatorsPool += _delegatorInfo[sender].amount;
            _validatorInfo[validator].delegatedAmount -= _delegatorInfo[sender]
                .amount;
            _validatorInfo[validator].stoppedDelegatedAmount += _delegatorInfo[
                sender
            ].amount;
        }
    }

    function withdrawAsValidator() external nonReentrant {
        address sender = _msgSender();
        require(
            _validatorInfo[sender].calledForWithdraw > 0 &&
                _validatorInfo[sender].calledForWithdraw +
                    settings.validatorsSettings.withdrawCooldown <=
                block.timestamp,
            "CratStakeManager: withdraw cooldown"
        );
        // TODO
    }

    function withdrawAsDelegator() external nonReentrant {
        address sender = _msgSender();
        // TODO: if validator calls for withdraw
        require(
            _delegatorInfo[sender].calledForWithdraw > 0 &&
                _delegatorInfo[sender].calledForWithdraw +
                    settings.delegatorsSettings.withdrawCooldown <=
                block.timestamp,
            "CratStakeManager: withdraw cooldown"
        );

        uint256 amount = _claimAsDelegator(sender);
        amount += _delegatorInfo[sender].amount;

        stoppedDelegatorsPool -= _delegatorInfo[sender].amount;
        _validatorInfo[_delegatorInfo[sender].validator]
            .stoppedDelegatedAmount -= _delegatorInfo[sender].amount;

        delete _delegatorInfo[sender];
        _safeTransferETH(sender, amount);
    }

    function reviveAsValidator() external payable nonReentrant {
        // TODO
    }

    function reviveAsDelegator() external payable nonReentrant {
        // TODO
    }

    // view methods

    function validatorEarned(
        address validator
    ) public view returns (uint256 fixedReward, uint256 variableReward) {
        fixedReward =
            _validatorInfo[validator].fixedReward.fixedReward +
            ((_rightBoarder(validator, true) -
                _validatorInfo[validator].fixedReward.lastUpdate) *
                _validatorInfo[validator].amount *
                _validatorInfo[validator].fixedReward.apr) /
            (YEAR_DURATION * PRECISION);
        variableReward = _validatorInfo[validator].variableReward;
    }

    function delegatorEarned(
        address delegator
    ) public view returns (uint256 fixedReward, uint256 variableReward) {
        fixedReward = _delegatorInfo[delegator].fixedReward.fixedReward;
        variableReward = _delegatorInfo[delegator]
            .variableReward
            .variableReward;

        // calculate fixed & variable reward
        if (_delegatorInfo[delegator].amount > 0) {
            fixedReward +=
                (_delegatorInfo[delegator].amount *
                    (_rightBoarder(delegator, false) -
                        _delegatorInfo[delegator].fixedReward.lastUpdate) *
                    _delegatorInfo[delegator].fixedReward.apr) /
                (YEAR_DURATION * PRECISION);

            variableReward +=
                ((_validatorInfo[_delegatorInfo[delegator].validator]
                    .delegatorsAcc -
                    _delegatorInfo[delegator].variableReward.storedAcc) *
                    _delegatorInfo[delegator].amount) /
                _ACCURACY;
        }
    }

    // internal methods

    function _updateValidatorReward(address validator) internal {
        // store fixed reward
        (_validatorInfo[validator].fixedReward.fixedReward, ) = validatorEarned(
            validator
        );
        _validatorInfo[validator].fixedReward.lastUpdate = block.timestamp;
        _validatorInfo[validator].fixedReward.apr = settings
            .validatorsSettings
            .apr; // change each _update call (to keep it actual)
    }

    function _updateDelegatorReward(address delegator) internal {
        // store fixed & variable rewards
        (
            _delegatorInfo[delegator].fixedReward.fixedReward,
            _delegatorInfo[delegator].variableReward.variableReward
        ) = delegatorEarned(delegator);
        _delegatorInfo[delegator].fixedReward.lastUpdate = block.timestamp;
        _delegatorInfo[delegator].fixedReward.apr = settings
            .delegatorsSettings
            .apr; // change each _update call (to keep it actual)
        _delegatorInfo[delegator].variableReward.storedAcc = _validatorInfo[
            _delegatorInfo[delegator].validator
        ].delegatorsAcc;
    }

    function _depositAsValidator(
        address validator,
        uint256 amount,
        uint256 commission
    ) internal {
        // update rewards
        _updateValidatorReward(validator);

        if (_validatorInfo[validator].amount == 0) {
            require(
                commission <= PRECISION,
                "CratStakeManager: too high commission"
            );

            _validatorInfo[validator].commission = commission; // do not allow change commission value once validator has been registered
            _validatorInfo[validator].lastClaim = block.timestamp; // to keep unboarding period
            _validators.add(validator);
        }
        _validatorInfo[validator].amount += amount;
        totalValidatorsPool += amount;
    }

    function _depositAsDelegator(
        address delegator,
        uint256 amount,
        address validator
    ) internal {
        // update delegator rewards
        _updateDelegatorReward(delegator);

        if (_delegatorInfo[delegator].amount == 0) {
            require(
                _validatorInfo[validator].amount > 0,
                "CratStakeManager: wrong validator"
            );

            _delegatorInfo[delegator].validator = validator;
            _delegatorInfo[delegator].lastClaim = block.timestamp; // to keep unboarding period
            _validatorInfo[validator].delegators.add(delegator);
        } else {
            validator = _delegatorInfo[delegator].validator;
        }

        _delegatorInfo[delegator].amount += amount;
        _validatorInfo[validator].delegatedAmount += amount;
        totalDelegatorsPool += amount;
    }

    function _claimAsValidator(
        address validator
    ) internal returns (uint256 toClaim) {
        require(
            _validatorInfo[validator].lastClaim +
                settings.validatorsSettings.claimCooldown <=
                block.timestamp,
            "CratStakeManager: claim cooldown"
        );

        _updateValidatorReward(validator);

        toClaim =
            _validatorInfo[validator].fixedReward.fixedReward +
            _validatorInfo[validator].variableReward;

        if (toClaim > 0) {
            _validatorInfo[validator].lastClaim = block.timestamp;
            delete _validatorInfo[validator].fixedReward.fixedReward;
            delete _validatorInfo[validator].variableReward;
        }
    }

    function _claimAsDelegator(
        address delegator
    ) internal returns (uint256 toClaim) {
        require(
            _delegatorInfo[delegator].lastClaim +
                settings.delegatorsSettings.claimCooldown <=
                block.timestamp,
            "CratStakeManager: claim cooldown"
        );

        _updateDelegatorReward(delegator);

        toClaim =
            _delegatorInfo[delegator].fixedReward.fixedReward +
            _delegatorInfo[delegator].variableReward.variableReward;

        if (toClaim > 0) {
            _delegatorInfo[delegator].lastClaim = block.timestamp;
            delete _delegatorInfo[delegator].fixedReward.fixedReward;
            delete _delegatorInfo[delegator].variableReward.variableReward;
        }
    }

    function _safeTransferETH(address _to, uint256 _value) internal {
        (bool success, ) = _to.call{value: _value}(new bytes(0));
        require(success, "CratStakeManager: native transfer failed");
    }

    // internal view methods

    function _rightBoarder(
        address account,
        bool isValidator
    ) internal view returns (uint256) {
        if (isValidator)
            return
                _validatorInfo[account].calledForWithdraw > 0
                    ? _validatorInfo[account].calledForWithdraw
                    : block.timestamp;
        else {
            address validator = _delegatorInfo[account].validator;
            if (
                _validatorInfo[validator].calledForWithdraw > 0 &&
                _delegatorInfo[account].calledForWithdraw > 0
            ) {
                return
                    Math.min(
                        _validatorInfo[validator].calledForWithdraw,
                        _delegatorInfo[account].calledForWithdraw
                    );
            } else if (_validatorInfo[validator].calledForWithdraw > 0)
                return _validatorInfo[validator].calledForWithdraw;
            else if (_delegatorInfo[account].calledForWithdraw > 0)
                return _delegatorInfo[account].calledForWithdraw;
            else return block.timestamp;
        }
    }
}
