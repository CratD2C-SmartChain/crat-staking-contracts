// Sources flattened with hardhat v2.22.4 https://hardhat.org

// SPDX-License-Identifier: MIT

// File @openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol@v5.0.2

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (proxy/utils/Initializable.sol)

pragma solidity ^0.8.20;

/**
 * @dev This is a base contract to aid in writing upgradeable contracts, or any kind of contract that will be deployed
 * behind a proxy. Since proxied contracts do not make use of a constructor, it's common to move constructor logic to an
 * external initializer function, usually called `initialize`. It then becomes necessary to protect this initializer
 * function so it can only be called once. The {initializer} modifier provided by this contract will have this effect.
 *
 * The initialization functions use a version number. Once a version number is used, it is consumed and cannot be
 * reused. This mechanism prevents re-execution of each "step" but allows the creation of new initialization steps in
 * case an upgrade adds a module that needs to be initialized.
 *
 * For example:
 *
 * [.hljs-theme-light.nopadding]
 * ```solidity
 * contract MyToken is ERC20Upgradeable {
 *     function initialize() initializer public {
 *         __ERC20_init("MyToken", "MTK");
 *     }
 * }
 *
 * contract MyTokenV2 is MyToken, ERC20PermitUpgradeable {
 *     function initializeV2() reinitializer(2) public {
 *         __ERC20Permit_init("MyToken");
 *     }
 * }
 * ```
 *
 * TIP: To avoid leaving the proxy in an uninitialized state, the initializer function should be called as early as
 * possible by providing the encoded function call as the `_data` argument to {ERC1967Proxy-constructor}.
 *
 * CAUTION: When used with inheritance, manual care must be taken to not invoke a parent initializer twice, or to ensure
 * that all initializers are idempotent. This is not verified automatically as constructors are by Solidity.
 *
 * [CAUTION]
 * ====
 * Avoid leaving a contract uninitialized.
 *
 * An uninitialized contract can be taken over by an attacker. This applies to both a proxy and its implementation
 * contract, which may impact the proxy. To prevent the implementation contract from being used, you should invoke
 * the {_disableInitializers} function in the constructor to automatically lock it when it is deployed:
 *
 * [.hljs-theme-light.nopadding]
 * ```
 * /// @custom:oz-upgrades-unsafe-allow constructor
 * constructor() {
 *     _disableInitializers();
 * }
 * ```
 * ====
 */
abstract contract Initializable {
    /**
     * @dev Storage of the initializable contract.
     *
     * It's implemented on a custom ERC-7201 namespace to reduce the risk of storage collisions
     * when using with upgradeable contracts.
     *
     * @custom:storage-location erc7201:openzeppelin.storage.Initializable
     */
    struct InitializableStorage {
        /**
         * @dev Indicates that the contract has been initialized.
         */
        uint64 _initialized;
        /**
         * @dev Indicates that the contract is in the process of being initialized.
         */
        bool _initializing;
    }

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.Initializable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant INITIALIZABLE_STORAGE = 0xf0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00;

    /**
     * @dev The contract is already initialized.
     */
    error InvalidInitialization();

    /**
     * @dev The contract is not initializing.
     */
    error NotInitializing();

    /**
     * @dev Triggered when the contract has been initialized or reinitialized.
     */
    event Initialized(uint64 version);

    /**
     * @dev A modifier that defines a protected initializer function that can be invoked at most once. In its scope,
     * `onlyInitializing` functions can be used to initialize parent contracts.
     *
     * Similar to `reinitializer(1)`, except that in the context of a constructor an `initializer` may be invoked any
     * number of times. This behavior in the constructor can be useful during testing and is not expected to be used in
     * production.
     *
     * Emits an {Initialized} event.
     */
    modifier initializer() {
        // solhint-disable-next-line var-name-mixedcase
        InitializableStorage storage $ = _getInitializableStorage();

        // Cache values to avoid duplicated sloads
        bool isTopLevelCall = !$._initializing;
        uint64 initialized = $._initialized;

        // Allowed calls:
        // - initialSetup: the contract is not in the initializing state and no previous version was
        //                 initialized
        // - construction: the contract is initialized at version 1 (no reininitialization) and the
        //                 current contract is just being deployed
        bool initialSetup = initialized == 0 && isTopLevelCall;
        bool construction = initialized == 1 && address(this).code.length == 0;

        if (!initialSetup && !construction) {
            revert InvalidInitialization();
        }
        $._initialized = 1;
        if (isTopLevelCall) {
            $._initializing = true;
        }
        _;
        if (isTopLevelCall) {
            $._initializing = false;
            emit Initialized(1);
        }
    }

    /**
     * @dev A modifier that defines a protected reinitializer function that can be invoked at most once, and only if the
     * contract hasn't been initialized to a greater version before. In its scope, `onlyInitializing` functions can be
     * used to initialize parent contracts.
     *
     * A reinitializer may be used after the original initialization step. This is essential to configure modules that
     * are added through upgrades and that require initialization.
     *
     * When `version` is 1, this modifier is similar to `initializer`, except that functions marked with `reinitializer`
     * cannot be nested. If one is invoked in the context of another, execution will revert.
     *
     * Note that versions can jump in increments greater than 1; this implies that if multiple reinitializers coexist in
     * a contract, executing them in the right order is up to the developer or operator.
     *
     * WARNING: Setting the version to 2**64 - 1 will prevent any future reinitialization.
     *
     * Emits an {Initialized} event.
     */
    modifier reinitializer(uint64 version) {
        // solhint-disable-next-line var-name-mixedcase
        InitializableStorage storage $ = _getInitializableStorage();

        if ($._initializing || $._initialized >= version) {
            revert InvalidInitialization();
        }
        $._initialized = version;
        $._initializing = true;
        _;
        $._initializing = false;
        emit Initialized(version);
    }

    /**
     * @dev Modifier to protect an initialization function so that it can only be invoked by functions with the
     * {initializer} and {reinitializer} modifiers, directly or indirectly.
     */
    modifier onlyInitializing() {
        _checkInitializing();
        _;
    }

    /**
     * @dev Reverts if the contract is not in an initializing state. See {onlyInitializing}.
     */
    function _checkInitializing() internal view virtual {
        if (!_isInitializing()) {
            revert NotInitializing();
        }
    }

    /**
     * @dev Locks the contract, preventing any future reinitialization. This cannot be part of an initializer call.
     * Calling this in the constructor of a contract will prevent that contract from being initialized or reinitialized
     * to any version. It is recommended to use this to lock implementation contracts that are designed to be called
     * through proxies.
     *
     * Emits an {Initialized} event the first time it is successfully executed.
     */
    function _disableInitializers() internal virtual {
        // solhint-disable-next-line var-name-mixedcase
        InitializableStorage storage $ = _getInitializableStorage();

        if ($._initializing) {
            revert InvalidInitialization();
        }
        if ($._initialized != type(uint64).max) {
            $._initialized = type(uint64).max;
            emit Initialized(type(uint64).max);
        }
    }

    /**
     * @dev Returns the highest version that has been initialized. See {reinitializer}.
     */
    function _getInitializedVersion() internal view returns (uint64) {
        return _getInitializableStorage()._initialized;
    }

    /**
     * @dev Returns `true` if the contract is currently initializing. See {onlyInitializing}.
     */
    function _isInitializing() internal view returns (bool) {
        return _getInitializableStorage()._initializing;
    }

    /**
     * @dev Returns a pointer to the storage namespace.
     */
    // solhint-disable-next-line var-name-mixedcase
    function _getInitializableStorage() private pure returns (InitializableStorage storage $) {
        assembly {
            $.slot := INITIALIZABLE_STORAGE
        }
    }
}


