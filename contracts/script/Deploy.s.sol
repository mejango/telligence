// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IREVDeployer} from "@rev-net/core-v6/src/interfaces/IREVDeployer.sol";

import {TelligenceComputeVaultDeployer} from "../src/TelligenceComputeVaultDeployer.sol";
import {TelligenceFactory} from "../src/TelligenceFactory.sol";
import {ITelligenceComputeVaultDeployer} from "../src/interfaces/ITelligenceComputeVaultDeployer.sol";
import {IVeniceDiem} from "../src/interfaces/IVeniceDiem.sol";
import {IVeniceStaking} from "../src/interfaces/IVeniceStaking.sol";

/// @notice Simulates deployment of the reviewed immutable adapter and factory against existing Base contracts.
/// @dev Broadcasting is an explicit Foundry CLI action. No project is launched and no backing assets are moved here.
contract Deploy is Script {
    //*********************************************************************//
    // --------------------------- custom errors ------------------------- //
    //*********************************************************************//

    /// @notice The script is running against an unsupported network or unreviewed protocol runtime.
    error Deploy_UnreviewedIntegration();

    //*********************************************************************//
    // ------------------------ private constants ------------------------ //
    //*********************************************************************//

    /// @notice The canonical Base VVV asset.
    address private constant _VVV = 0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf;
    /// @notice The observed Base Venice staking proxy.
    address private constant _STAKING = 0x321b7ff75154472B18EDb199033fF4D116F340Ff;
    /// @notice The observed Base DIEM contract.
    address private constant _DIEM = 0xF4d97F2da56e8c3098f3a8D538DB630A2606a024;
    /// @notice The reviewed implementation behind the staking proxy.
    address private constant _STAKING_IMPLEMENTATION = 0xe37A7920dbc11253ac6d031C29f592f71B348DCA;
    /// @notice The EIP-1967 implementation slot used by the pinned staking proxy.
    bytes32 private constant _IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    //*********************************************************************//
    // ---------------------- external transactions ---------------------- //
    //*********************************************************************//

    /// @notice Validate reviewed integration runtimes, then construct the two immutable deployment contracts.
    /// @return factory The deployed factory, for a reviewed deployment manifest.
    /// @return vaultDeployer The deployed immutable provider adapter deployer.
    function run() external returns (TelligenceFactory factory, TelligenceComputeVaultDeployer vaultDeployer) {
        address revnetDeployer = vm.envAddress("REVNET_DEPLOYER");
        bytes32 reviewedRuntimeHash = vm.envBytes32("REVNET_DEPLOYER_CODEHASH");
        if (
            block.chainid != 8453 || reviewedRuntimeHash == bytes32(0) || revnetDeployer.code.length == 0
                || revnetDeployer.codehash != reviewedRuntimeHash || _STAKING.code.length == 0 || _DIEM.code.length == 0
                || vm.load(_STAKING, _IMPLEMENTATION_SLOT) != bytes32(uint256(uint160(_STAKING_IMPLEMENTATION)))
        ) revert Deploy_UnreviewedIntegration();

        // Foundry only sends these transactions when the caller deliberately supplies --broadcast.
        vm.startBroadcast();
        vaultDeployer = new TelligenceComputeVaultDeployer({
            vvv: IERC20(_VVV), staking: IVeniceStaking(_STAKING), diem: IVeniceDiem(_DIEM)
        });
        factory = new TelligenceFactory({
            revnetDeployer: IREVDeployer(revnetDeployer),
            vaultDeployer: ITelligenceComputeVaultDeployer(address(vaultDeployer))
        });
        vm.stopBroadcast();
    }
}
