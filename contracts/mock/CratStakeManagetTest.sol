// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

contract CRATStakeManagerTest is
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

    /// @notice sum of tokens available for validators/delegators to claim
    /// (increases due to the failed _safeTransferETH in withdraw methods)
    mapping(address => uint256) public unusualDepositor;

    uint256 public testTime;

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
        SlashPenaltyCalculation penalty;
        uint256 delegatedAmount;
        uint256 stoppedDelegatedAmount;
        uint256 delegatorsAcc;
        EnumerableSet.AddressSet delegators;
    }

    struct ValidatorInfoView {
        uint256 amount;
        uint256 commission;
        uint256 lastClaim;
        uint256 calledForWithdraw;
        uint256 vestingEnd;
        FixedReward fixedReward;
        VariableReward variableReward;
        SlashPenaltyCalculation penalty;
        uint256 delegatedAmount;
        uint256 stoppedDelegatedAmount;
        uint256 delegatorsAcc;
        address[] delegators;
        uint256 withdrawAvailable;
        uint256 claimAvailable;
    }

    struct DelegatorInfo {
        EnumerableSet.AddressSet validators;
        mapping(address => DelegatorPerValidatorInfo) delegatorPerValidator;
    }

    struct DelegatorPerValidatorInfo {
        uint256 amount;
        uint256 storedValidatorAcc;
        uint256 calledForWithdraw;
        uint256 lastClaim;
        FixedReward fixedReward;
        VariableReward variableReward;
    }

    struct FixedReward {
        uint256 apr;
        uint256 lastUpdate;
        uint256 fixedReward;
        uint256 totalClaimed;
    }

    struct VariableReward {
        uint256 variableReward;
        uint256 totalClaimed;
    }

    struct GeneralSettings {
        uint256 validatorsLimit;
        uint256 validatorsProbationPeriod;
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

    struct SlashPenaltyCalculation {
        uint256 lastSlash;
        uint256 potentialPenalty;
    }

    // users events
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
    event DelegatorClaimed(
        address delegator,
        address validator,
        uint256 amount
    );
    event DelegatorCalledForWithdraw(address delegator, address validator);
    event DelegatorRevived(address delegator, address validator);
    event DelegatorWithdrawed(address delegator, address validator);
    event TransferToDepositorFailed(address depositor, uint256 amount);
    event UnusualDepositorClaimed(
        address depositor,
        address receiver,
        uint256 amount
    );

    // admin methods events
    event SlashReceiverChanged(address receiver);
    event ValidatorsLimitChanged(uint256 limit);
    event ValidatorsWithdrawCooldownChanged(uint256 cooldown);
    event DelegatorsWithdrawCooldownChanged(uint256 cooldown);
    event ValidatorsClaimCooldownChanged(uint256 cooldown);
    event DelegatorsClaimCooldownChanged(uint256 cooldown);
    event ValidatorsMinDepositChanged(uint256 minDeposit);
    event DelegatorsMinDepositChanged(uint256 minDeposit);
    event ValidatorsToSlashValueChanged(uint256 value);
    event DelegatorsToSlashPercentChanged(uint256 perc);
    event ValidatorsAPRChanged(uint256 apr);
    event DelegatorsAPRChanged(uint256 apr);
    event ExcessFixedRewardWithdrawed(uint256 amount);
    event ValidatorsProbationPeriodChanged(uint256 value);

    // custom error codes
    error ZeroAddress();
    error DelegatorsLimit();
    error NativeTransferFailed();
    error WrongValidatorsLength();
    error WrongValue(uint256 value);
    error ValidatorsOnly(address account);
    error DelegatorsOnly(address account);
    error Cooldown(bool forClaim, uint256 upperBond);
    error InStoplistStatus(address account, bool stoplisted);

    receive() external payable {
        forFixedReward += msg.value;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _distributor,
        address _receiver
    ) public initializer {
        if (_receiver == address(0)) revert ZeroAddress();

        __AccessControl_init();
        __ReentrancyGuard_init();

        settings = GeneralSettings(
            101,
            90 days,
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

        testTime = block.timestamp;

        _totalValidatorsRewards.fixedLastUpdate = testTime;
        _totalDelegatorsRewards.fixedLastUpdate = testTime;
    }

    function changeTestTime(uint256 value) public {
        require(value > testTime);
        testTime = value;
    }

    // admin methods

    /** @notice change slash receiver address
     * @param receiver new slash receiver address
     * @dev only admin
     */
    function setSlashReceiver(
        address receiver
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (receiver == address(0)) revert ZeroAddress();
        settings.slashReceiver = receiver;
        emit SlashReceiverChanged(receiver);
    }

    /** @notice change validators limit
     * @param value new validators limit
     * @dev only admin
     */
    function setValidatorsLimit(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (value < _validators.length()) revert WrongValidatorsLength();
        settings.validatorsLimit = value;
        emit ValidatorsLimitChanged(value);
    }

    /** @notice change validators' withdraw cooldown
     * @param value new time peroid duration
     * @dev only admin
     */
    function setValidatorsWithdrawCooldown(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _cooldownCheck(value);
        settings.validatorsSettings.withdrawCooldown = value;
        emit ValidatorsWithdrawCooldownChanged(value);
    }

    /** @notice change delegators' withdraw cooldown
     * @param value new time peroid duration
     * @dev only admin
     */
    function setDelegatorsWithdrawCooldown(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _cooldownCheck(value);
        settings.delegatorsSettings.withdrawCooldown = value;
        emit DelegatorsWithdrawCooldownChanged(value);
    }

    /** @notice change validators' minimum amount to deposit
     * @param value new minimum amount
     * @dev only admin
     */
    function setValidatorsMinimum(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settings.validatorsSettings.minimumThreshold = value;
        emit ValidatorsMinDepositChanged(value);
    }

    /** @notice change delegators' minimum amount to deposit
     * @param value new minimum amount
     * @dev only admin
     */
    function setDelegatorsMinimum(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settings.delegatorsSettings.minimumThreshold = value;
        emit DelegatorsMinDepositChanged(value);
    }

    /** @notice change validators' token amount to slash (to substract from their deposit)
     * @param value new slash token amount
     * @dev only admin
     */
    function setValidatorsAmountToSlash(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settings.validatorsSettings.toSlash = value;
        emit ValidatorsToSlashValueChanged(value);
    }

    /** @notice change delegators' percent to slash (to substract that percent of their deposit)
     * @param value new slash percent of the deposit
     * @dev only admin
     */
    function setDelegatorsPercToSlash(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (value > PRECISION) revert WrongValue(value);
        settings.delegatorsSettings.toSlash = value;
        emit DelegatorsToSlashPercentChanged(value);
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
        emit ValidatorsAPRChanged(value);
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
        emit DelegatorsAPRChanged(value);
    }

    /** @notice change validators' claim cooldown
     * @param value new time peroid duration
     * @dev only admin
     */
    function setValidatorsClaimCooldown(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _cooldownCheck(value);
        settings.validatorsSettings.claimCooldown = value;
        emit ValidatorsClaimCooldownChanged(value);
    }

    /** @notice change delegators' claim cooldown
     * @param value new time peroid duration
     * @dev only admin
     */
    function setDelegatorsClaimCooldown(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _cooldownCheck(value);
        settings.delegatorsSettings.claimCooldown = value;
        emit DelegatorsClaimCooldownChanged(value);
    }

    /** @notice withdraw excess reward coins from {forFixedReward} pool
     * @param amount token amount
     * @dev only admin
     */
    function withdrawExcessFixedReward(
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (forFixedReward < amount) revert WrongValue(amount);
        forFixedReward -= amount;
        _safeTransferETH(_msgSender(), amount, false);
        emit ExcessFixedRewardWithdrawed(amount);
    }

    /** @notice change validators' probation period - duration in seconds between two slashing events;
     * if second slashing happens earlier that probation period passed, validator loses his APR rewards
     * @param value new minimum amount
     * @dev only admin
     */
    function setValidatorsProbationPeriod(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        settings.validatorsProbationPeriod = value;
        emit ValidatorsProbationPeriodChanged(value);
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
        if (len == 0 || amounts.length != len) revert WrongValidatorsLength();

        uint256 totalReward;
        uint256 totalValidatorsReward;
        uint256 totalDelegatorsReward;
        uint256 forDelegators;

        for (uint256 i; i < len; ++i) {
            if (isValidator(validators[i]) && amounts[i] > 0) {
                if (
                    _validatorInfo[validators[i]].delegatedAmount +
                        _validatorInfo[validators[i]].stoppedDelegatedAmount >
                    0
                ) {
                    forDelegators =
                        (amounts[i] *
                            (PRECISION -
                                _validatorInfo[validators[i]].commission)) /
                        PRECISION;
                    _validatorInfo[validators[i]].delegatorsAcc +=
                        (forDelegators * _ACCURACY) /
                        (_validatorInfo[validators[i]].delegatedAmount +
                            _validatorInfo[validators[i]]
                                .stoppedDelegatedAmount);
                    totalDelegatorsReward += forDelegators;
                }
                _validatorInfo[validators[i]].variableReward.variableReward +=
                    amounts[i] -
                    forDelegators;
                totalValidatorsReward += amounts[i] - forDelegators;

                delete forDelegators;
            }
        }

        totalReward = totalDelegatorsReward + totalValidatorsReward;

        if (msg.value < totalReward) revert WrongValue(msg.value);

        _totalValidatorsRewards.variableReward += totalValidatorsReward;
        _totalDelegatorsRewards.variableReward += totalDelegatorsReward;

        if (msg.value > totalReward)
            _safeTransferETH(_msgSender(), msg.value - totalReward, false); // send excess coins back
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
        address[] memory delegators;
        uint256 total;
        uint256 currentTime = block.timestamp;
        for (uint256 i; i < len; ++i) {
            if (isValidator(validators[i])) {
                _updateValidatorReward(validators[i]);

                fee = settings.validatorsSettings.toSlash;
                if (
                    _validatorInfo[validators[i]].penalty.lastSlash +
                        settings.validatorsProbationPeriod >
                    currentTime
                ) fee += _validatorInfo[validators[i]].penalty.potentialPenalty;
                fee = _validatorInfo[validators[i]].amount > fee
                    ? fee
                    : _validatorInfo[validators[i]].amount;

                _validatorInfo[validators[i]].amount -= fee;
                delete _validatorInfo[validators[i]].penalty.potentialPenalty;
                _validatorInfo[validators[i]].penalty.lastSlash = currentTime;
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
                    totalValidatorsPool -= fee;

                    // for validator
                    if (
                        _validatorInfo[validators[i]].amount <
                        settings.validatorsSettings.minimumThreshold
                    ) {
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
                    }
                }

                for (uint256 j; j < delegators.length; ++j) {
                    _updateDelegatorRewardPerValidator(
                        delegators[j],
                        validators[i]
                    );
                    _delegatorInfo[delegators[j]]
                        .delegatorPerValidator[validators[i]]
                        .amount -=
                        (_delegatorInfo[delegators[j]]
                            .delegatorPerValidator[validators[i]]
                            .amount * delegatorsPerc) /
                        PRECISION;

                    if (
                        _delegatorInfo[delegators[j]]
                            .delegatorPerValidator[validators[i]]
                            .amount <
                        settings.delegatorsSettings.minimumThreshold &&
                        _delegatorInfo[delegators[j]]
                            .delegatorPerValidator[validators[i]]
                            .calledForWithdraw ==
                        0
                    ) {
                        _delegatorCallForWithdraw(delegators[j], validators[i]);
                    }
                }

                delete fee;
                delete delegators;
            }
        }

        if (total > 0) _safeTransferETH(settings.slashReceiver, total, false);
    }

    // swap contract methods

    /** @notice make deposit for exact user as validator
     * @param sender address of future validator
     * @param commission percent that this validator will take from variable rewards
     * @param vestingEnd timestamp of the vesting funds process end
     * @dev swap role only
     */
    function depositForValidator(
        address sender,
        uint256 commission,
        uint256 vestingEnd
    ) external payable onlyRole(SWAP_ROLE) nonReentrant {
        if (sender == address(0)) revert ZeroAddress();
        if (
            vestingEnd <= testTime ||
            _validatorInfo[sender].vestingEnd > vestingEnd
        ) revert WrongValue(vestingEnd);

        _validatorInfo[sender].vestingEnd = vestingEnd;

        uint256 amount = msg.value;

        if (
            amount == 0 ||
            amount + _validatorInfo[sender].amount <
            settings.validatorsSettings.minimumThreshold
        ) revert WrongValue(amount);
        if (!_validators.contains(sender))
            if (_validators.length() >= settings.validatorsLimit)
                revert WrongValidatorsLength();

        if (isDelegator(sender)) revert ValidatorsOnly(sender);

        _depositAsValidator(sender, amount, commission);
    }

    // public methods

    /** @notice make deposit as validator
     * @param commission percent that this validator will take from variable rewards
     */
    function depositAsValidator(
        uint256 commission
    ) external payable nonReentrant {
        uint256 amount = msg.value;
        address sender = _msgSender();

        if (
            amount == 0 ||
            amount + _validatorInfo[sender].amount <
            settings.validatorsSettings.minimumThreshold
        ) revert WrongValue(amount);
        if (!_validators.contains(sender))
            if (_validators.length() >= settings.validatorsLimit)
                revert WrongValidatorsLength();

        if (isDelegator(sender)) revert ValidatorsOnly(sender);

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

        if (isValidator(sender)) revert DelegatorsOnly(sender);
        if (
            amount == 0 ||
            amount +
                _delegatorInfo[sender].delegatorPerValidator[validator].amount <
            settings.delegatorsSettings.minimumThreshold
        ) revert WrongValue(amount);

        _depositAsDelegator(sender, amount, validator);
    }

    /** @notice claim rewards as validator
     */
    function claimAsValidator() external nonReentrant {
        address sender = _msgSender();
        if (
            !isValidator(sender) &&
            _validatorInfo[sender].fixedReward.fixedReward == 0
        ) revert ValidatorsOnly(sender);
        uint256 reward = _claimAsValidator(sender);
        if (reward > 0) _safeTransferETH(sender, reward, false);
    }

    /** @notice claim rewards as delegator (earned for certain validators deposit)
     * @param validator certain validator address
     */
    function claimAsDelegatorPerValidator(
        address validator
    ) external nonReentrant {
        address sender = _msgSender();
        if (
            !_delegatorInfo[sender].validators.contains(validator) &&
            _delegatorInfo[sender]
                .delegatorPerValidator[validator]
                .fixedReward
                .fixedReward ==
            0
        ) revert ValidatorsOnly(validator);
        uint256 reward = _claimAsDelegatorPerValidator(sender, validator, true);
        if (reward > 0) _safeTransferETH(sender, reward, false);
    }

    /** @notice restake rewards as validator
     */
    function restakeAsValidator() external nonReentrant {
        address sender = _msgSender();
        if (!isValidator(sender)) revert ValidatorsOnly(sender);
        uint256 reward = _claimAsValidator(sender);
        if (reward == 0) revert WrongValue(reward);
        _depositAsValidator(sender, reward, 0); // not set zero commission, but keeps previous value
    }

    /** @notice restake rewards as delegator (earned for certain validators deposit)
     * @param validator certain validator address
     */
    function restakeAsDelegator(address validator) external nonReentrant {
        address sender = _msgSender();
        if (!_delegatorInfo[sender].validators.contains(validator))
            revert DelegatorsOnly(sender);
        uint256 reward = _claimAsDelegatorPerValidator(sender, validator, true);
        if (reward == 0) revert WrongValue(reward);
        _depositAsDelegator(sender, reward, validator);
    }

    /// @notice sign up to a stop list as validator (will be able to withdraw deposit after cooldown)
    function validatorCallForWithdraw() external nonReentrant {
        address sender = _msgSender();
        if (!isValidator(sender)) revert ValidatorsOnly(sender);
        if (_validatorInfo[sender].calledForWithdraw > 0)
            revert InStoplistStatus(sender, true);

        _validatorCallForWithdraw(sender);
    }

    /// @notice sign up to a stop list as delegator (will be able to withdraw deposit after cooldown) for certain validator
    /// @param validator address
    function delegatorCallForWithdraw(address validator) external nonReentrant {
        address sender = _msgSender();
        if (!isDelegator(sender)) revert DelegatorsOnly(sender);
        if (!_delegatorInfo[sender].validators.contains(validator))
            revert ValidatorsOnly(validator);
        if (
            _delegatorInfo[sender]
                .delegatorPerValidator[validator]
                .calledForWithdraw > 0
        ) revert InStoplistStatus(sender, true);

        _delegatorCallForWithdraw(sender, validator);
    }

    /// @notice withdraw deposit as validator (after cooldown; removes all its delegators automatically)
    function withdrawAsValidator() external nonReentrant {
        _withdrawAsValidator(_msgSender());
    }

    /// @notice withdraw deposit as delegator (after cooldown) for certain validator
    /// @notice validator address
    function withdrawAsDelegator(address validator) external nonReentrant {
        _withdrawAsDelegator(_msgSender(), validator);
    }

    /// @notice withdraw deposit for current validator (after cooldown; removes all its delegators automatically)
    function withdrawForValidator(address validator) external nonReentrant {
        _withdrawAsValidator(validator);
    }

    /// @notice withdraw deposit for current delegator (after cooldown)
    function withdrawForDelegators(
        address validator,
        address[] calldata delegators
    ) external nonReentrant {
        for (uint256 i; i < delegators.length; i++) {
            _withdrawAsDelegator(delegators[i], validator);
        }
    }

    /// @notice exit the stop list as validator (increase your deposit, if necessary)
    function reviveAsValidator() external payable nonReentrant {
        address sender = _msgSender();
        if (!isValidator(sender)) revert ValidatorsOnly(sender);
        if (_validatorInfo[sender].calledForWithdraw == 0)
            revert InStoplistStatus(sender, false);
        if (
            _validatorInfo[sender].amount + msg.value <
            settings.validatorsSettings.minimumThreshold
        ) revert WrongValue(msg.value);
        if (_validators.length() >= settings.validatorsLimit)
            revert WrongValidatorsLength();

        // revive validator and his non-called for withdraw delegators
        _validatorInfo[sender].fixedReward.lastUpdate = testTime;
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
            _updateDelegatorRewardPerValidator(delegators[i], sender);
            if (
                _delegatorInfo[delegators[i]]
                    .delegatorPerValidator[sender]
                    .calledForWithdraw == 0
            ) {
                _delegatorInfo[delegators[i]]
                    .delegatorPerValidator[sender]
                    .fixedReward
                    .lastUpdate = testTime;
                totalMigratedAmount += _delegatorInfo[delegators[i]]
                    .delegatorPerValidator[sender]
                    .amount;
            } else {
                _delegatorInfo[delegators[i]]
                    .delegatorPerValidator[sender]
                    .fixedReward
                    .lastUpdate = _delegatorInfo[delegators[i]]
                    .delegatorPerValidator[sender]
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

    /// @notice exit the stop list as delegator (increase your deposit, if necessary) for certain validator
    /// @param validator address
    function reviveAsDelegator(
        address validator
    ) external payable nonReentrant {
        address sender = _msgSender();
        DelegatorPerValidatorInfo storage info = _delegatorInfo[sender]
            .delegatorPerValidator[validator];

        if (!isDelegator(sender)) revert DelegatorsOnly(sender);
        if (
            info.amount + msg.value <
            settings.delegatorsSettings.minimumThreshold
        ) revert WrongValue(msg.value);
        if (info.calledForWithdraw == 0) revert InStoplistStatus(sender, false);
        if (_validatorInfo[validator].calledForWithdraw > 0)
            revert InStoplistStatus(validator, true);

        stoppedDelegatorsPool -= info.amount;
        _validatorInfo[validator].stoppedDelegatedAmount -= _delegatorInfo[
            sender
        ].delegatorPerValidator[validator].amount;
        info.amount += msg.value;
        _validatorInfo[validator].delegatedAmount += info.amount;
        totalDelegatorsPool += info.amount;
        info.fixedReward.lastUpdate = testTime;
        info.fixedReward.apr = settings.delegatorsSettings.apr;
        delete info.calledForWithdraw;

        emit DelegatorRevived(sender, validator);
    }

    /// @notice claim native coins that appeared as a result of a failed transfer (in withdraw methods)
    /// @param to funds receiver
    function claimAsUnusualDepositor(address to) external nonReentrant {
        address sender = _msgSender();
        uint256 amount = unusualDepositor[sender];
        if (amount > 0) {
            delete unusualDepositor[sender];
            _safeTransferETH(to, amount, false);
            emit UnusualDepositorClaimed(sender, to, amount);
        }
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
            _fixedRewardToAdd(validator);
        variableReward = _validatorInfo[validator]
            .variableReward
            .variableReward;
    }

    /** @notice view-method to get delegators's earned amounts per validator
     * @param delegator address
     * @param validator address
     * @return fixedReward amount (apr)
     * @return variableReward amount (from distributed to validator)
     */
    function delegatorEarnedPerValidator(
        address delegator,
        address validator
    ) external view returns (uint256 fixedReward, uint256 variableReward) {
        (fixedReward, variableReward) = _delegatorEarnedPerValidator(
            delegator,
            validator
        );
    }

    /** @notice view-method to get delegators's earned amounts for several validators
     * @param delegator address
     * @param validatorsArr validators addresses
     * @return fixedRewards earned array
     * @return variableRewards earned array
     */
    function delegatorEarnedPerValidators(
        address delegator,
        address[] calldata validatorsArr
    )
        external
        view
        returns (
            uint256[] memory fixedRewards,
            uint256[] memory variableRewards
        )
    {
        uint256 len = validatorsArr.length;
        fixedRewards = new uint256[](len);
        variableRewards = new uint256[](len);

        for (uint256 i; i < len; i++) {
            (
                fixedRewards[i],
                variableRewards[i]
            ) = _delegatorEarnedPerValidator(delegator, validatorsArr[i]);
        }
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
        return _delegatorInfo[account].validators.length() > 0 ? true : false;
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
     * @return info validator info:
     * amount of validator's deposit
     * commission percent that validator takes from its delegators
     * lastClaim previous claim timestamp
     * calledForWithdraw timestamp of #callForWithdrawAsValidator transaction (0 - if validator is active)
     * vestingEnd timestamp of the vesting funds process end
     * fixedReward struct with [apr - APR percent, lastUpdate - timestamp of last reward calculation, fixedReward - already calculated fixed reward] fields
     * variableReward calculated variable reward amount
     * penalty info for potential additional slashing penalty calculation
     * delegatedAmount sum of active delegators deposits
     * stoppedDelegatedAmount sum of stopped delegators deposits
     * delegatorsAcc variable reward accumulator value for delegators
     * delegators an array of delegators' addresses list (even if someone is stopped)
     * withdrawAvailable timestamp since validator is able to withdraw
     * claimAvailable timestamp since validator is able to claim
     */
    function getValidatorInfo(
        address validator
    ) external view returns (ValidatorInfoView memory info) {
        info.amount = _validatorInfo[validator].amount;
        info.commission = _validatorInfo[validator].commission;
        info.lastClaim = _validatorInfo[validator].lastClaim;
        info.calledForWithdraw = _validatorInfo[validator].calledForWithdraw;
        info.vestingEnd = _validatorInfo[validator].vestingEnd;
        info.fixedReward = _validatorInfo[validator].fixedReward;
        info.variableReward = _validatorInfo[validator].variableReward;
        info.penalty = _validatorInfo[validator].penalty;
        info.delegatedAmount = _validatorInfo[validator].delegatedAmount;
        info.stoppedDelegatedAmount = _validatorInfo[validator]
            .stoppedDelegatedAmount;
        info.delegatorsAcc = _validatorInfo[validator].delegatorsAcc;
        info.delegators = _validatorInfo[validator].delegators.values();
        info.withdrawAvailable = (info.calledForWithdraw > 0)
            ? info.calledForWithdraw +
                settings.validatorsSettings.withdrawCooldown
            : 0;
        info.claimAvailable =
            info.lastClaim +
            settings.validatorsSettings.claimCooldown;
    }

    /** @notice view-method to get delegator info
     * @param delegator address
     * @return validatorsArr the list of validators
     * @return delegatorPerValidatorArr the list of info for all validators
     * @return withdrawAvailable timestamp since delegator is able to withdraw
     * @return claimAvailable timestamp since delegator is able to claim
     */
    function getDelegatorInfo(
        address delegator
    )
        external
        view
        returns (
            address[] memory validatorsArr,
            DelegatorPerValidatorInfo[] memory delegatorPerValidatorArr,
            uint256[] memory withdrawAvailable,
            uint256[] memory claimAvailable
        )
    {
        validatorsArr = _delegatorInfo[delegator].validators.values();
        uint256 len = validatorsArr.length;

        delegatorPerValidatorArr = new DelegatorPerValidatorInfo[](len);
        withdrawAvailable = new uint256[](len);
        claimAvailable = new uint256[](len);

        for (uint256 i; i < len; i++) {
            delegatorPerValidatorArr[i] = _delegatorInfo[delegator]
                .delegatorPerValidator[validatorsArr[i]];

            withdrawAvailable[i] = _getDelegatorCallForWithdraw(
                delegator,
                validatorsArr[i]
            );
            if (withdrawAvailable[i] > 0)
                withdrawAvailable[i] += settings
                    .delegatorsSettings
                    .withdrawCooldown;
            claimAvailable[i] =
                delegatorPerValidatorArr[i].lastClaim +
                settings.delegatorsSettings.claimCooldown;
        }
    }

    /** @notice view-method to get all delegators per certain validator infos
     * @param validator address
     * @return delegators addresses
     * @return delegatorPerValidatorArr the list of info for all delegators per certain validator
     */
    function getDelegatorsInfoPerValidator(
        address validator
    )
        external
        view
        returns (
            address[] memory delegators,
            DelegatorPerValidatorInfo[] memory delegatorPerValidatorArr
        )
    {
        delegators = _validatorInfo[validator].delegators.values();
        uint256 len = delegators.length;
        delegatorPerValidatorArr = new DelegatorPerValidatorInfo[](len);
        for (uint256 i; i < len; i++) {
            delegatorPerValidatorArr[i] = _delegatorInfo[delegators[i]]
                .delegatorPerValidator[validator];
        }
    }

    /** @notice view-method to approximately calculate total distributed rewards for validators
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

    /** view-method to exactly calculate total distributed rewards for current delegator and current validator
     * @param delegator address
     * @param validator address
     * @return fixedReward total distributed
     * @return variableReward total distributed
     */
    function totalDelegatorRewardPerValidator(
        address delegator,
        address validator
    ) external view returns (uint256 fixedReward, uint256 variableReward) {
        (fixedReward, variableReward) = _delegatorEarnedPerValidator(
            delegator,
            validator
        );
        fixedReward += _delegatorInfo[delegator]
            .delegatorPerValidator[validator]
            .fixedReward
            .totalClaimed;
        variableReward += _delegatorInfo[delegator]
            .delegatorPerValidator[validator]
            .variableReward
            .totalClaimed;
    }

    // internal methods

    function _delegatorEarnedPerValidator(
        address delegator,
        address validator
    ) internal view returns (uint256 fixedReward, uint256 variableReward) {
        DelegatorPerValidatorInfo memory info = _delegatorInfo[delegator]
            .delegatorPerValidator[validator];

        fixedReward = info.fixedReward.fixedReward;
        variableReward = info.variableReward.variableReward;
        if (info.amount > 0) {
            fixedReward +=
                (info.amount *
                    (_rightBoarderDPV(delegator, validator) -
                        info.fixedReward.lastUpdate) *
                    info.fixedReward.apr) /
                (YEAR_DURATION * PRECISION);
            variableReward +=
                ((_validatorInfo[validator].delegatorsAcc -
                    info.storedValidatorAcc) * info.amount) /
                _ACCURACY;
        }
    }

    function _updateValidatorReward(address validator) internal {
        _updateFixedValidatorsReward();

        // calculate potential penatly
        if (_validatorInfo[validator].penalty.lastSlash > 0) {
            _validatorInfo[validator]
                .penalty
                .potentialPenalty += _fixedRewardToAdd(validator);
        }

        // store fixed reward
        (_validatorInfo[validator].fixedReward.fixedReward, ) = validatorEarned(
            validator
        );
        _validatorInfo[validator].fixedReward.lastUpdate = _rightBoarderV(
            validator
        );
        _validatorInfo[validator].fixedReward.apr = settings
            .validatorsSettings
            .apr; // change each _update call (to keep it actual)
    }

    function _updateDelegatorRewardPerValidator(
        address delegator,
        address validator
    ) internal {
        _updateFixedDelegatorsReward();

        DelegatorPerValidatorInfo storage info = _delegatorInfo[delegator]
            .delegatorPerValidator[validator];

        // store fixed & variable rewards
        (
            info.fixedReward.fixedReward,
            info.variableReward.variableReward
        ) = _delegatorEarnedPerValidator(delegator, validator);

        info.fixedReward.lastUpdate = _rightBoarderDPV(delegator, validator);
        info.fixedReward.apr = settings.delegatorsSettings.apr; // change each _update call (to keep it actual)
        info.storedValidatorAcc = _validatorInfo[validator].delegatorsAcc;
    }

    function _depositAsValidator(
        address validator,
        uint256 amount,
        uint256 commission
    ) internal {
        if (_validatorInfo[validator].calledForWithdraw > 0)
            revert InStoplistStatus(validator, true);

        // update rewards
        _updateValidatorReward(validator);

        if (!_validators.contains(validator)) {
            if (commission > 30_00 || commission < 5_00)
                revert WrongValue(commission);

            _validatorInfo[validator].commission = commission; // do not allow change commission value once validator has been registered
            _validatorInfo[validator].lastClaim = testTime; // to keep unboarding period
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
        if (
            _delegatorInfo[delegator]
                .delegatorPerValidator[validator]
                .calledForWithdraw > 0
        ) revert InStoplistStatus(delegator, true);

        if (!_validators.contains(validator)) revert ValidatorsOnly(validator); // necessary to choose only active validator

        if (!_delegatorInfo[delegator].validators.contains(validator)) {
            if (_validatorInfo[validator].delegators.length() == 4800)
                revert DelegatorsLimit();
            _delegatorInfo[delegator].validators.add(validator);
            _validatorInfo[validator].delegators.add(delegator);
            _delegatorInfo[delegator]
                .delegatorPerValidator[validator]
                .lastClaim = testTime; // to keep unboarding period
        }

        // update delegator rewards before amount will be changed
        _updateDelegatorRewardPerValidator(delegator, validator);

        _delegatorInfo[delegator]
            .delegatorPerValidator[validator]
            .amount += amount;
        _validatorInfo[validator].delegatedAmount += amount;
        totalDelegatorsPool += amount;

        emit DelegatorDeposited(delegator, validator, amount);
    }

    function _claimAsValidator(
        address validator
    ) internal returns (uint256 toClaim) {
        _updateValidatorReward(validator);

        toClaim = _validatorInfo[validator].fixedReward.fixedReward;

        if (forFixedReward >= toClaim) {
            forFixedReward -= toClaim;
            _validatorInfo[validator].fixedReward.totalClaimed += toClaim;
            delete _validatorInfo[validator].fixedReward.fixedReward;
        } else delete toClaim;

        toClaim += _validatorInfo[validator].variableReward.variableReward;
        _validatorInfo[validator].variableReward.totalClaimed += _validatorInfo[
            validator
        ].variableReward.variableReward;
        delete _validatorInfo[validator].variableReward.variableReward;

        if (toClaim > 0) {
            if (
                _validatorInfo[validator].lastClaim +
                    settings.validatorsSettings.claimCooldown >
                testTime
            )
                revert Cooldown(
                    true,
                    _validatorInfo[validator].lastClaim +
                        settings.validatorsSettings.claimCooldown
                );

            if (_validatorInfo[validator].lastClaim > 0)
                _validatorInfo[validator].lastClaim = testTime;
        }

        emit ValidatorClaimed(validator, toClaim);
    }

    function _claimAsDelegatorPerValidator(
        address delegator,
        address validator,
        bool checkCooldown
    ) internal returns (uint256 toClaim) {
        _updateDelegatorRewardPerValidator(delegator, validator);

        DelegatorPerValidatorInfo storage info = _delegatorInfo[delegator]
            .delegatorPerValidator[validator];

        toClaim = info.fixedReward.fixedReward;

        if (forFixedReward >= toClaim) {
            forFixedReward -= toClaim;
            info.fixedReward.totalClaimed += toClaim;
            delete info.fixedReward.fixedReward;
        } else delete toClaim;

        uint256 varRew = info.variableReward.variableReward;

        toClaim += varRew;
        info.variableReward.totalClaimed += varRew;
        delete info.variableReward.variableReward;

        if (toClaim > 0 && checkCooldown) {
            if (
                info.lastClaim + settings.delegatorsSettings.claimCooldown >
                testTime
            )
                revert Cooldown(
                    true,
                    info.lastClaim + settings.delegatorsSettings.claimCooldown
                );
            if (info.lastClaim > 0) info.lastClaim = testTime;
        }

        emit DelegatorClaimed(delegator, validator, toClaim);
    }

    function _validatorCallForWithdraw(address sender) internal {
        _updateValidatorReward(sender);

        (uint256 amount, uint256 delegatedAmount) = (
            _validatorInfo[sender].amount,
            _validatorInfo[sender].delegatedAmount
        );

        _validatorInfo[sender].calledForWithdraw = testTime;
        _validators.remove(sender);
        _stopListValidators.add(sender);

        totalValidatorsPool -= amount;
        totalDelegatorsPool -= delegatedAmount;
        stoppedValidatorsPool += amount;
        stoppedDelegatorsPool += delegatedAmount;

        _validatorInfo[sender].stoppedDelegatedAmount += delegatedAmount;
        delete _validatorInfo[sender].delegatedAmount;

        emit ValidatorCalledForWithdraw(sender);
    }

    function _delegatorCallForWithdraw(
        address sender,
        address validator
    ) internal {
        _updateDelegatorRewardPerValidator(sender, validator);

        _delegatorInfo[sender]
            .delegatorPerValidator[validator]
            .calledForWithdraw = testTime;

        if (_validatorInfo[validator].calledForWithdraw == 0) {
            uint256 amount = _delegatorInfo[sender]
                .delegatorPerValidator[validator]
                .amount;
            totalDelegatorsPool -= amount;
            stoppedDelegatorsPool += amount;
            _validatorInfo[validator].delegatedAmount -= amount;
            _validatorInfo[validator].stoppedDelegatedAmount += amount;
        }

        emit DelegatorCalledForWithdraw(sender, validator);
    }

    function _withdrawAsValidator(address validator) internal {
        if (
            _validatorInfo[validator].calledForWithdraw +
                settings.validatorsSettings.withdrawCooldown >
            testTime ||
            _validatorInfo[validator].vestingEnd > testTime
        )
            revert Cooldown(
                false,
                _validatorInfo[validator].calledForWithdraw +
                    settings.validatorsSettings.withdrawCooldown >
                    _validatorInfo[validator].vestingEnd
                    ? _validatorInfo[validator].calledForWithdraw +
                        settings.validatorsSettings.withdrawCooldown
                    : _validatorInfo[validator].vestingEnd
            );
        if (_validatorInfo[validator].calledForWithdraw == 0)
            revert InStoplistStatus(validator, false);

        address[] memory delegators = _validatorInfo[validator]
            .delegators
            .values();
        uint256 amount;
        uint256 fixedRewardToStore;
        for (uint256 i; i < delegators.length; i++) {
            amount = _claimAsDelegatorPerValidator(
                delegators[i],
                validator,
                false
            );
            amount += _delegatorInfo[delegators[i]]
                .delegatorPerValidator[validator]
                .amount;
            _delegatorInfo[delegators[i]].validators.remove(validator);
            _validatorInfo[validator].delegators.remove(delegators[i]);
            fixedRewardToStore = _delegatorInfo[delegators[i]]
                .delegatorPerValidator[validator]
                .fixedReward
                .fixedReward;
            delete _delegatorInfo[delegators[i]].delegatorPerValidator[
                validator
            ];
            _delegatorInfo[delegators[i]]
                .delegatorPerValidator[validator]
                .fixedReward
                .fixedReward = fixedRewardToStore;
            delete fixedRewardToStore;
            _safeTransferETH(delegators[i], amount, true);

            emit DelegatorWithdrawed(delegators[i], validator);
        }

        uint256 validatorsAmount = _validatorInfo[validator].amount;

        amount = _claimAsValidator(validator);
        fixedRewardToStore = _validatorInfo[validator].fixedReward.fixedReward;
        amount += validatorsAmount;
        stoppedValidatorsPool -= validatorsAmount;
        stoppedDelegatorsPool -= _validatorInfo[validator]
            .stoppedDelegatedAmount;
        _stopListValidators.remove(validator);

        delete _validatorInfo[validator];
        _validatorInfo[validator].fixedReward.fixedReward = fixedRewardToStore;
        _safeTransferETH(validator, amount, true);

        emit ValidatorWithdrawed(validator);
    }

    function _withdrawAsDelegator(
        address delegator,
        address validator
    ) internal {
        uint256 calledForWithdraw = _getDelegatorCallForWithdraw(
            delegator,
            validator
        );
        if (calledForWithdraw == 0) revert InStoplistStatus(delegator, false);

        if (
            calledForWithdraw + settings.delegatorsSettings.withdrawCooldown >
            testTime
        )
            revert Cooldown(
                false,
                calledForWithdraw + settings.delegatorsSettings.withdrawCooldown
            );

        uint256 amount = _claimAsDelegatorPerValidator(
            delegator,
            validator,
            true
        );
        uint256 delegatorsAmount = _delegatorInfo[delegator]
            .delegatorPerValidator[validator]
            .amount;
        amount += delegatorsAmount;

        stoppedDelegatorsPool -= delegatorsAmount;
        _validatorInfo[validator].stoppedDelegatedAmount -= delegatorsAmount;
        _validatorInfo[validator].delegators.remove(delegator);
        _delegatorInfo[delegator].validators.remove(validator);

        uint256 fixedRewardToStore = _delegatorInfo[delegator]
            .delegatorPerValidator[validator]
            .fixedReward
            .fixedReward;
        delete _delegatorInfo[delegator].delegatorPerValidator[validator];
        _delegatorInfo[delegator]
            .delegatorPerValidator[validator]
            .fixedReward
            .fixedReward = fixedRewardToStore;

        emit DelegatorWithdrawed(delegator, validator);
        
        _safeTransferETH(delegator, amount, true);
    }

    function _updateFixedValidatorsReward() internal {
        if (_totalValidatorsRewards.fixedLastUpdate < testTime) {
            _totalValidatorsRewards.fixedReward = _fixedValidatorsReward();
            _totalValidatorsRewards.fixedLastUpdate = testTime;
        }
        _updateFixedDelegatorsReward();
    }

    function _updateFixedDelegatorsReward() internal {
        if (_totalDelegatorsRewards.fixedLastUpdate < testTime) {
            _totalDelegatorsRewards.fixedReward = _fixedDelegatorsReward();
            _totalDelegatorsRewards.fixedLastUpdate = testTime;
        }
    }

    function _safeTransferETH(
        address _to,
        uint256 _value,
        bool withTry
    ) internal {
        if (withTry) {
            (bool success, ) = _to.call{value: _value}(new bytes(0));
            if (!success) {
                unusualDepositor[_to] += _value;
                emit TransferToDepositorFailed(_to, _value);
            }
        } else {
            (bool success, ) = _to.call{value: _value}(new bytes(0));
            if (!success) revert NativeTransferFailed();
        }
    }

    // internal view methods

    function _rightBoarderV(address account) internal view returns (uint256) {
        return
            _validatorInfo[account].calledForWithdraw > 0
                ? _validatorInfo[account].calledForWithdraw
                : testTime;
    }

    function _rightBoarderDPV(
        address delegator,
        address validator
    ) internal view returns (uint256) {
        uint256 calledForWithdraw = _getDelegatorCallForWithdraw(
            delegator,
            validator
        );
        if (calledForWithdraw > 0) return calledForWithdraw;
        else return testTime;
    }

    function _fixedValidatorsReward() internal view returns (uint256) {
        return
            _totalValidatorsRewards.fixedReward +
            ((testTime - _totalValidatorsRewards.fixedLastUpdate) *
                totalValidatorsPool *
                settings.validatorsSettings.apr) /
            (PRECISION * YEAR_DURATION);
    }

    function _fixedDelegatorsReward() internal view returns (uint256) {
        return
            _totalDelegatorsRewards.fixedReward +
            ((testTime - _totalDelegatorsRewards.fixedLastUpdate) *
                totalDelegatorsPool *
                settings.delegatorsSettings.apr) /
            (PRECISION * YEAR_DURATION);
    }

    function _fixedRewardToAdd(
        address validator
    ) internal view returns (uint256) {
        return
            ((_rightBoarderV(validator) -
                _validatorInfo[validator].fixedReward.lastUpdate) *
                _validatorInfo[validator].amount *
                _validatorInfo[validator].fixedReward.apr) /
            (YEAR_DURATION * PRECISION);
    }

    function _getDelegatorCallForWithdraw(
        address delegator,
        address validator
    ) internal view returns (uint256) {
        (uint256 validatorCall, uint256 delegatorCall) = (
            _validatorInfo[validator].calledForWithdraw,
            _delegatorInfo[delegator]
                .delegatorPerValidator[validator]
                .calledForWithdraw
        );
        if (delegatorCall > 0 && validatorCall > 0) {
            return Math.min(delegatorCall, validatorCall);
        } else if (delegatorCall > 0) {
            return delegatorCall;
        } else if (validatorCall > 0) {
            return validatorCall;
        } else return 0;
    }

    function _cooldownCheck(uint256 _value) private pure {
        if (_value > 365 days) revert WrongValue(_value);
    }
}