// File @openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol@v5.0.2

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.1) (utils/Context.sol)

pragma solidity ^0.8.20;

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract ContextUpgradeable is Initializable {
    function __Context_init() internal onlyInitializing {
    }

    function __Context_init_unchained() internal onlyInitializing {
    }
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }

    function _contextSuffixLength() internal view virtual returns (uint256) {
        return 0;
    }
}


// File @openzeppelin/contracts/utils/introspection/IERC165.sol@v5.0.2

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (utils/introspection/IERC165.sol)

pragma solidity ^0.8.20;

/**
 * @dev Interface of the ERC165 standard, as defined in the
 * https://eips.ethereum.org/EIPS/eip-165[EIP].
 *
 * Implementers can declare support of contract interfaces, which can then be
 * queried by others ({ERC165Checker}).
 *
 * For an implementation, see {ERC165}.
 */
interface IERC165 {
    /**
     * @dev Returns true if this contract implements the interface defined by
     * `interfaceId`. See the corresponding
     * https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[EIP section]
     * to learn more about how these ids are created.
     *
     * This function call must use less than 30 000 gas.
     */
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}


// File @openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol@v5.0.2

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (utils/introspection/ERC165.sol)

pragma solidity ^0.8.20;


/**
 * @dev Implementation of the {IERC165} interface.
 *
 * Contracts that want to implement ERC165 should inherit from this contract and override {supportsInterface} to check
 * for the additional interface id that will be supported. For example:
 *
 * ```solidity
 * function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
 *     return interfaceId == type(MyInterface).interfaceId || super.supportsInterface(interfaceId);
 * }
 * ```
 */
abstract contract ERC165Upgradeable is Initializable, IERC165 {
    function __ERC165_init() internal onlyInitializing {
    }

    function __ERC165_init_unchained() internal onlyInitializing {
    }
    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual returns (bool) {
        return interfaceId == type(IERC165).interfaceId;
    }
}


// File @openzeppelin/contracts/access/IAccessControl.sol@v5.0.2

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (access/IAccessControl.sol)

pragma solidity ^0.8.20;

/**
 * @dev External interface of AccessControl declared to support ERC165 detection.
 */
interface IAccessControl {
    /**
     * @dev The `account` is missing a role.
     */
    error AccessControlUnauthorizedAccount(address account, bytes32 neededRole);

    /**
     * @dev The caller of a function is not the expected one.
     *
     * NOTE: Don't confuse with {AccessControlUnauthorizedAccount}.
     */
    error AccessControlBadConfirmation();

    /**
     * @dev Emitted when `newAdminRole` is set as ``role``'s admin role, replacing `previousAdminRole`
     *
     * `DEFAULT_ADMIN_ROLE` is the starting admin for all roles, despite
     * {RoleAdminChanged} not being emitted signaling this.
     */
    event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole);

    /**
     * @dev Emitted when `account` is granted `role`.
     *
     * `sender` is the account that originated the contract call, an admin role
     * bearer except when using {AccessControl-_setupRole}.
     */
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);

    /**
     * @dev Emitted when `account` is revoked `role`.
     *
     * `sender` is the account that originated the contract call:
     *   - if using `revokeRole`, it is the admin role bearer
     *   - if using `renounceRole`, it is the role bearer (i.e. `account`)
     */
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    /**
     * @dev Returns `true` if `account` has been granted `role`.
     */
    function hasRole(bytes32 role, address account) external view returns (bool);

    /**
     * @dev Returns the admin role that controls `role`. See {grantRole} and
     * {revokeRole}.
     *
     * To change a role's admin, use {AccessControl-_setRoleAdmin}.
     */
    function getRoleAdmin(bytes32 role) external view returns (bytes32);

    /**
     * @dev Grants `role` to `account`.
     *
     * If `account` had not been already granted `role`, emits a {RoleGranted}
     * event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     */
    function grantRole(bytes32 role, address account) external;

    /**
     * @dev Revokes `role` from `account`.
     *
     * If `account` had been granted `role`, emits a {RoleRevoked} event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     */
    function revokeRole(bytes32 role, address account) external;

    /**
     * @dev Revokes `role` from the calling account.
     *
     * Roles are often managed via {grantRole} and {revokeRole}: this function's
     * purpose is to provide a mechanism for accounts to lose their privileges
     * if they are compromised (such as when a trusted device is misplaced).
     *
     * If the calling account had been granted `role`, emits a {RoleRevoked}
     * event.
     *
     * Requirements:
     *
     * - the caller must be `callerConfirmation`.
     */
    function renounceRole(bytes32 role, address callerConfirmation) external;
}


// File @openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol@v5.0.2

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (access/AccessControl.sol)

pragma solidity ^0.8.20;




/**
 * @dev Contract module that allows children to implement role-based access
 * control mechanisms. This is a lightweight version that doesn't allow enumerating role
 * members except through off-chain means by accessing the contract event logs. Some
 * applications may benefit from on-chain enumerability, for those cases see
 * {AccessControlEnumerable}.
 *
 * Roles are referred to by their `bytes32` identifier. These should be exposed
 * in the external API and be unique. The best way to achieve this is by
 * using `public constant` hash digests:
 *
 * ```solidity
 * bytes32 public constant MY_ROLE = keccak256("MY_ROLE");
 * ```
 *
 * Roles can be used to represent a set of permissions. To restrict access to a
 * function call, use {hasRole}:
 *
 * ```solidity
 * function foo() public {
 *     require(hasRole(MY_ROLE, msg.sender));
 *     ...
 * }
 * ```
 *
 * Roles can be granted and revoked dynamically via the {grantRole} and
 * {revokeRole} functions. Each role has an associated admin role, and only
 * accounts that have a role's admin role can call {grantRole} and {revokeRole}.
 *
 * By default, the admin role for all roles is `DEFAULT_ADMIN_ROLE`, which means
 * that only accounts with this role will be able to grant or revoke other
 * roles. More complex role relationships can be created by using
 * {_setRoleAdmin}.
 *
 * WARNING: The `DEFAULT_ADMIN_ROLE` is also its own admin: it has permission to
 * grant and revoke this role. Extra precautions should be taken to secure
 * accounts that have been granted it. We recommend using {AccessControlDefaultAdminRules}
 * to enforce additional security measures for this role.
 */
