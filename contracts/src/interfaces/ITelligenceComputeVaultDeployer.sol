// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IVeniceStaking} from "./IVeniceStaking.sol";
import {IVeniceDiem} from "./IVeniceDiem.sol";
import {TelligenceComputeVault} from "../TelligenceComputeVault.sol";

/// @notice Deploys immutable project vaults using one pinned, versioned provider integration.
interface ITelligenceComputeVaultDeployer {
    function VVV() external view returns (IERC20);
    function STAKING() external view returns (IVeniceStaking);
    function DIEM() external view returns (IVeniceDiem);
    function deployFor(
        address policy,
        uint256 maxPrincipal,
        address inferenceSigner
    )
        external
        returns (TelligenceComputeVault vault);
}
