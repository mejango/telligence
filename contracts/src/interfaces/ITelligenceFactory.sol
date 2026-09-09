// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {REVDescription} from "@rev-net/core-v6/src/structs/REVDescription.sol";
import {ProjectPolicy} from "../ProjectPolicy.sol";
import {TelligenceComputeVault} from "../TelligenceComputeVault.sol";
import {TelligencePolicyConfig} from "../structs/TelligencePolicyConfig.sol";
import {TelligenceStageConfig} from "../structs/TelligenceStageConfig.sol";

/// @notice Atomically launches Base compute endowments on unchanged Revnet contracts.
interface ITelligenceFactory {
    /// @notice Emitted only after stock Revnet deployment and immutable policy/vault binding succeed.
    /// @param revnetId The newly deployed Revnet ID.
    /// @param creator The creator who submitted the launch.
    /// @param policy The sole Revnet operator and compute production beneficiary.
    /// @param vault The dedicated compute vault.
    /// @param policyHash A commitment to the deployment's immutable economic and identity configuration.
    event DeployProject(
        uint256 indexed revnetId, address indexed creator, address policy, address vault, bytes32 policyHash
    );

    /// @notice The creator associated with a registered project.
    /// @param revnetId The Revnet ID.
    /// @return creator The creator, or zero for an unregistered project.
    function creatorOf(uint256 revnetId) external view returns (address creator);

    /// @notice The exact launch fee required by the stock project registry.
    /// @return fee Native Base ETH required for project creation.
    function creationFee() external view returns (uint256 fee);

    /// @notice The immutable deployment-configuration commitment.
    /// @param revnetId The Revnet ID.
    /// @return policyHash The launch commitment, or zero for an unregistered project.
    function policyHashOf(uint256 revnetId) external view returns (bytes32 policyHash);

    /// @notice The bound policy for a project launched through this factory.
    /// @param revnetId The Revnet ID.
    /// @return policy The policy, or zero for an unregistered project.
    function policyOf(uint256 revnetId) external view returns (address policy);

    /// @notice The dedicated compute vault for a registered project.
    /// @param revnetId The Revnet ID.
    /// @return vault The vault, or zero for an unregistered project.
    function vaultOf(uint256 revnetId) external view returns (address vault);

    /// @notice Launch a Revnet with fixed VVV accounting, production routing, and return-only backing.
    /// @dev The caller is the creator. Every stage's routing is constructed internally and cannot be supplied by
    /// clients. The optional creator allocation goes to the caller with ordinary token cashout rights.
    /// @param description The project's name, ticker, URI and deployment salt.
    /// @param stages The immutable stage economics.
    /// @param policyConfiguration The bounded investment policy disclosed to supporters.
    /// @param recovery The return-only recovery authority.
    /// @param inferenceSigner The dedicated signer allowed to authenticate for compute only.
    /// @return revnetId The stock Revnet's ID.
    /// @return policy The deployed policy operator.
    /// @return vault The deployed compute vault.
    function deployFor(
        REVDescription memory description,
        TelligenceStageConfig[] memory stages,
        TelligencePolicyConfig memory policyConfiguration,
        address recovery,
        address inferenceSigner
    )
        external
        payable
        returns (uint256 revnetId, ProjectPolicy policy, TelligenceComputeVault vault);
}