abstract contract AccessControlUpgradeable is Initializable, ContextUpgradeable, IAccessControl, ERC165Upgradeable {
    struct RoleData {
        mapping(address account => bool) hasRole;
        bytes32 adminRole;
    }

    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;


    /// @custom:storage-location erc7201:openzeppelin.storage.AccessControl
    struct AccessControlStorage {
        mapping(bytes32 role => RoleData) _roles;
    }

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.AccessControl")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant AccessControlStorageLocation = 0x02dd7bc7dec4dceedda775e58dd541e08a116c6c53815c0bd028192f7b626800;

    function _getAccessControlStorage() private pure returns (AccessControlStorage storage $) {
        assembly {
            $.slot := AccessControlStorageLocation
        }
    }

    /**
     * @dev Modifier that checks that an account has a specific role. Reverts
     * with an {AccessControlUnauthorizedAccount} error including the required role.
     */
    modifier onlyRole(bytes32 role) {
        _checkRole(role);
        _;
    }

    function __AccessControl_init() internal onlyInitializing {
    }

    function __AccessControl_init_unchained() internal onlyInitializing {
    }
    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IAccessControl).interfaceId || super.supportsInterface(interfaceId);
    }

    /**
     * @dev Returns `true` if `account` has been granted `role`.
     */
    function hasRole(bytes32 role, address account) public view virtual returns (bool) {
        AccessControlStorage storage $ = _getAccessControlStorage();
        return $._roles[role].hasRole[account];
    }

    /**
     * @dev Reverts with an {AccessControlUnauthorizedAccount} error if `_msgSender()`
     * is missing `role`. Overriding this function changes the behavior of the {onlyRole} modifier.
     */
    function _checkRole(bytes32 role) internal view virtual {
        _checkRole(role, _msgSender());
    }

    /**
     * @dev Reverts with an {AccessControlUnauthorizedAccount} error if `account`
     * is missing `role`.
     */
    function _checkRole(bytes32 role, address account) internal view virtual {
        if (!hasRole(role, account)) {
            revert AccessControlUnauthorizedAccount(account, role);
        }
    }

    /**
     * @dev Returns the admin role that controls `role`. See {grantRole} and
     * {revokeRole}.
     *
     * To change a role's admin, use {_setRoleAdmin}.
     */
    function getRoleAdmin(bytes32 role) public view virtual returns (bytes32) {
        AccessControlStorage storage $ = _getAccessControlStorage();
        return $._roles[role].adminRole;
    }

    /**
     * @dev Grants `role` to `account`.
     *
     * If `account` had not been already granted `role`, emits a {RoleGranted}
     * event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     *
     * May emit a {RoleGranted} event.
     */
    function grantRole(bytes32 role, address account) public virtual onlyRole(getRoleAdmin(role)) {
        _grantRole(role, account);
    }

    /**
     * @dev Revokes `role` from `account`.
     *
     * If `account` had been granted `role`, emits a {RoleRevoked} event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     *
     * May emit a {RoleRevoked} event.
     */
    function revokeRole(bytes32 role, address account) public virtual onlyRole(getRoleAdmin(role)) {
        _revokeRole(role, account);
    }

    /**
     * @dev Revokes `role` from the calling account.
     *
     * Roles are often managed via {grantRole} and {revokeRole}: this function's
     * purpose is to provide a mechanism for accounts to lose their privileges
     * if they are compromised (such as when a trusted device is misplaced).
     *
     * If the calling account had been revoked `role`, emits a {RoleRevoked}
     * event.
     *
     * Requirements:
     *
     * - the caller must be `callerConfirmation`.
     *
     * May emit a {RoleRevoked} event.
     */
    function renounceRole(bytes32 role, address callerConfirmation) public virtual {
        if (callerConfirmation != _msgSender()) {
            revert AccessControlBadConfirmation();
        }

        _revokeRole(role, callerConfirmation);
    }

    /**
     * @dev Sets `adminRole` as ``role``'s admin role.
     *
     * Emits a {RoleAdminChanged} event.
     */
    function _setRoleAdmin(bytes32 role, bytes32 adminRole) internal virtual {
        AccessControlStorage storage $ = _getAccessControlStorage();
        bytes32 previousAdminRole = getRoleAdmin(role);
        $._roles[role].adminRole = adminRole;
        emit RoleAdminChanged(role, previousAdminRole, adminRole);
    }

    /**
     * @dev Attempts to grant `role` to `account` and returns a boolean indicating if `role` was granted.
     *
     * Internal function without access restriction.
     *
     * May emit a {RoleGranted} event.
     */
    function _grantRole(bytes32 role, address account) internal virtual returns (bool) {
        AccessControlStorage storage $ = _getAccessControlStorage();
        if (!hasRole(role, account)) {
            $._roles[role].hasRole[account] = true;
            emit RoleGranted(role, account, _msgSender());
            return true;
        } else {
            return false;
        }
    }

    /**
     * @dev Attempts to revoke `role` to `account` and returns a boolean indicating if `role` was revoked.
     *
     * Internal function without access restriction.
     *
     * May emit a {RoleRevoked} event.
     */
    function _revokeRole(bytes32 role, address account) internal virtual returns (bool) {
        AccessControlStorage storage $ = _getAccessControlStorage();
        if (hasRole(role, account)) {
            $._roles[role].hasRole[account] = false;
            emit RoleRevoked(role, account, _msgSender());
            return true;
        } else {
            return false;
        }
    }
}


// File @openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol@v5.0.2

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (utils/ReentrancyGuard.sol)

pragma solidity ^0.8.20;

/**
 * @dev Contract module that helps prevent reentrant calls to a function.
 *
 * Inheriting from `ReentrancyGuard` will make the {nonReentrant} modifier
 * available, which can be applied to functions to make sure there are no nested
 * (reentrant) calls to them.
 *
 * Note that because there is a single `nonReentrant` guard, functions marked as
 * `nonReentrant` may not call one another. This can be worked around by making
 * those functions `private`, and then adding `external` `nonReentrant` entry
 * points to them.
 *
 * TIP: If you would like to learn more about reentrancy and alternative ways
 * to protect against it, check out our blog post
 * https://blog.openzeppelin.com/reentrancy-after-istanbul/[Reentrancy After Istanbul].
 */
abstract contract ReentrancyGuardUpgradeable is Initializable {
    // Booleans are more expensive than uint256 or any type that takes up a full
    // word because each write operation emits an extra SLOAD to first read the
    // slot's contents, replace the bits taken up by the boolean, and then write
    // back. This is the compiler's defense against contract upgrades and
    // pointer aliasing, and it cannot be disabled.

    // The values being non-zero value makes deployment a bit more expensive,
    // but in exchange the refund on every call to nonReentrant will be lower in
    // amount. Since refunds are capped to a percentage of the total
    // transaction's gas, it is best to keep them low in cases like this one, to
    // increase the likelihood of the full refund coming into effect.
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    /// @custom:storage-location erc7201:openzeppelin.storage.ReentrancyGuard
    struct ReentrancyGuardStorage {
        uint256 _status;
    }

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.ReentrancyGuard")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant ReentrancyGuardStorageLocation = 0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00;

    function _getReentrancyGuardStorage() private pure returns (ReentrancyGuardStorage storage $) {
        assembly {
            $.slot := ReentrancyGuardStorageLocation
        }
    }

    /**
     * @dev Unauthorized reentrant call.
     */
    error ReentrancyGuardReentrantCall();

    function __ReentrancyGuard_init() internal onlyInitializing {
        __ReentrancyGuard_init_unchained();
    }

    function __ReentrancyGuard_init_unchained() internal onlyInitializing {
        ReentrancyGuardStorage storage $ = _getReentrancyGuardStorage();
        $._status = NOT_ENTERED;
    }

    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     * Calling a `nonReentrant` function from another `nonReentrant`
     * function is not supported. It is possible to prevent this from happening
     * by making the `nonReentrant` function external, and making it call a
     * `private` function that does the actual work.
     */
    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() private {
        ReentrancyGuardStorage storage $ = _getReentrancyGuardStorage();
        // On the first call to nonReentrant, _status will be NOT_ENTERED
        if ($._status == ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }

        // Any calls to nonReentrant after this point will fail
        $._status = ENTERED;
    }

    function _nonReentrantAfter() private {
        ReentrancyGuardStorage storage $ = _getReentrancyGuardStorage();
        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        $._status = NOT_ENTERED;
    }

    /**
     * @dev Returns true if the reentrancy guard is currently set to "entered", which indicates there is a
     * `nonReentrant` function in the call stack.
     */
    function _reentrancyGuardEntered() internal view returns (bool) {
        ReentrancyGuardStorage storage $ = _getReentrancyGuardStorage();
        return $._status == ENTERED;
    }
}


