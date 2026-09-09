// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice The narrow vault capability surface reachable from a Revnet operator.
interface IProjectComputeVault {
    /// @notice The sole policy allowed to allocate and administer inference authentication.
    /// @return policy The policy address.
    function POLICY() external view returns (address policy);

    /// @notice The underlying asset held for this project's compute.
    /// @return token The VVV token.
    function VVV() external view returns (IERC20 token);

    /// @notice Pull and deploy exactly the approved VVV into compute backing.
    /// @param vvvAmount VVV to deploy, in token base units.
    /// @param minDiemOut Minimum minted DIEM, in token base units.
    function allocate(uint256 vvvAmount, uint256 minDiemOut) external;

    /// @notice Stop allocation and begin the published recovery notice.
    function announceWinddown() external;

    /// @notice Enable or disable provider authentication independently of asset recovery.
    /// @param enabled Whether authentication should be enabled.
    function setAuthenticationEnabled(bool enabled) external;

    /// @notice Replace the isolated signer used for provider sign-in.
    /// @param signer The signer with inference authority only.
    function setInferenceSigner(address signer) external;
}
