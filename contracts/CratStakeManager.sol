// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

contract CratD2CStakeManager is
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable
{
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @notice value of the distributor role
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    /// @notice value of the swap contract role
    bytes32 public constant SWAP_ROLE = keccak256("SWAP_ROLE");

    /// @notice denominator for percent calculations
    uint256 public constant PRECISION = 100_00;

    /// @notice year duration in seconds
    uint256 public constant YEAR_DURATION = 365 days;

    uint256 private constant _ACCURACY = 10 ** 18;

    /// @notice global contract settings
    GeneralSettings public settings;

    /// @notice total validators counter
    uint256 public totalValidatorsPool;

    /// @notice total delegators counter
    uint256 public totalDelegatorsPool;

    /// @notice sum of stopped validators' deposits
    uint256 public stoppedValidatorsPool;

    /// @notice sum of stopped delegators' deposits
    uint256 public stoppedDelegatorsPool;

    /// @notice sum of tokens available to distribute for fixed rewards
    uint256 public forFixedReward;

    TotalRewardsDistributed private _totalValidatorsRewards;
    TotalRewardsDistributed private _totalDelegatorsRewards;

    EnumerableSet.AddressSet private _validators; // list of all active validators
    EnumerableSet.AddressSet private _stopListValidators; // waiting pool before `withdrawAsValidator`

    mapping(address => ValidatorInfo) private _validatorInfo; // all info for each validator
    mapping(address => DelegatorInfo) private _delegatorInfo; // all info for each delegator

    struct ValidatorInfo {
        uint256 amount;
        uint256 commission;
        uint256 lastClaim;
        uint256 calledForWithdraw;
        uint256 vestingEnd;
        FixedReward fixedReward;
        VariableReward variableReward;
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
        DelegatorsVariableReward variableReward;
    }

    struct FixedReward {
        uint256 apr;
        uint256 lastUpdate;
        uint256 fixedReward;
        uint256 totalClaimed;
    }

    struct DelegatorsVariableReward {
        uint256 storedAcc;
        VariableReward variableReward;
    }

    struct VariableReward {
        uint256 variableReward;
        uint256 totalClaimed;
    }

    struct GeneralSettings {
        uint256 validatorsLimit;
        address slashReceiver;
        RoleSettings validatorsSettings;
        RoleSettings delegatorsSettings;
    }

    struct RoleSettings {
        uint256 apr;
        uint256 toSlash;
        uint256 minimumThreshold;
        uint256 claimCooldown;
        uint256 withdrawCooldown;
    }

    struct TotalRewardsDistributed {
        uint256 variableReward;
        uint256 fixedLastUpdate;
        uint256 fixedReward;
    }

    event ValidatorDeposited(
        address validator,
        uint256 amount,
        uint256 commission
    );
    event ValidatorClaimed(address validator, uint256 amount);
    event ValidatorCalledForWithdraw(address validator);
    event ValidatorRevived(address validator);
    event ValidatorWithdrawed(address validator);

    event DelegatorDeposited(
        address delegator,
        address validator,
        uint256 amount
    );
    event DelegatorClaimed(address delegator, uint256 amount);
    event DelegatorCalledForWithdraw(address delegator);
    event DelegatorRevived(address delegator);
    event DelegatorWithdrawed(address delegator);

    receive() external payable {
        forFixedReward += msg.value;
    }

    function initialize(
        address _distributor,
        address _receiver
    ) public initializer {
        require(_receiver != address(0), "CratD2CStakeManager: 0x00");

        __AccessControl_init();
        __ReentrancyGuard_init();

        settings = GeneralSettings(
            101,
            _receiver,
            RoleSettings(
                15_00,
                100 * 10 ** 18,
                100_000 * 10 ** 18,
                2 weeks,
                7 days
            ),
            RoleSettings(13_00, 5_00, 1000 * 10 ** 18, 30 days, 5 days)
        );

        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        if (_distributor != address(0))
            _grantRole(DISTRIBUTOR_ROLE, _distributor);

        _totalValidatorsRewards.fixedLastUpdate = block.timestamp;
        _totalDelegatorsRewards.fixedLastUpdate = block.timestamp;
    }

    // admin methods

    /** @notice change slash receiver address
     * @param receiver new slash receiver address
     * @dev only admin
     */
    function setSlashReceiver(
        address receiver
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(receiver != address(0), "CratD2CStakeManager: 0x00");
        settings.slashReceiver = receiver;
    }

    /** @notice change validators limit
     * @param value new validators limit
     * @dev only admin
     */
    function setValidatorsLimit(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(
            value >= _validators.length(),
            "CratD2CStakeManager: wrong limit"
        );
        settings.validatorsLimit = value;
    }

    /** @notice change validators' withdraw cooldown
     * @param value new time peroid duration
     * @dev only admin
     */
    function setValidatorsWithdrawCooldown(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settings.validatorsSettings.withdrawCooldown = value;
    }

    /** @notice change delegators' withdraw cooldown
     * @param value new time peroid duration
     * @dev only admin
     */
    function setDelegatorsWithdrawCooldown(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settings.delegatorsSettings.withdrawCooldown = value;
    }

    /** @notice change validators' minimum amount to deposit
     * @param value new minimum amount
     * @dev only admin
     */
    function setValidatorsMinimum(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settings.validatorsSettings.minimumThreshold = value;
    }

    /** @notice change delegators' minimum amount to deposit
     * @param value new minimum amount
     * @dev only admin
     */
    function setDelegatorsMinimum(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settings.delegatorsSettings.minimumThreshold = value;
    }

    /** @notice change validators' token amount to slash (to substract from their deposit)
     * @param value new slash token amount
     * @dev only admin
     */
    function setValidatorsAmountToSlash(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settings.validatorsSettings.toSlash = value;
    }

    /** @notice change delegators' percent to slash (to substract that percent of their deposit)
     * @param value new slash percent of the deposit
     * @dev only admin
     */
    function setDelegatorsPercToSlash(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(value <= PRECISION, "CratD2CStakeManager: wrong percent");
        settings.delegatorsSettings.toSlash = value;
    }

    /** @notice change validators' fixed APR
     * @param value new apr value
     * @dev only admin
     */
    function setValidatorsAPR(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _updateFixedValidatorsReward();
        settings.validatorsSettings.apr = value;
    }

    /** @notice change delegators' fixed APR
     * @param value new apr value
     * @dev only admin
     */
    function setDelegatorsAPR(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _updateFixedDelegatorsReward();
        settings.delegatorsSettings.apr = value;
    }

    /** @notice change validators' claim cooldown
     * @param value new time peroid duration
     * @dev only admin
     */
    function setValidatorsClaimCooldown(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settings.validatorsSettings.claimCooldown = value;
    }

    /** @notice change delegators' claim cooldown
     * @param value new time peroid duration
     * @dev only admin
     */
    function setDelegatorsClaimCooldown(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settings.delegatorsSettings.claimCooldown = value;
    }

    /** @notice withdraw excess reward coins from {forFixedReward} pool
     * @param amount token amount
     * @dev only admin
     */
    function withdrawExcessFixedReward(
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(
            forFixedReward >= amount,
            "CratD2CStakeManager: not enough coins"
        );
        forFixedReward -= amount;
        _safeTransferETH(_msgSender(), amount);
    }

    // distributor methods

    /** @notice distribute rewards to validators (and their delegators automatically)
     * @param validators an array of validator addresses
     * @param amounts an array of reward amounts
     * @dev only depositor
     */
    function distributeRewards(
        address[] calldata validators,
        uint256[] calldata amounts
    ) external payable onlyRole(DISTRIBUTOR_ROLE) nonReentrant {
        uint256 len = validators.length;
        require(
            amounts.length == len && len > 0,
            "CratD2CStakeManager: wrong length"
        );

        uint256 totalReward;
        uint256 totalValidatorsReward;
        uint256 totalDelegatorsReward;
        uint256 fee;

        for (uint256 i; i < len; i++) {
            if (isValidator(validators[i]) && amounts[i] > 0) {
                if (
                    _validatorInfo[validators[i]].delegatedAmount +
                        _validatorInfo[validators[i]].stoppedDelegatedAmount >
                    0
                ) {
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
                _validatorInfo[validators[i]].variableReward.variableReward +=
                    amounts[i] -
                    fee;

                totalDelegatorsReward += fee;
                totalValidatorsReward += amounts[i] - fee;

                delete fee;
            }
        }

        totalReward = totalDelegatorsReward + totalValidatorsReward;

        require(
            msg.value >= totalReward,
            "CratD2CStakeManager: not enough coins"
        );

        _totalValidatorsRewards.variableReward += totalValidatorsReward;
        _totalDelegatorsRewards.variableReward += totalDelegatorsReward;

        if (msg.value > totalReward)
            _safeTransferETH(_msgSender(), msg.value - totalReward); // send excess coins back
    }

    /** @notice slash validators (and their delegators automatically)
     * @param validators an array of validator addresses
     * @dev only depositor
     */
    function slash(
        address[] calldata validators
    ) external onlyRole(DISTRIBUTOR_ROLE) nonReentrant {
        uint256 len = validators.length;
        uint256 delegatorsPerc = settings.delegatorsSettings.toSlash;
        uint256 fee;
        bool stopDelegators;
        address[] memory delegators;
        uint256 total;
        for (uint256 i; i < len; i++) {
            if (isValidator(validators[i])) {
                _updateValidatorReward(validators[i]);

                fee = _validatorInfo[validators[i]].amount >
                    settings.validatorsSettings.toSlash
                    ? settings.validatorsSettings.toSlash
                    : _validatorInfo[validators[i]].amount;
                _validatorInfo[validators[i]].amount -= fee;
                total += fee;
                delegators = _validatorInfo[validators[i]].delegators.values();
                if (_validatorInfo[validators[i]].calledForWithdraw > 0) {
                    // for validator
                    stoppedValidatorsPool -= fee;

                    // for stopped delegators
                    fee =
                        (delegatorsPerc *
                            _validatorInfo[validators[i]]
                                .stoppedDelegatedAmount) /
                        PRECISION;
                    _validatorInfo[validators[i]].stoppedDelegatedAmount -= fee;
                    stoppedDelegatorsPool -= fee;
                    total += fee;
                } else {
                    // for validator
                    if (
                        _validatorInfo[validators[i]].amount <
                        settings.validatorsSettings.minimumThreshold
                    ) {
                        totalValidatorsPool -= fee;
                        _validatorCallForWithdraw(validators[i]);

                        // for stopped delegators
                        fee =
                            (delegatorsPerc *
                                _validatorInfo[validators[i]]
                                    .stoppedDelegatedAmount) /
                            PRECISION;
                        _validatorInfo[validators[i]]
                            .stoppedDelegatedAmount -= fee;
                        stoppedDelegatorsPool -= fee;
                        total += fee;
                    } else {
                        totalValidatorsPool -= fee;

                        // for active delegators
                        fee =
                            (delegatorsPerc *
                                _validatorInfo[validators[i]].delegatedAmount) /
                            PRECISION;
                        _validatorInfo[validators[i]].delegatedAmount -= fee;
                        totalDelegatorsPool -= fee;
                        total += fee;

                        // for stopped delegators
                        fee =
                            (delegatorsPerc *
                                _validatorInfo[validators[i]]
                                    .stoppedDelegatedAmount) /
                            PRECISION;
                        _validatorInfo[validators[i]]
                            .stoppedDelegatedAmount -= fee;
                        stoppedDelegatorsPool -= fee;
                        total += fee;

                        stopDelegators = true;
                    }
                }

                for (uint256 j; j < delegators.length; j++) {
                    _updateDelegatorReward(delegators[j]);
                    _delegatorInfo[delegators[j]].amount -=
                        (_delegatorInfo[delegators[j]].amount *
                            delegatorsPerc) /
                        PRECISION;

                    if (
                        _delegatorInfo[delegators[j]].amount <
                        settings.delegatorsSettings.minimumThreshold &&
                        _delegatorInfo[delegators[j]].calledForWithdraw == 0 &&
                        stopDelegators
                    ) {
                        _delegatorCallForWithdraw(delegators[j]);
                    }
                }

                delete fee;
                delete stopDelegators;
                delete delegators;
            }
        }

        if (total > 0) _safeTransferETH(settings.slashReceiver, total);
    }

    // swap contract methods

    /** @notice make deposit for exact user as validator
     * @param sender address of future validator
     * @param commission percent that this validator will give to delegators
     * @param vestingEnd timestamp of the vesting funds process end
     * @dev swap role only
     */
    function depositForValidator(
        address sender,
        uint256 commission,
        uint256 vestingEnd
    ) external payable onlyRole(SWAP_ROLE) nonReentrant {
        require(sender != address(0), "CratD2CStakeManager: 0x00");
        require(
            vestingEnd > block.timestamp &&
                _validatorInfo[sender].vestingEnd <= vestingEnd,
            "CratD2CStakeManager: wrong vesting end"
        );

        _validatorInfo[sender].vestingEnd = vestingEnd;

        uint256 amount = msg.value;

        require(
            amount + _validatorInfo[sender].amount >=
                settings.validatorsSettings.minimumThreshold &&
                amount > 0,
            "CratD2CStakeManager: wrong input amount"
        );
        if (!_validators.contains(sender))
            require(
                _validators.length() < settings.validatorsLimit,
                "CratD2CStakeManager: limit reached"
            );

        require(!isDelegator(sender), "CratD2CStakeManager: validators only");

        _depositAsValidator(sender, amount, commission);
    }

    // public methods

    /** @notice make deposit as validator
     * @param commission percent that this validator will give to delegators
     */
    function depositAsValidator(
        uint256 commission
    ) external payable nonReentrant {
        uint256 amount = msg.value;
        address sender = _msgSender();

        require(
            amount + _validatorInfo[sender].amount >=
                settings.validatorsSettings.minimumThreshold &&
                amount > 0,
            "CratD2CStakeManager: wrong input amount"
        );
        if (!_validators.contains(sender))
            require(
                _validators.length() < settings.validatorsLimit,
                "CratD2CStakeManager: limit reached"
            );

        require(!isDelegator(sender), "CratD2CStakeManager: validators only");

        _depositAsValidator(sender, amount, commission);
    }

    /** @notice make deposit as delegator
     * @param validator address chosen
     */
    function depositAsDelegator(
        address validator
    ) external payable nonReentrant {
        uint256 amount = msg.value;
        address sender = _msgSender();

        require(!isValidator(sender), "CratD2CStakeManager: delegators only");
        require(
            amount > 0 &&
                _delegatorInfo[sender].amount + amount >=
                settings.delegatorsSettings.minimumThreshold,
            "CratD2CStakeManager: wrong input amount"
        );

        _depositAsDelegator(sender, amount, validator);
    }

    /// @notice claim rewards earned
    function claim() external nonReentrant {
        address sender = _msgSender();
        bool _isValidator = isValidator(sender);
        require(
            _isValidator || isDelegator(sender),
            "CratD2CStakeManager: not registered"
        );
        uint256 reward;
        if (_isValidator) reward = _claimAsValidator(sender);
        else reward = _claimAsDelegator(sender);
        if (reward > 0) _safeTransferETH(sender, reward);
    }

    /// @notice restake rewards earned (claim + deposit)
    function restake() external nonReentrant {
        address sender = _msgSender();
        bool _isValidator = isValidator(sender);
        require(
            _isValidator || isDelegator(sender),
            "CratD2CStakeManager: not registered"
        );
        uint256 reward;
        if (_isValidator) reward = _claimAsValidator(sender);
        else reward = _claimAsDelegator(sender);
        require(reward > 0, "CratD2CStakeManager: nothing to restake");
        if (_isValidator)
            _depositAsValidator(sender, reward, 0); // not set zero commission, but keeps previous value
        else _depositAsDelegator(sender, reward, address(0)); // not set zero validator address, but keeps previous value
    }

    /// @notice sign up to a stop list as validator (will be able to withdraw deposit after cooldown)
    function validatorCallForWithdraw() external nonReentrant {
        address sender = _msgSender();
        require(
            isValidator(sender) &&
                _validatorInfo[sender].calledForWithdraw == 0,
            "CratD2CStakeManager: not active validator"
        );

        _validatorCallForWithdraw(sender);
    }

    /// @notice sign up to a stop list as delegator (will be able to withdraw deposit after cooldown)
    function delegatorCallForWithdraw() external nonReentrant {
        address sender = _msgSender();
        require(
            isDelegator(sender) &&
                _delegatorInfo[sender].calledForWithdraw == 0,
            "CratD2CStakeManager: not active delegator"
        );

        _delegatorCallForWithdraw(sender);
    }

    /// @notice withdraw deposit as validator (after cooldown; removes all its delegators automatically)
    function withdrawAsValidator() external nonReentrant {
        address sender = _msgSender();
        require(
            _validatorInfo[sender].calledForWithdraw > 0 &&
                _validatorInfo[sender].calledForWithdraw +
                    settings.validatorsSettings.withdrawCooldown <=
                block.timestamp &&
                _validatorInfo[sender].vestingEnd <= block.timestamp,
            "CratD2CStakeManager: withdraw cooldown"
        );

        address[] memory delegators = _validatorInfo[sender]
            .delegators
            .values();
        uint256 amount;
        for (uint256 i; i < delegators.length; i++) {
            amount = _claimAsDelegator(delegators[i]);
            amount += _delegatorInfo[delegators[i]].amount;
            delete _delegatorInfo[delegators[i]];
            _safeTransferETH(delegators[i], amount);

            emit DelegatorWithdrawed(delegators[i]);
        }

        amount = _claimAsValidator(sender);
        amount += _validatorInfo[sender].amount;
        stoppedValidatorsPool -= _validatorInfo[sender].amount;
        stoppedDelegatorsPool -= _validatorInfo[sender].stoppedDelegatedAmount;
        _stopListValidators.remove(sender);

        delete _validatorInfo[sender];
        _safeTransferETH(sender, amount);

        emit ValidatorWithdrawed(sender);
    }

    /// @notice withdraw deposit as delegator (after cooldown)
    function withdrawAsDelegator() external nonReentrant {
        address sender = _msgSender();
        uint256 calledForWithdraw;
        if (
            _delegatorInfo[sender].calledForWithdraw > 0 &&
            _validatorInfo[_delegatorInfo[sender].validator].calledForWithdraw >
            0
        ) {
            calledForWithdraw = Math.min(
                _delegatorInfo[sender].calledForWithdraw,
                _validatorInfo[_delegatorInfo[sender].validator]
                    .calledForWithdraw
            );
        } else if (_delegatorInfo[sender].calledForWithdraw > 0) {
            calledForWithdraw = _delegatorInfo[sender].calledForWithdraw;
        } else if (
            _validatorInfo[_delegatorInfo[sender].validator].calledForWithdraw >
            0
        ) {
            calledForWithdraw = _validatorInfo[_delegatorInfo[sender].validator]
                .calledForWithdraw;
        } else revert("CratD2CStakeManager: no call for withdraw");

        require(
            calledForWithdraw + settings.delegatorsSettings.withdrawCooldown <=
                block.timestamp,
            "CratD2CStakeManager: withdraw cooldown"
        );

        uint256 amount = _claimAsDelegator(sender);
        amount += _delegatorInfo[sender].amount;

        stoppedDelegatorsPool -= _delegatorInfo[sender].amount;
        _validatorInfo[_delegatorInfo[sender].validator]
            .stoppedDelegatedAmount -= _delegatorInfo[sender].amount;
        _validatorInfo[_delegatorInfo[sender].validator].delegators.remove(
            sender
        );

        delete _delegatorInfo[sender];
        _safeTransferETH(sender, amount);

        emit DelegatorWithdrawed(sender);
    }

    /// @notice exit the stop list as validator (increase your deposit, if necessary)
    function reviveAsValidator() external payable nonReentrant {
        address sender = _msgSender();
        require(
            isValidator(sender) && _validatorInfo[sender].calledForWithdraw > 0,
            "CratD2CStakeManager: no withdraw call"
        );
        require(
            _validatorInfo[sender].amount + msg.value >=
                settings.validatorsSettings.minimumThreshold,
            "CratD2CStakeManager: too low value"
        );
        require(
            _validators.length() < settings.validatorsLimit,
            "CratD2CStakeManager: limit reached"
        );

        // revive validator and his non-called for withdraw delegators
        _validatorInfo[sender].fixedReward.lastUpdate = block.timestamp;
        _validatorInfo[sender].fixedReward.apr = settings
            .validatorsSettings
            .apr;

        stoppedValidatorsPool -= _validatorInfo[sender].amount;
        _validatorInfo[sender].amount += msg.value;
        totalValidatorsPool += _validatorInfo[sender].amount;
        _stopListValidators.remove(sender);
        _validators.add(sender);

        address[] memory delegators = _validatorInfo[sender]
            .delegators
            .values();
        uint256 totalMigratedAmount;
        for (uint256 i; i < delegators.length; i++) {
            _updateDelegatorReward(delegators[i]);
            if (_delegatorInfo[delegators[i]].calledForWithdraw == 0) {
                _delegatorInfo[delegators[i]].fixedReward.lastUpdate = block
                    .timestamp;
                totalMigratedAmount += _delegatorInfo[delegators[i]].amount;
            } else {
                _delegatorInfo[delegators[i]]
                    .fixedReward
                    .lastUpdate = _delegatorInfo[delegators[i]]
                    .calledForWithdraw;
            }
        }

        delete _validatorInfo[sender].calledForWithdraw;
        stoppedDelegatorsPool -= totalMigratedAmount;
        _validatorInfo[sender].stoppedDelegatedAmount -= totalMigratedAmount;
        totalDelegatorsPool += totalMigratedAmount;
        _validatorInfo[sender].delegatedAmount += totalMigratedAmount;

        emit ValidatorRevived(sender);
    }

    /// @notice exit the stop list as delegator (increase your deposit, if necessary)
    function reviveAsDelegator() external payable nonReentrant {
        address sender = _msgSender();
        require(
            isDelegator(sender) &&
                _delegatorInfo[sender].amount + msg.value >=
                settings.delegatorsSettings.minimumThreshold &&
                _delegatorInfo[sender].calledForWithdraw > 0 &&
                _validatorInfo[_delegatorInfo[sender].validator]
                    .calledForWithdraw ==
                0,
            "CratD2CStakeManager: can not revive"
        );

        stoppedDelegatorsPool -= _delegatorInfo[sender].amount;
        _validatorInfo[_delegatorInfo[sender].validator]
            .stoppedDelegatedAmount -= _delegatorInfo[sender].amount;
        _delegatorInfo[sender].amount += msg.value;
        _validatorInfo[_delegatorInfo[sender].validator]
            .delegatedAmount += _delegatorInfo[sender].amount;
        totalDelegatorsPool += _delegatorInfo[sender].amount;
        _delegatorInfo[sender].fixedReward.lastUpdate = block.timestamp;
        _delegatorInfo[sender].fixedReward.apr = settings
            .delegatorsSettings
            .apr;
        delete _delegatorInfo[sender].calledForWithdraw;

        emit DelegatorRevived(sender);
    }

    // view methods

    /** @notice view-method to get validator's earned amounts
     * @param validator address
     * @return fixedReward amount (apr)
     * @return variableReward amount (from distributor)
     */
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
        variableReward = _validatorInfo[validator]
            .variableReward
            .variableReward;
    }

    /** @notice view-method to get delegators's earned amounts
     * @param delegator address
     * @return fixedReward amount (apr)
     * @return variableReward amount (from distributed to validator)
     */
    function delegatorEarned(
        address delegator
    ) public view returns (uint256 fixedReward, uint256 variableReward) {
        fixedReward =
            _delegatorInfo[delegator].fixedReward.fixedReward +
            (_delegatorInfo[delegator].amount *
                (_rightBoarder(delegator, false) -
                    _delegatorInfo[delegator].fixedReward.lastUpdate) *
                _delegatorInfo[delegator].fixedReward.apr) /
            (YEAR_DURATION * PRECISION);
        variableReward =
            _delegatorInfo[delegator]
                .variableReward
                .variableReward
                .variableReward +
            ((_validatorInfo[_delegatorInfo[delegator].validator]
                .delegatorsAcc -
                _delegatorInfo[delegator].variableReward.storedAcc) *
                _delegatorInfo[delegator].amount) /
            _ACCURACY;
    }

    /** @notice view-method to get account status
     * @param account address
     * @return true - if the account is a validator (even if stop-listed), else - false
     */
    function isValidator(address account) public view returns (bool) {
        return (_validators.contains(account) ||
            _stopListValidators.contains(account));
    }

    /** @notice view-method to get account status
     * @param account address
     * @return true - if the account is a delegator (even if stop-listed), else - false
     */
    function isDelegator(address account) public view returns (bool) {
        return _delegatorInfo[account].validator != address(0) ? true : false;
    }

    /** @notice view-method to get the list of all active validators and their deposited/voted amounts
     * @return validators an array of the active validators addresses
     * @return amounts an array of following uint256[3] arrays - [validators deposit, delegated amount for this validator (from active delegators), delegated amount for this validator (from stop-listed delegators)]
     */
    function getActiveValidators()
        external
        view
        returns (address[] memory validators, uint256[3][] memory amounts)
    {
        validators = _validators.values();
        amounts = new uint256[3][](validators.length);

        for (uint256 i; i < validators.length; i++) {
            amounts[i][0] = _validatorInfo[validators[i]].amount;
            amounts[i][1] = _validatorInfo[validators[i]].delegatedAmount;
            amounts[i][2] = _validatorInfo[validators[i]]
                .stoppedDelegatedAmount;
        }
    }

    /** @notice view-method to get the list of all stop-listed validators and their deposited/voted amounts
     * @return validators an array of the active validators addresses
     * @return amounts an array of following uint256[3] arrays - [validators deposit, delegated amount for this validator (from active delegators), delegated amount for this validator (from stop-listed delegators)]
     */
    function getStoppedValidators()
        external
        view
        returns (address[] memory validators, uint256[3][] memory amounts)
    {
        validators = _stopListValidators.values();
        amounts = new uint256[3][](validators.length);

        for (uint256 i; i < validators.length; i++) {
            amounts[i][0] = _validatorInfo[validators[i]].amount;
            amounts[i][1] = _validatorInfo[validators[i]].delegatedAmount;
            amounts[i][2] = _validatorInfo[validators[i]]
                .stoppedDelegatedAmount;
        }
    }

    /** @notice view-method to get validator info
     * @param validator address
     * @return amount of validator's deposit
     * @return commission percent that validator gives to its delegators
     * @return lastClaim previous claim timestamp
     * @return calledForWithdraw timestamp of #callForWithdrawAsValidator transaction (0 - if validator is active)
     * @return vestingEnd timestamp of the vesting funds process end
     * @return fixedReward struct with [apr - APR percent, lastUpdate - timestamp of last reward calculation, fixedReward - already calculated fixed reward] fields
     * @return variableReward calculated variable reward amount
     * @return delegatedAmount sum of active delegators deposits
     * @return stoppedDelegatedAmount sum of stopped delegators deposits
     * @return delegatorsAcc variable reward accumulator value for delegators
     * @return delegators an array of delegators' addresses list (even if someone is stopped)
     */
    function getValidatorInfo(
        address validator
    )
        external
        view
        returns (
            uint256 amount,
            uint256 commission,
            uint256 lastClaim,
            uint256 calledForWithdraw,
            uint256 vestingEnd,
            FixedReward memory fixedReward,
            VariableReward memory variableReward,
            uint256 delegatedAmount,
            uint256 stoppedDelegatedAmount,
            uint256 delegatorsAcc,
            address[] memory delegators
        )
    {
        amount = _validatorInfo[validator].amount;
        commission = _validatorInfo[validator].commission;
        lastClaim = _validatorInfo[validator].lastClaim;
        calledForWithdraw = _validatorInfo[validator].calledForWithdraw;
        vestingEnd = _validatorInfo[validator].vestingEnd;
        fixedReward = _validatorInfo[validator].fixedReward;
        variableReward = _validatorInfo[validator].variableReward;
        delegatedAmount = _validatorInfo[validator].delegatedAmount;
        stoppedDelegatedAmount = _validatorInfo[validator]
            .stoppedDelegatedAmount;
        delegatorsAcc = _validatorInfo[validator].delegatorsAcc;
        delegators = _validatorInfo[validator].delegators.values();
    }

    /** view-method to get delegator info
     * @param delegator address
     * @return :
     * validator address
     * deposited amount
     * previous claim timestamp
     * timestamp of #callForWithdrawAsDelegator transaction (0 - if validator is active)
     * struct with [apr - APR percent, lastUpdate - timestamp of last reward calculation, fixedReward - already calculated fixed reward] fields
     * struct with [storedAcc - last updated variable reward accumulator, variableReward - already calculated variable reward]
     */
    function getDelegatorInfo(
        address delegator
    ) external view returns (DelegatorInfo memory) {
        return _delegatorInfo[delegator];
    }

    /** view-method to approximately calculate total distributed rewards for validators
     * @return fixedReward total distributed
     * @return variableReward total distributed
     */
    function totalValidatorsRewards()
        external
        view
        returns (uint256 fixedReward, uint256 variableReward)
    {
        variableReward = _totalValidatorsRewards.variableReward;
        fixedReward = _fixedValidatorsReward();
    }

    /** view-method to approximately calculate total distributed rewards for delegators
     * @return fixedReward total distributed
     * @return variableReward total distributed
     */
    function totalDelegatorsRewards()
        external
        view
        returns (uint256 fixedReward, uint256 variableReward)
    {
        variableReward = _totalDelegatorsRewards.variableReward;
        fixedReward = _fixedDelegatorsReward();
    }

    /** view-method to exactly calculate total distributed rewards for current validator
     * @param validator address
     * @return fixedReward total distributed
     * @return variableReward total distributed
     */
    function totalValidatorReward(
        address validator
    ) external view returns (uint256 fixedReward, uint256 variableReward) {
        (fixedReward, variableReward) = validatorEarned(validator);
        fixedReward += _validatorInfo[validator].fixedReward.totalClaimed;
        variableReward += _validatorInfo[validator].variableReward.totalClaimed;
    }

    /** view-method to exactly calculate total distributed rewards for current delegator
     * @param delegator address
     * @return fixedReward total distributed
     * @return variableReward total distributed
     */
    function totalDelegatorReward(
        address delegator
    ) external view returns (uint256 fixedReward, uint256 variableReward) {
        (fixedReward, variableReward) = delegatorEarned(delegator);
        fixedReward += _delegatorInfo[delegator].fixedReward.totalClaimed;
        variableReward += _delegatorInfo[delegator]
            .variableReward
            .variableReward
            .totalClaimed;
    }

    // internal methods

    function _updateValidatorReward(address validator) internal {
        _updateFixedValidatorsReward();

        // store fixed reward
        (_validatorInfo[validator].fixedReward.fixedReward, ) = validatorEarned(
            validator
        );
        _validatorInfo[validator].fixedReward.lastUpdate = _rightBoarder(
            validator,
            true
        );
        _validatorInfo[validator].fixedReward.apr = settings
            .validatorsSettings
            .apr; // change each _update call (to keep it actual)
    }

    function _updateDelegatorReward(address delegator) internal {
        _updateFixedDelegatorsReward();

        // store fixed & variable rewards
        (
            _delegatorInfo[delegator].fixedReward.fixedReward,
            _delegatorInfo[delegator]
                .variableReward
                .variableReward
                .variableReward
        ) = delegatorEarned(delegator);
        _delegatorInfo[delegator].fixedReward.lastUpdate = _rightBoarder(
            delegator,
            false
        );
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
        require(
            _validatorInfo[validator].calledForWithdraw == 0,
            "CratD2CStakeManager: in stop list"
        );

        // update rewards
        _updateValidatorReward(validator);

        if (!_validators.contains(validator)) {
            require(
                commission <= PRECISION,
                "CratD2CStakeManager: too high commission"
            );

            _validatorInfo[validator].commission = commission; // do not allow change commission value once validator has been registered
            _validatorInfo[validator].lastClaim = block.timestamp; // to keep unboarding period
            _validators.add(validator);
        }
        _validatorInfo[validator].amount += amount;
        totalValidatorsPool += amount;

        emit ValidatorDeposited(
            validator,
            amount,
            _validatorInfo[validator].commission
        );
    }

    function _depositAsDelegator(
        address delegator,
        uint256 amount,
        address validator
    ) internal {
        require(
            _delegatorInfo[delegator].calledForWithdraw == 0,
            "CratD2CStakeManager: in stop list"
        );

        if (!isDelegator(delegator)) {
            _delegatorInfo[delegator].validator = validator;
            _delegatorInfo[delegator].lastClaim = block.timestamp; // to keep unboarding period
            _validatorInfo[validator].delegators.add(delegator);
        } else {
            validator = _delegatorInfo[delegator].validator;
        }

        require(
            _validators.contains(validator),
            "CratD2CStakeManager: wrong validator"
        ); // necessary to choose only active validator (even if validator choosen before)

        // update delegator rewards before amount will be changed
        _updateDelegatorReward(delegator);

        _delegatorInfo[delegator].amount += amount;
        _validatorInfo[validator].delegatedAmount += amount;
        totalDelegatorsPool += amount;

        emit DelegatorDeposited(delegator, validator, amount);
    }

    function _claimAsValidator(
        address validator
    ) internal returns (uint256 toClaim) {
        _updateValidatorReward(validator);

        toClaim = _validatorInfo[validator].fixedReward.fixedReward;

        require(
            forFixedReward >= toClaim,
            "CratD2CStakeManager: not enough coins for fixed rewards"
        );

        forFixedReward -= toClaim;
        _validatorInfo[validator].fixedReward.totalClaimed += toClaim;
        toClaim += _validatorInfo[validator].variableReward.variableReward;
        _validatorInfo[validator].variableReward.totalClaimed += _validatorInfo[
            validator
        ].variableReward.variableReward;

        if (toClaim > 0) {
            require(
                _validatorInfo[validator].lastClaim +
                    settings.validatorsSettings.claimCooldown <=
                    block.timestamp,
                "CratD2CStakeManager: claim cooldown"
            );

            _validatorInfo[validator].lastClaim = block.timestamp;
            delete _validatorInfo[validator].fixedReward.fixedReward;
            delete _validatorInfo[validator].variableReward.variableReward;
        }

        emit ValidatorClaimed(validator, toClaim);
    }

    function _claimAsDelegator(
        address delegator
    ) internal returns (uint256 toClaim) {
        _updateDelegatorReward(delegator);

        toClaim = _delegatorInfo[delegator].fixedReward.fixedReward;

        require(
            forFixedReward >= toClaim,
            "CratD2CStakeManager: not enough coins for fixed rewards"
        );

        forFixedReward -= toClaim;
        _delegatorInfo[delegator].fixedReward.totalClaimed += toClaim;
        toClaim += _delegatorInfo[delegator]
            .variableReward
            .variableReward
            .variableReward;
        _delegatorInfo[delegator]
            .variableReward
            .variableReward
            .totalClaimed += _delegatorInfo[delegator]
            .variableReward
            .variableReward
            .variableReward;

        if (toClaim > 0) {
            require(
                _delegatorInfo[delegator].lastClaim +
                    settings.delegatorsSettings.claimCooldown <=
                    block.timestamp,
                "CratD2CStakeManager: claim cooldown"
            );
            _delegatorInfo[delegator].lastClaim = block.timestamp;
            delete _delegatorInfo[delegator].fixedReward.fixedReward;
            delete _delegatorInfo[delegator]
                .variableReward
                .variableReward
                .variableReward;
        }

        emit DelegatorClaimed(delegator, toClaim);
    }

    function _validatorCallForWithdraw(address sender) internal {
        _updateValidatorReward(sender);

        _validatorInfo[sender].calledForWithdraw = block.timestamp;
        _validators.remove(sender);
        _stopListValidators.add(sender);

        totalValidatorsPool -= _validatorInfo[sender].amount;
        totalDelegatorsPool -= _validatorInfo[sender].delegatedAmount;
        stoppedValidatorsPool += _validatorInfo[sender].amount;
        stoppedDelegatorsPool += _validatorInfo[sender].delegatedAmount;

        _validatorInfo[sender].stoppedDelegatedAmount += _validatorInfo[sender]
            .delegatedAmount;
        delete _validatorInfo[sender].delegatedAmount;

        emit ValidatorCalledForWithdraw(sender);
    }

    function _delegatorCallForWithdraw(address sender) internal {
        _updateDelegatorReward(sender);

        _delegatorInfo[sender].calledForWithdraw = block.timestamp;

        address validator = _delegatorInfo[sender].validator;
        if (_validatorInfo[validator].calledForWithdraw == 0) {
            totalDelegatorsPool -= _delegatorInfo[sender].amount;
            stoppedDelegatorsPool += _delegatorInfo[sender].amount;
            _validatorInfo[validator].delegatedAmount -= _delegatorInfo[sender]
                .amount;
            _validatorInfo[validator].stoppedDelegatedAmount += _delegatorInfo[
                sender
            ].amount;
        }

        emit DelegatorCalledForWithdraw(sender);
    }

    function _updateFixedValidatorsReward() internal {
        if (_totalValidatorsRewards.fixedLastUpdate < block.timestamp) {
            _totalValidatorsRewards.fixedReward = _fixedValidatorsReward();
            _totalValidatorsRewards.fixedLastUpdate = block.timestamp;
        }
    }

    function _updateFixedDelegatorsReward() internal {
        if (_totalDelegatorsRewards.fixedLastUpdate < block.timestamp) {
            _totalDelegatorsRewards.fixedReward = _fixedDelegatorsReward();
            _totalDelegatorsRewards.fixedLastUpdate = block.timestamp;
        }
    }

    function _safeTransferETH(address _to, uint256 _value) internal {
        (bool success, ) = _to.call{value: _value}(new bytes(0));
        require(success, "CratD2CStakeManager: native transfer failed");
    }

    // internal view methods

    function _rightBoarder(
        address account,
        bool isValidator_
    ) internal view returns (uint256) {
        if (isValidator_)
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

    function _fixedValidatorsReward() internal view returns (uint256) {
        return
            _totalValidatorsRewards.fixedReward +
            ((block.timestamp - _totalValidatorsRewards.fixedLastUpdate) *
                totalValidatorsPool *
                settings.validatorsSettings.apr) /
            (PRECISION * YEAR_DURATION);
    }

    function _fixedDelegatorsReward() internal view returns (uint256) {
        return
            _totalDelegatorsRewards.fixedReward +
            ((block.timestamp - _totalDelegatorsRewards.fixedLastUpdate) *
                totalDelegatorsPool *
                settings.delegatorsSettings.apr) /
            (PRECISION * YEAR_DURATION);
    }
}