// File @openzeppelin/contracts/utils/math/Math.sol@v5.0.2

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (utils/math/Math.sol)

pragma solidity ^0.8.20;

/**
 * @dev Standard math utilities missing in the Solidity language.
 */
library Math {
    /**
     * @dev Muldiv operation overflow.
     */
    error MathOverflowedMulDiv();

    enum Rounding {
        Floor, // Toward negative infinity
        Ceil, // Toward positive infinity
        Trunc, // Toward zero
        Expand // Away from zero
    }

    /**
     * @dev Returns the addition of two unsigned integers, with an overflow flag.
     */
    function tryAdd(uint256 a, uint256 b) internal pure returns (bool, uint256) {
        unchecked {
            uint256 c = a + b;
            if (c < a) return (false, 0);
            return (true, c);
        }
    }

    /**
     * @dev Returns the subtraction of two unsigned integers, with an overflow flag.
     */
    function trySub(uint256 a, uint256 b) internal pure returns (bool, uint256) {
        unchecked {
            if (b > a) return (false, 0);
            return (true, a - b);
        }
    }

    /**
     * @dev Returns the multiplication of two unsigned integers, with an overflow flag.
     */
    function tryMul(uint256 a, uint256 b) internal pure returns (bool, uint256) {
        unchecked {
            // Gas optimization: this is cheaper than requiring 'a' not being zero, but the
            // benefit is lost if 'b' is also tested.
            // See: https://github.com/OpenZeppelin/openzeppelin-contracts/pull/522
            if (a == 0) return (true, 0);
            uint256 c = a * b;
            if (c / a != b) return (false, 0);
            return (true, c);
        }
    }

    /**
     * @dev Returns the division of two unsigned integers, with a division by zero flag.
     */
    function tryDiv(uint256 a, uint256 b) internal pure returns (bool, uint256) {
        unchecked {
            if (b == 0) return (false, 0);
            return (true, a / b);
        }
    }

    /**
     * @dev Returns the remainder of dividing two unsigned integers, with a division by zero flag.
     */
    function tryMod(uint256 a, uint256 b) internal pure returns (bool, uint256) {
        unchecked {
            if (b == 0) return (false, 0);
            return (true, a % b);
        }
    }

    /**
     * @dev Returns the largest of two numbers.
     */
    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }

    /**
     * @dev Returns the smallest of two numbers.
     */
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    /**
     * @dev Returns the average of two numbers. The result is rounded towards
     * zero.
     */
    function average(uint256 a, uint256 b) internal pure returns (uint256) {
        // (a + b) / 2 can overflow.
        return (a & b) + (a ^ b) / 2;
    }

    /**
     * @dev Returns the ceiling of the division of two numbers.
     *
     * This differs from standard division with `/` in that it rounds towards infinity instead
     * of rounding towards zero.
     */
    function ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        if (b == 0) {
            // Guarantee the same behavior as in a regular Solidity division.
            return a / b;
        }

        // (a + b - 1) / b can overflow on addition, so we distribute.
        return a == 0 ? 0 : (a - 1) / b + 1;
    }

    /**
     * @notice Calculates floor(x * y / denominator) with full precision. Throws if result overflows a uint256 or
     * denominator == 0.
     * @dev Original credit to Remco Bloemen under MIT license (https://xn--2-umb.com/21/muldiv) with further edits by
     * Uniswap Labs also under MIT license.
     */
    function mulDiv(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 result) {
        unchecked {
            // 512-bit multiply [prod1 prod0] = x * y. Compute the product mod 2^256 and mod 2^256 - 1, then use
            // use the Chinese Remainder Theorem to reconstruct the 512 bit result. The result is stored in two 256
            // variables such that product = prod1 * 2^256 + prod0.
            uint256 prod0 = x * y; // Least significant 256 bits of the product
            uint256 prod1; // Most significant 256 bits of the product
            assembly {
                let mm := mulmod(x, y, not(0))
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }

            // Handle non-overflow cases, 256 by 256 division.
            if (prod1 == 0) {
                // Solidity will revert if denominator == 0, unlike the div opcode on its own.
                // The surrounding unchecked block does not change this fact.
                // See https://docs.soliditylang.org/en/latest/control-structures.html#checked-or-unchecked-arithmetic.
                return prod0 / denominator;
            }

            // Make sure the result is less than 2^256. Also prevents denominator == 0.
            if (denominator <= prod1) {
                revert MathOverflowedMulDiv();
            }

            ///////////////////////////////////////////////
            // 512 by 256 division.
            ///////////////////////////////////////////////

            // Make division exact by subtracting the remainder from [prod1 prod0].
            uint256 remainder;
            assembly {
                // Compute remainder using mulmod.
                remainder := mulmod(x, y, denominator)

                // Subtract 256 bit number from 512 bit number.
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }

            // Factor powers of two out of denominator and compute largest power of two divisor of denominator.
            // Always >= 1. See https://cs.stackexchange.com/q/138556/92363.

            uint256 twos = denominator & (0 - denominator);
            assembly {
                // Divide denominator by twos.
                denominator := div(denominator, twos)

                // Divide [prod1 prod0] by twos.
                prod0 := div(prod0, twos)

                // Flip twos such that it is 2^256 / twos. If twos is zero, then it becomes one.
                twos := add(div(sub(0, twos), twos), 1)
            }

            // Shift in bits from prod1 into prod0.
            prod0 |= prod1 * twos;

            // Invert denominator mod 2^256. Now that denominator is an odd number, it has an inverse modulo 2^256 such
            // that denominator * inv = 1 mod 2^256. Compute the inverse by starting with a seed that is correct for
            // four bits. That is, denominator * inv = 1 mod 2^4.
            uint256 inverse = (3 * denominator) ^ 2;

            // Use the Newton-Raphson iteration to improve the precision. Thanks to Hensel's lifting lemma, this also
            // works in modular arithmetic, doubling the correct bits in each step.
            inverse *= 2 - denominator * inverse; // inverse mod 2^8
            inverse *= 2 - denominator * inverse; // inverse mod 2^16
            inverse *= 2 - denominator * inverse; // inverse mod 2^32
            inverse *= 2 - denominator * inverse; // inverse mod 2^64
            inverse *= 2 - denominator * inverse; // inverse mod 2^128
            inverse *= 2 - denominator * inverse; // inverse mod 2^256

            // Because the division is now exact we can divide by multiplying with the modular inverse of denominator.
            // This will give us the correct result modulo 2^256. Since the preconditions guarantee that the outcome is
            // less than 2^256, this is the final result. We don't need to compute the high bits of the result and prod1
            // is no longer required.
            result = prod0 * inverse;
            return result;
        }
    }

    /**
     * @notice Calculates x * y / denominator with full precision, following the selected rounding direction.
     */
    function mulDiv(uint256 x, uint256 y, uint256 denominator, Rounding rounding) internal pure returns (uint256) {
        uint256 result = mulDiv(x, y, denominator);
        if (unsignedRoundsUp(rounding) && mulmod(x, y, denominator) > 0) {
            result += 1;
        }
        return result;
    }

    /**
     * @dev Returns the square root of a number. If the number is not a perfect square, the value is rounded
     * towards zero.
     *
     * Inspired by Henry S. Warren, Jr.'s "Hacker's Delight" (Chapter 11).
     */
    function sqrt(uint256 a) internal pure returns (uint256) {
        if (a == 0) {
            return 0;
        }

        // For our first guess, we get the biggest power of 2 which is smaller than the square root of the target.
        //
        // We know that the "msb" (most significant bit) of our target number `a` is a power of 2 such that we have
        // `msb(a) <= a < 2*msb(a)`. This value can be written `msb(a)=2**k` with `k=log2(a)`.
        //
        // This can be rewritten `2**log2(a) <= a < 2**(log2(a) + 1)`
        // → `sqrt(2**k) <= sqrt(a) < sqrt(2**(k+1))`
        // → `2**(k/2) <= sqrt(a) < 2**((k+1)/2) <= 2**(k/2 + 1)`
        //
        // Consequently, `2**(log2(a) / 2)` is a good first approximation of `sqrt(a)` with at least 1 correct bit.
        uint256 result = 1 << (log2(a) >> 1);

        // At this point `result` is an estimation with one bit of precision. We know the true value is a uint128,
        // since it is the square root of a uint256. Newton's method converges quadratically (precision doubles at
        // every iteration). We thus need at most 7 iteration to turn our partial result with one bit of precision
        // into the expected uint128 result.
        unchecked {
            result = (result + a / result) >> 1;
            result = (result + a / result) >> 1;
            result = (result + a / result) >> 1;
            result = (result + a / result) >> 1;
            result = (result + a / result) >> 1;
            result = (result + a / result) >> 1;
            result = (result + a / result) >> 1;
            return min(result, a / result);
        }
    }

    /**
     * @notice Calculates sqrt(a), following the selected rounding direction.
     */
    function sqrt(uint256 a, Rounding rounding) internal pure returns (uint256) {
        unchecked {
            uint256 result = sqrt(a);
            return result + (unsignedRoundsUp(rounding) && result * result < a ? 1 : 0);
        }
    }

    /**
     * @dev Return the log in base 2 of a positive value rounded towards zero.
     * Returns 0 if given 0.
     */
    function log2(uint256 value) internal pure returns (uint256) {
        uint256 result = 0;
        unchecked {
            if (value >> 128 > 0) {
                value >>= 128;
                result += 128;
            }
            if (value >> 64 > 0) {
                value >>= 64;
                result += 64;
            }
            if (value >> 32 > 0) {
                value >>= 32;
                result += 32;
            }
            if (value >> 16 > 0) {
                value >>= 16;
                result += 16;
            }
            if (value >> 8 > 0) {
                value >>= 8;
                result += 8;
            }
            if (value >> 4 > 0) {
                value >>= 4;
                result += 4;
            }
            if (value >> 2 > 0) {
                value >>= 2;
                result += 2;
            }
            if (value >> 1 > 0) {
                result += 1;
            }
        }
        return result;
    }

    /**
     * @dev Return the log in base 2, following the selected rounding direction, of a positive value.
     * Returns 0 if given 0.
     */
    function log2(uint256 value, Rounding rounding) internal pure returns (uint256) {
        unchecked {
            uint256 result = log2(value);
            return result + (unsignedRoundsUp(rounding) && 1 << result < value ? 1 : 0);
        }
    }

    /**
     * @dev Return the log in base 10 of a positive value rounded towards zero.
     * Returns 0 if given 0.
     */
    function log10(uint256 value) internal pure returns (uint256) {
        uint256 result = 0;
        unchecked {
            if (value >= 10 ** 64) {
                value /= 10 ** 64;
                result += 64;
            }
            if (value >= 10 ** 32) {
                value /= 10 ** 32;
                result += 32;
            }
            if (value >= 10 ** 16) {
                value /= 10 ** 16;
                result += 16;
            }
            if (value >= 10 ** 8) {
                value /= 10 ** 8;
                result += 8;
            }
            if (value >= 10 ** 4) {
                value /= 10 ** 4;
                result += 4;
            }
            if (value >= 10 ** 2) {
                value /= 10 ** 2;
                result += 2;
            }
            if (value >= 10 ** 1) {
                result += 1;
            }
        }
        return result;
    }

    /**
     * @dev Return the log in base 10, following the selected rounding direction, of a positive value.
     * Returns 0 if given 0.
     */
    function log10(uint256 value, Rounding rounding) internal pure returns (uint256) {
        unchecked {
            uint256 result = log10(value);
            return result + (unsignedRoundsUp(rounding) && 10 ** result < value ? 1 : 0);
        }
    }

    /**
     * @dev Return the log in base 256 of a positive value rounded towards zero.
     * Returns 0 if given 0.
     *
     * Adding one to the result gives the number of pairs of hex symbols needed to represent `value` as a hex string.
     */
    function log256(uint256 value) internal pure returns (uint256) {
        uint256 result = 0;
        unchecked {
            if (value >> 128 > 0) {
                value >>= 128;
                result += 16;
            }
            if (value >> 64 > 0) {
                value >>= 64;
                result += 8;
            }
            if (value >> 32 > 0) {
                value >>= 32;
                result += 4;
            }
            if (value >> 16 > 0) {
                value >>= 16;
                result += 2;
            }
            if (value >> 8 > 0) {
                result += 1;
            }
        }
        return result;
    }

    /**
     * @dev Return the log in base 256, following the selected rounding direction, of a positive value.
     * Returns 0 if given 0.
     */
    function log256(uint256 value, Rounding rounding) internal pure returns (uint256) {
        unchecked {
            uint256 result = log256(value);
            return result + (unsignedRoundsUp(rounding) && 1 << (result << 3) < value ? 1 : 0);
        }
    }

    /**
     * @dev Returns whether a provided rounding mode is considered rounding up for unsigned integers.
     */
    function unsignedRoundsUp(Rounding rounding) internal pure returns (bool) {
        return uint8(rounding) % 2 == 1;
    }
}


