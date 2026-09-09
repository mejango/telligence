// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @notice The built-in staking interface of Base DIEM, pinned to verified deployment source.
interface IVeniceDiem is IERC20Metadata {
    function stakedInfos(address user)
        external
        view
        returns (uint256 amountStaked, uint256 coolDownEnd, uint256 coolDownAmount);
    function cooldownDuration() external view returns (uint256);
    function stake(uint256 amount) external;
    function initiateUnstake(uint256 amount) external;
    function unstake() external;
}
