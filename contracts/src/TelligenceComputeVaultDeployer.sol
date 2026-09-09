// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TelligenceComputeVault} from "./TelligenceComputeVault.sol";
import {ITelligenceComputeVaultDeployer} from "./interfaces/ITelligenceComputeVaultDeployer.sol";
import {IVeniceDiem} from "./interfaces/IVeniceDiem.sol";
import {IVeniceStaking} from "./interfaces/IVeniceStaking.sol";

/// @notice Deploys the immutable compute adapter separately so project factories stay below EVM code size limits.
/// @dev The canonical Telligence factory validates this deployer against its deployment manifest. Permissionless
/// deployment grants no project identity: only atomically bound vaults in the project factory registry are Telligence
/// projects.
contract TelligenceComputeVaultDeployer is ITelligenceComputeVaultDeployer {
    error TelligenceComputeVaultDeployer_InvalidConfiguration();
    event VaultDeployed(address indexed policy, address indexed vault, address indexed caller);

    IERC20 public immutable override VVV;
    IVeniceStaking public immutable override STAKING;
    IVeniceDiem public immutable override DIEM;

    constructor(IERC20 vvv, IVeniceStaking staking, IVeniceDiem diem) {
        if (
            block.chainid != 8453 || address(vvv).code.length == 0 || address(staking).code.length == 0
                || address(diem).code.length == 0 || staking.venice() != address(vvv) || staking.diem() != address(diem)
        ) revert TelligenceComputeVaultDeployer_InvalidConfiguration();
        VVV = vvv;
        STAKING = staking;
        DIEM = diem;
    }

    /// @inheritdoc ITelligenceComputeVaultDeployer
    function deployFor(
        address policy,
        uint256 maxPrincipal,
        address inferenceSigner
    )
        external
        override
        returns (TelligenceComputeVault vault)
    {
        vault = new TelligenceComputeVault({
            policy: policy,
            vvv: VVV,
            staking: STAKING,
            diem: DIEM,
            maxPrincipal: maxPrincipal,
            winddownNotice: 7 days,
            inferenceSigner: inferenceSigner
        });
        emit VaultDeployed({policy: policy, vault: address(vault), caller: msg.sender});
    }
}