// File @openzeppelin/contracts/utils/structs/EnumerableSet.sol@v5.0.2

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (utils/structs/EnumerableSet.sol)
// This file was procedurally generated from scripts/generate/templates/EnumerableSet.js.

pragma solidity ^0.8.20;

/**
 * @dev Library for managing
 * https://en.wikipedia.org/wiki/Set_(abstract_data_type)[sets] of primitive
 * types.
 *
 * Sets have the following properties:
 *
 * - Elements are added, removed, and checked for existence in constant time
 * (O(1)).
 * - Elements are enumerated in O(n). No guarantees are made on the ordering.
 *
 * ```solidity
 * contract Example {
 *     // Add the library methods
 *     using EnumerableSet for EnumerableSet.AddressSet;
 *
 *     // Declare a set state variable
 *     EnumerableSet.AddressSet private mySet;
 * }
 * ```
 *
 * As of v3.3.0, sets of type `bytes32` (`Bytes32Set`), `address` (`AddressSet`)
 * and `uint256` (`UintSet`) are supported.
 *
 * [WARNING]
 * ====
 * Trying to delete such a structure from storage will likely result in data corruption, rendering the structure
 * unusable.
 * See https://github.com/ethereum/solidity/pull/11843[ethereum/solidity#11843] for more info.
 *
 * In order to clean an EnumerableSet, you can either remove all elements one by one or create a fresh instance using an
 * array of EnumerableSet.
 * ====
 */
