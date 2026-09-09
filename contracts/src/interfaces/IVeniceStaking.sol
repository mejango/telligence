// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @notice The exact Base Venice StakingV2 interface used by the compute vault.
/// @dev Verified implementation 0xe37A7920dbc11253ac6d031C29f592f71B348DCA; upstream is upgradeable.
interface IVeniceStaking is IERC20Metadata {
    function venice() external view returns (address);
    function diem() external view returns (address);
    function balanceOfUnlocked(address user) external view returns (uint256);
    function lockedStakes(address user) external view returns (uint256 sVVVLockedAmount, uint256 outstandingDiemAmount);
    function stakes(address user)
        external
        view
        returns (uint256 rewardDebt, uint256 cooldownEnd, uint256 cooldownAmount);
    function cooldownDuration() external view returns (uint256);
    function getDiemAmountOut(uint256 sVVVAmountToLock) external view returns (uint256);
    function stake(address recipient, uint256 amount) external;
    function mintDiem(uint256 sVVVAmountToLock, uint256 minDiemAmountOut) external;
    function burnDiem(uint256 diemAmountToBurn) external;
    function claim() external;
    function initiateUnstake(uint256 amount) external;
    function finalizeUnstake() external;
}
