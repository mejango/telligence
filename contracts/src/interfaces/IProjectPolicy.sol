// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice Routes a Revnet's production allocation into a bounded compute endowment.
interface IProjectPolicy {
    /// @notice Emitted when identity is atomically bound by the deployment factory.
    /// @param revnetId The immutable Revnet ID.
    /// @param vault The immutable compute vault.
    event Bind(uint256 indexed revnetId, address indexed vault);

    /// @notice Emitted after production tokens produce actual VVV receipts.
    /// @param revnetId The Revnet whose tokens were cashed out.
    /// @param tokenCount Tokens consumed by the cashout.
    /// @param vvvReceived Actual VVV received, including hook-delivered proceeds.
    /// @param caller The permissionless executor.
    event CashOutProduction(uint256 indexed revnetId, uint256 tokenCount, uint256 vvvReceived, address caller);

    /// @notice Emitted when VVV is committed to the project's vault.
    /// @param revnetId The Revnet receiving compute capacity.
    /// @param vvvAmount VVV committed.
    /// @param totalAllocated Cumulative committed principal.
    event Allocate(uint256 indexed revnetId, uint256 vvvAmount, uint256 totalAllocated);

    /// @notice Emitted after value returns to the same Revnet without token issuance.
    /// @param revnetId The Revnet whose terminal balance increased.
    /// @param amount VVV returned.
    event ReturnToRevnet(uint256 indexed revnetId, uint256 amount);

    /// @notice Emitted when a return-only winddown begins.
    /// @param revnetId The Revnet winding down.
    /// @param caller The creator or recovery address initiating notice.
    event AnnounceWinddown(uint256 indexed revnetId, address caller);

    /// @notice Emitted when allocation and cashout execution are paused or resumed.
    /// @param paused The pause state.
    /// @param caller The creator or recovery address.
    event SetAllocationPaused(bool paused, address caller);

    /// @notice Emitted when output floors are tightened.
    /// @param minVVVPerProjectToken The cashout ratio floor, scaled by 1e18.
    /// @param minDiemPerVVV The DIEM mint ratio floor, scaled by 1e18.
    event RaiseMinimumOutputs(uint256 minVVVPerProjectToken, uint256 minDiemPerVVV);

    /// @notice The permanently bound Revnet ID.
    /// @return projectId The Revnet ID.
    function revnetId() external view returns (uint256 projectId);

    /// @notice The permanently bound vault.
    /// @return computeVault The vault address.
    function vault() external view returns (address computeVault);

    /// @notice Deploy held VVV subject to the lifetime cap and mint floor.
    /// @param vvvAmount The exact VVV amount to deploy.
    /// @param deadline The execution expiry, at most one hour ahead.
    function allocate(uint256 vvvAmount, uint256 deadline) external;

    /// @notice Announce the irrevocable return-only winddown.
    function announceWinddown() external;

    /// @notice Bind the factory-created identity once, within the launch transaction.
    /// @param projectId The stock Revnet's ID.
    /// @param computeVault The matching project vault.
    function bind(uint256 projectId, address computeVault) external;

    /// @notice Burn late production tokens after winddown or completion of the allocation cap.
    function burnLateProduction() external;

    /// @notice Cash out the required batch using standard Revnet routing.
    /// @param tokenCount The exact required production batch.
    /// @param deadline The execution expiry, at most one hour ahead.
    /// @return vvvReceived Actual received VVV, measured independently of the terminal return value.
    function cashOutProduction(uint256 tokenCount, uint256 deadline) external returns (uint256 vvvReceived);

    /// @notice Tighten execution floors; lowering either floor is forbidden.
    /// @param vvvFloor Minimum VVV per project token, scaled by 1e18.
    /// @param diemFloor Minimum DIEM per VVV, scaled by 1e18.
    function raiseMinimumOutputs(uint256 vvvFloor, uint256 diemFloor) external;

    /// @notice Pull recovered VVV from the immutable vault and add it to the Revnet balance.
    /// @param amount VVV available under the vault's exact allowance.
    function returnToRevnet(uint256 amount) external;

    /// @notice Return held VVV exceeding the allocation cap, or all held VVV during winddown.
    function returnUnallocatedVVV() external;

    /// @notice Pause or resume fresh compute investment independently of recovery.
    /// @param paused The requested pause state.
    function setAllocationPaused(bool paused) external;

    /// @notice Enable or disable the vault's provider authentication.
    /// @param enabled Whether authentication should be enabled.
    function setAuthenticationEnabled(bool enabled) external;

    /// @notice Rotate the vault's inference signer without exposing operator authority.
    /// @param signer The replacement inference signer.
    function setInferenceSigner(address signer) external;
}