library EnumerableSet {
    // To implement this library for multiple types with as little code
    // repetition as possible, we write it in terms of a generic Set type with
    // bytes32 values.
    // The Set implementation uses private functions, and user-facing
    // implementations (such as AddressSet) are just wrappers around the
    // underlying Set.
    // This means that we can only create new EnumerableSets for types that fit
    // in bytes32.

    struct Set {
        // Storage of set values
        bytes32[] _values;
        // Position is the index of the value in the `values` array plus 1.
        // Position 0 is used to mean a value is not in the set.
        mapping(bytes32 value => uint256) _positions;
    }

    /**
     * @dev Add a value to a set. O(1).
     *
     * Returns true if the value was added to the set, that is if it was not
     * already present.
     */
    function _add(Set storage set, bytes32 value) private returns (bool) {
        if (!_contains(set, value)) {
            set._values.push(value);
            // The value is stored at length-1, but we add 1 to all indexes
            // and use 0 as a sentinel value
            set._positions[value] = set._values.length;
            return true;
        } else {
            return false;
        }
    }

    /**
     * @dev Removes a value from a set. O(1).
     *
     * Returns true if the value was removed from the set, that is if it was
     * present.
     */
    function _remove(Set storage set, bytes32 value) private returns (bool) {
        // We cache the value's position to prevent multiple reads from the same storage slot
        uint256 position = set._positions[value];

        if (position != 0) {
            // Equivalent to contains(set, value)
            // To delete an element from the _values array in O(1), we swap the element to delete with the last one in
            // the array, and then remove the last element (sometimes called as 'swap and pop').
            // This modifies the order of the array, as noted in {at}.

            uint256 valueIndex = position - 1;
            uint256 lastIndex = set._values.length - 1;

            if (valueIndex != lastIndex) {
                bytes32 lastValue = set._values[lastIndex];

                // Move the lastValue to the index where the value to delete is
                set._values[valueIndex] = lastValue;
                // Update the tracked position of the lastValue (that was just moved)
                set._positions[lastValue] = position;
            }

            // Delete the slot where the moved value was stored
            set._values.pop();

            // Delete the tracked position for the deleted slot
            delete set._positions[value];

            return true;
        } else {
            return false;
        }
    }

    /**
     * @dev Returns true if the value is in the set. O(1).
     */
    function _contains(Set storage set, bytes32 value) private view returns (bool) {
        return set._positions[value] != 0;
    }

    /**
     * @dev Returns the number of values on the set. O(1).
     */
    function _length(Set storage set) private view returns (uint256) {
        return set._values.length;
    }

    /**
     * @dev Returns the value stored at position `index` in the set. O(1).
     *
     * Note that there are no guarantees on the ordering of values inside the
     * array, and it may change when more values are added or removed.
     *
     * Requirements:
     *
     * - `index` must be strictly less than {length}.
     */
    function _at(Set storage set, uint256 index) private view returns (bytes32) {
        return set._values[index];
    }

    /**
     * @dev Return the entire set in an array
     *
     * WARNING: This operation will copy the entire storage to memory, which can be quite expensive. This is designed
     * to mostly be used by view accessors that are queried without any gas fees. Developers should keep in mind that
     * this function has an unbounded cost, and using it as part of a state-changing function may render the function
     * uncallable if the set grows to a point where copying to memory consumes too much gas to fit in a block.
     */
    function _values(Set storage set) private view returns (bytes32[] memory) {
        return set._values;
    }

    // Bytes32Set

    struct Bytes32Set {
        Set _inner;
    }

    /**
     * @dev Add a value to a set. O(1).
     *
     * Returns true if the value was added to the set, that is if it was not
     * already present.
     */
    function add(Bytes32Set storage set, bytes32 value) internal returns (bool) {
        return _add(set._inner, value);
    }

    /**
     * @dev Removes a value from a set. O(1).
     *
     * Returns true if the value was removed from the set, that is if it was
     * present.
     */
    function remove(Bytes32Set storage set, bytes32 value) internal returns (bool) {
        return _remove(set._inner, value);
    }

    /**
     * @dev Returns true if the value is in the set. O(1).
     */
    function contains(Bytes32Set storage set, bytes32 value) internal view returns (bool) {
        return _contains(set._inner, value);
    }

    /**
     * @dev Returns the number of values in the set. O(1).
     */
    function length(Bytes32Set storage set) internal view returns (uint256) {
        return _length(set._inner);
    }

    /**
     * @dev Returns the value stored at position `index` in the set. O(1).
     *
     * Note that there are no guarantees on the ordering of values inside the
     * array, and it may change when more values are added or removed.
     *
     * Requirements:
     *
     * - `index` must be strictly less than {length}.
     */
    function at(Bytes32Set storage set, uint256 index) internal view returns (bytes32) {
        return _at(set._inner, index);
    }

    /**
     * @dev Return the entire set in an array
     *
     * WARNING: This operation will copy the entire storage to memory, which can be quite expensive. This is designed
     * to mostly be used by view accessors that are queried without any gas fees. Developers should keep in mind that
     * this function has an unbounded cost, and using it as part of a state-changing function may render the function
     * uncallable if the set grows to a point where copying to memory consumes too much gas to fit in a block.
     */
    function values(Bytes32Set storage set) internal view returns (bytes32[] memory) {
        bytes32[] memory store = _values(set._inner);
        bytes32[] memory result;

        /// @solidity memory-safe-assembly
        assembly {
            result := store
        }

        return result;
    }

    // AddressSet

    struct AddressSet {
        Set _inner;
    }

    /**
     * @dev Add a value to a set. O(1).
     *
     * Returns true if the value was added to the set, that is if it was not
     * already present.
     */
    function add(AddressSet storage set, address value) internal returns (bool) {
        return _add(set._inner, bytes32(uint256(uint160(value))));
    }

    /**
     * @dev Removes a value from a set. O(1).
     *
     * Returns true if the value was removed from the set, that is if it was
     * present.
     */
    function remove(AddressSet storage set, address value) internal returns (bool) {
        return _remove(set._inner, bytes32(uint256(uint160(value))));
    }

    /**
     * @dev Returns true if the value is in the set. O(1).
     */
    function contains(AddressSet storage set, address value) internal view returns (bool) {
        return _contains(set._inner, bytes32(uint256(uint160(value))));
    }

    /**
     * @dev Returns the number of values in the set. O(1).
     */
    function length(AddressSet storage set) internal view returns (uint256) {
        return _length(set._inner);
    }

    /**
     * @dev Returns the value stored at position `index` in the set. O(1).
     *
     * Note that there are no guarantees on the ordering of values inside the
     * array, and it may change when more values are added or removed.
     *
     * Requirements:
     *
     * - `index` must be strictly less than {length}.
     */
    function at(AddressSet storage set, uint256 index) internal view returns (address) {
        return address(uint160(uint256(_at(set._inner, index))));
    }

    /**
     * @dev Return the entire set in an array
     *
     * WARNING: This operation will copy the entire storage to memory, which can be quite expensive. This is designed
     * to mostly be used by view accessors that are queried without any gas fees. Developers should keep in mind that
     * this function has an unbounded cost, and using it as part of a state-changing function may render the function
     * uncallable if the set grows to a point where copying to memory consumes too much gas to fit in a block.
     */
    function values(AddressSet storage set) internal view returns (address[] memory) {
        bytes32[] memory store = _values(set._inner);
        address[] memory result;

        /// @solidity memory-safe-assembly
        assembly {
            result := store
        }

        return result;
    }

    // UintSet

    struct UintSet {
        Set _inner;
    }

    /**
     * @dev Add a value to a set. O(1).
     *
     * Returns true if the value was added to the set, that is if it was not
     * already present.
     */
    function add(UintSet storage set, uint256 value) internal returns (bool) {
        return _add(set._inner, bytes32(value));
    }

    /**
     * @dev Removes a value from a set. O(1).
     *
     * Returns true if the value was removed from the set, that is if it was
     * present.
     */
    function remove(UintSet storage set, uint256 value) internal returns (bool) {
        return _remove(set._inner, bytes32(value));
    }

    /**
     * @dev Returns true if the value is in the set. O(1).
     */
    function contains(UintSet storage set, uint256 value) internal view returns (bool) {
        return _contains(set._inner, bytes32(value));
    }

    /**
     * @dev Returns the number of values in the set. O(1).
     */
    function length(UintSet storage set) internal view returns (uint256) {
        return _length(set._inner);
    }

    /**
     * @dev Returns the value stored at position `index` in the set. O(1).
     *
     * Note that there are no guarantees on the ordering of values inside the
     * array, and it may change when more values are added or removed.
     *
     * Requirements:
     *
     * - `index` must be strictly less than {length}.
     */
    function at(UintSet storage set, uint256 index) internal view returns (uint256) {
        return uint256(_at(set._inner, index));
    }

    /**
     * @dev Return the entire set in an array
     *
     * WARNING: This operation will copy the entire storage to memory, which can be quite expensive. This is designed
     * to mostly be used by view accessors that are queried without any gas fees. Developers should keep in mind that
     * this function has an unbounded cost, and using it as part of a state-changing function may render the function
     * uncallable if the set grows to a point where copying to memory consumes too much gas to fit in a block.
     */
    function values(UintSet storage set) internal view returns (uint256[] memory) {
        bytes32[] memory store = _values(set._inner);
        uint256[] memory result;

        /// @solidity memory-safe-assembly
        assembly {
            result := store
        }

        return result;
    }
}


// File contracts/mock/CRATStakeManagetTest.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity 0.8.24;




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
        require(_receiver != address(0));

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
        require(receiver != address(0));
        settings.slashReceiver = receiver;
    }

    /** @notice change validators limit
     * @param value new validators limit
     * @dev only admin
     */
    function setValidatorsLimit(
        uint256 value
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(value >= _validators.length());
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
        require(value <= PRECISION);
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
        require(forFixedReward >= amount);
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
            "wrong length"
        );

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

        require(msg.value >= totalReward);

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
        address[] memory delegators;
        uint256 total;
        for (uint256 i; i < len; ++i) {
            if (isValidator(validators[i])) {
                _updateValidatorReward(validators[i]);

                fee =
                    _validatorInfo[validators[i]].penalty.potentialPenalty +
                    settings.validatorsSettings.toSlash;
                fee = _validatorInfo[validators[i]].amount > fee
                    ? fee
                    : _validatorInfo[validators[i]].amount;

                _validatorInfo[validators[i]].amount -= fee;
                delete _validatorInfo[validators[i]].penalty.potentialPenalty;
                _validatorInfo[validators[i]].penalty.lastSlash = block
                    .timestamp;
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

        if (total > 0) _safeTransferETH(settings.slashReceiver, total);
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
        require(sender != address(0));
        require(
            vestingEnd > testTime &&
                _validatorInfo[sender].vestingEnd <= vestingEnd,
            "wrong vesting end"
        );

        _validatorInfo[sender].vestingEnd = vestingEnd;

        uint256 amount = msg.value;

        require(
            amount + _validatorInfo[sender].amount >=
                settings.validatorsSettings.minimumThreshold &&
                amount > 0,
            "wrong input amount"
        );
        if (!_validators.contains(sender))
            require(
                _validators.length() < settings.validatorsLimit,
                "limit reached"
            );

        require(!isDelegator(sender), "validators only");

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

        require(
            amount + _validatorInfo[sender].amount >=
                settings.validatorsSettings.minimumThreshold &&
                amount > 0,
            "wrong input amount"
        );
        if (!_validators.contains(sender))
            require(
                _validators.length() < settings.validatorsLimit,
                "limit reached"
            );

        require(!isDelegator(sender), "validators only");

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

        require(!isValidator(sender), "delegators only");
        require(
            amount > 0 &&
                _delegatorInfo[sender].delegatorPerValidator[validator].amount +
                    amount >=
                settings.delegatorsSettings.minimumThreshold,
            "wrong input amount"
        );

        _depositAsDelegator(sender, amount, validator);
    }

    /** @notice claim rewards as validator
     */
    function claimAsValidator() external nonReentrant {
        address sender = _msgSender();
        require(isValidator(sender), "not validator");
        uint256 reward = _claimAsValidator(sender);
        if (reward > 0) _safeTransferETH(sender, reward);
    }

    /** @notice claim rewards as delegator (earned for certain validators deposit)
     * @param validator certain validator address
     */
    function claimAsDelegatorPerValidator(
        address validator
    ) external nonReentrant {
        address sender = _msgSender();
        require(
            _delegatorInfo[sender].validators.contains(validator),
            "wrong validator"
        );
        uint256 reward = _claimAsDelegatorPerValidator(sender, validator, true);
        if (reward > 0) _safeTransferETH(sender, reward);
    }

    /** @notice restake rewards as validator
     */
    function restakeAsValidator() external nonReentrant {
        address sender = _msgSender();
        require(isValidator(sender), "not validator");
        uint256 reward = _claimAsValidator(sender);
        require(reward > 0, "zero");
        _depositAsValidator(sender, reward, 0); // not set zero commission, but keeps previous value
    }

    /** @notice restake rewards as delegator (earned for certain validators deposit)
     * @param validator certain validator address
     */
    function restakeAsDelegator(address validator) external nonReentrant {
        address sender = _msgSender();
        require(
            _delegatorInfo[sender].validators.contains(validator),
            "wrong validator"
        );
        uint256 reward = _claimAsDelegatorPerValidator(sender, validator, true);
        require(reward > 0, "zero");
        _depositAsDelegator(sender, reward, validator);
    }

    /// @notice sign up to a stop list as validator (will be able to withdraw deposit after cooldown)
    function validatorCallForWithdraw() external nonReentrant {
        address sender = _msgSender();
        require(
            isValidator(sender) &&
                _validatorInfo[sender].calledForWithdraw == 0,
            "not active validator"
        );

        _validatorCallForWithdraw(sender);
    }

    /// @notice sign up to a stop list as delegator (will be able to withdraw deposit after cooldown) for certain validator
    /// @param validator address
    function delegatorCallForWithdraw(address validator) external nonReentrant {
        address sender = _msgSender();
        require(
            isDelegator(sender) &&
                _delegatorInfo[sender].validators.contains(validator) &&
                _delegatorInfo[sender]
                    .delegatorPerValidator[validator]
                    .calledForWithdraw ==
                0,
            "not active delegator"
        );

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
        require(
            isValidator(sender) && _validatorInfo[sender].calledForWithdraw > 0,
            "no withdraw call"
        );
        require(
            _validatorInfo[sender].amount + msg.value >=
                settings.validatorsSettings.minimumThreshold,
            "too low value"
        );
        require(
            _validators.length() < settings.validatorsLimit,
            "limit reached"
        );

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

        require(
            isDelegator(sender) &&
                info.amount + msg.value >=
                settings.delegatorsSettings.minimumThreshold &&
                info.calledForWithdraw > 0 &&
                _validatorInfo[validator].calledForWithdraw == 0,
            "can not revive"
        );

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
        require(
            _validatorInfo[validator].calledForWithdraw == 0,
            "in stop"
        );

        // update rewards
        _updateValidatorReward(validator);

        if (!_validators.contains(validator)) {
            require(
                commission <= 30_00 && commission >= 5_00,
                "commission"
            );

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
        require(
            _delegatorInfo[delegator]
                .delegatorPerValidator[validator]
                .calledForWithdraw == 0,
            "in stop"
        );

        require(
            _validators.contains(validator),
            "wrong validator"
        ); // necessary to choose only active validator

        if (!_delegatorInfo[delegator].validators.contains(validator)) {
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

        require(
            forFixedReward >= toClaim,
            "not enough coins for fixed rewards"
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
                    testTime,
                "claim cooldown"
            );

            _validatorInfo[validator].lastClaim = testTime;
            delete _validatorInfo[validator].fixedReward.fixedReward;
            delete _validatorInfo[validator].variableReward.variableReward;
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

        require(
            forFixedReward >= toClaim,
            "not enough coins for fixed rewards"
        );

        forFixedReward -= toClaim;
        info.fixedReward.totalClaimed += toClaim;
        toClaim += info.variableReward.variableReward;
        info.variableReward.totalClaimed += info.variableReward.variableReward;

        if (toClaim > 0 && checkCooldown) {
            require(
                info.lastClaim + settings.delegatorsSettings.claimCooldown <=
                    testTime,
                "claim cooldown"
            );
            info.lastClaim = testTime;
            delete info.fixedReward.fixedReward;
            delete info.variableReward.variableReward;
        }

        emit DelegatorClaimed(delegator, toClaim);
    }

    function _validatorCallForWithdraw(address sender) internal {
        _updateValidatorReward(sender);

        _validatorInfo[sender].calledForWithdraw = testTime;
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

    function _delegatorCallForWithdraw(
        address sender,
        address validator
    ) internal {
        _updateDelegatorRewardPerValidator(sender, validator);

        _delegatorInfo[sender]
            .delegatorPerValidator[validator]
            .calledForWithdraw = testTime;

        if (_validatorInfo[validator].calledForWithdraw == 0) {
            totalDelegatorsPool -= _delegatorInfo[sender]
                .delegatorPerValidator[validator]
                .amount;
            stoppedDelegatorsPool += _delegatorInfo[sender]
                .delegatorPerValidator[validator]
                .amount;
            _validatorInfo[validator].delegatedAmount -= _delegatorInfo[sender]
                .delegatorPerValidator[validator]
                .amount;
            _validatorInfo[validator].stoppedDelegatedAmount += _delegatorInfo[
                sender
            ].delegatorPerValidator[validator].amount;
        }

        emit DelegatorCalledForWithdraw(sender);
    }

    function _withdrawAsValidator(address validator) internal {
        require(
            _validatorInfo[validator].calledForWithdraw > 0 &&
                _validatorInfo[validator].calledForWithdraw +
                    settings.validatorsSettings.withdrawCooldown <=
                testTime &&
                _validatorInfo[validator].vestingEnd <= testTime,
            "withdraw cooldown"
        );

        address[] memory delegators = _validatorInfo[validator]
            .delegators
            .values();
        uint256 amount;
        for (uint256 i; i < delegators.length; i++) {
            amount = _claimAsDelegatorPerValidator(delegators[i], validator, false);
            amount += _delegatorInfo[delegators[i]]
                .delegatorPerValidator[validator]
                .amount;
            _delegatorInfo[delegators[i]].validators.remove(validator);
            _validatorInfo[validator].delegators.remove(delegators[i]);
            delete _delegatorInfo[delegators[i]].delegatorPerValidator[
                validator
            ];
            _safeTransferETH(delegators[i], amount);

            emit DelegatorWithdrawed(delegators[i]);
        }

        amount = _claimAsValidator(validator);
        amount += _validatorInfo[validator].amount;
        stoppedValidatorsPool -= _validatorInfo[validator].amount;
        stoppedDelegatorsPool -= _validatorInfo[validator]
            .stoppedDelegatedAmount;
        _stopListValidators.remove(validator);

        delete _validatorInfo[validator];
        _safeTransferETH(validator, amount);

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
        require(
            calledForWithdraw > 0,
            "no call for withdraw"
        );

        require(
            calledForWithdraw + settings.delegatorsSettings.withdrawCooldown <=
                testTime,
            "withdraw cooldown"
        );

        uint256 amount = _claimAsDelegatorPerValidator(delegator, validator, true);
        amount += _delegatorInfo[delegator]
            .delegatorPerValidator[validator]
            .amount;

        stoppedDelegatorsPool -= _delegatorInfo[delegator]
            .delegatorPerValidator[validator]
            .amount;
        _validatorInfo[validator].stoppedDelegatedAmount -= _delegatorInfo[
            delegator
        ].delegatorPerValidator[validator].amount;
        _validatorInfo[validator].delegators.remove(delegator);
        _delegatorInfo[delegator].validators.remove(validator);

        delete _delegatorInfo[delegator].delegatorPerValidator[validator];
        _safeTransferETH(delegator, amount);

        emit DelegatorWithdrawed(delegator);
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

    function _safeTransferETH(address _to, uint256 _value) internal {
        (bool success, ) = _to.call{value: _value}(new bytes(0));
        require(success, "native transfer failed");
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
        if (
            _delegatorInfo[delegator]
                .delegatorPerValidator[validator]
                .calledForWithdraw >
            0 &&
            _validatorInfo[validator].calledForWithdraw > 0
        ) {
            return
                Math.min(
                    _delegatorInfo[delegator]
                        .delegatorPerValidator[validator]
                        .calledForWithdraw,
                    _validatorInfo[validator].calledForWithdraw
                );
        } else if (
            _delegatorInfo[delegator]
                .delegatorPerValidator[validator]
                .calledForWithdraw > 0
        ) {
            return
                _delegatorInfo[delegator]
                    .delegatorPerValidator[validator]
                    .calledForWithdraw;
        } else if (_validatorInfo[validator].calledForWithdraw > 0) {
            return _validatorInfo[validator].calledForWithdraw;
        } else return 0;
    }
}
