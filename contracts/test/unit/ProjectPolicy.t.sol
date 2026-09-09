// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IJBController} from "@bananapus/core-v6/src/interfaces/IJBController.sol";
import {IJBTerminal} from "@bananapus/core-v6/src/interfaces/IJBTerminal.sol";
import {IJBTokens} from "@bananapus/core-v6/src/interfaces/IJBTokens.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ProjectPolicy} from "../../src/ProjectPolicy.sol";
import {TelligencePolicyConfig} from "../../src/structs/TelligencePolicyConfig.sol";

contract PolicyToken is ERC20 {
    constructor() ERC20("VVV", "VVV") {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}

contract PolicyTerminal {
    IERC20 public immutable TOKEN;
    uint256 public output;
    uint256 public reportedOutput;
    uint256 public terminalMinimum;
    uint256 public returnedToProject;
    uint256 public returnProject;

    constructor(IERC20 token) {
        TOKEN = token;
    }

    function configure(uint256 actual, uint256 reported) external {
        output = actual;
        reportedOutput = reported;
    }

    function cashOutTokensOf(
        address holder,
        uint256,
        uint256,
        address,
        uint256 minimum,
        address payable beneficiary,
        bytes calldata metadata
    )
        external
        returns (uint256)
    {
        require(holder == msg.sender && beneficiary == msg.sender && metadata.length == 0);
        terminalMinimum = minimum;
        TOKEN.transfer(beneficiary, output);
        return reportedOutput;
    }

    function addToBalanceOf(
        uint256 projectId,
        address token,
        uint256 amount,
        bool,
        string calldata,
        bytes calldata
    )
        external
        payable
    {
        require(token == address(TOKEN));
        TOKEN.transferFrom(msg.sender, address(this), amount);
        returnProject = projectId;
        returnedToProject += amount;
    }
}

contract PolicyVault {
    address public immutable POLICY;
    IERC20 public immutable VVV;
    uint256 public allocated;
    uint256 public minimum;
    bool public windingDown;
    address public signer;
    bool public authenticationEnabled;

    constructor(address policy, IERC20 token) {
        POLICY = policy;
        VVV = token;
    }

    function allocate(uint256 amount, uint256 minimumDiem) external {
        require(msg.sender == POLICY);
        VVV.transferFrom(msg.sender, address(this), amount);
        allocated += amount;
        minimum = minimumDiem;
    }

    function announceWinddown() external {
        require(msg.sender == POLICY);
        windingDown = true;
    }

    function setInferenceSigner(address value) external {
        require(msg.sender == POLICY);
        signer = value;
    }

    function setAuthenticationEnabled(bool value) external {
        require(msg.sender == POLICY);
        authenticationEnabled = value;
    }

    function returnFunds(uint256 amount) external {
        VVV.approve(POLICY, amount);
        ProjectPolicy(POLICY).returnToRevnet(amount);
    }
}

contract ProjectPolicyTest is Test {
    PolicyToken internal token;
    PolicyTerminal internal terminal;
    PolicyVault internal vault;
    ProjectPolicy internal policy;
    address internal creator = address(0xCAFE);
    address internal recovery = address(0xBEEF);
    address internal controller = address(0xC011);
    address internal tokens = address(0xC012);

    function setUp() public {
        vm.warp(1_000_000);
        token = new PolicyToken();
        terminal = new PolicyTerminal(token);
        vm.mockCall(controller, abi.encodeCall(IJBController.TOKENS, ()), abi.encode(tokens));
        vm.mockCall(tokens, abi.encodeCall(IJBTokens.totalBalanceOf, (address(0), 0)), abi.encode(uint256(0)));
        policy = new ProjectPolicy(
            address(this),
            creator,
            recovery,
            IJBController(controller),
            IJBTerminal(address(terminal)),
            token,
            _config()
        );
        vault = new PolicyVault(address(policy), token);
        policy.bind(42, address(vault));
        _balance(100 ether);
        token.mint(address(terminal), 1000 ether);
        terminal.configure(10 ether, 0);
    }

    function test_OnlyFactoryCanBindAndBindingCannotChange() public {
        vm.expectRevert(ProjectPolicy.ProjectPolicy_AlreadyBound.selector);
        policy.bind(43, address(vault));
        assertEq(policy.revnetId(), 42);
        assertEq(policy.vault(), address(vault));
    }

    function test_ReceivesAMMCashoutWithZeroTerminalReturn() public {
        uint256 received = policy.cashOutProduction(100 ether, block.timestamp + 30);
        assertEq(received, 10 ether);
        assertEq(token.balanceOf(address(policy)), 10 ether);
        assertEq(terminal.terminalMinimum(), 0);
    }

    function test_RejectsInflatedTerminalReturnWithoutRealReceivedVVV() public {
        terminal.configure(0, 100 ether);
        vm.expectRevert(ProjectPolicy.ProjectPolicy_InsufficientOutput.selector);
        policy.cashOutProduction(100 ether, block.timestamp + 30);
    }

    function test_PreexistingDonationCannotSatisfyCashoutFloor() public {
        token.mint(address(policy), 100 ether);
        terminal.configure(1, 100 ether);
        vm.expectRevert(ProjectPolicy.ProjectPolicy_InsufficientOutput.selector);
        policy.cashOutProduction(100 ether, block.timestamp + 30);
    }

    function test_CadenceCannotBeBypassedByAnotherKeeper() public {
        policy.cashOutProduction(100 ether, block.timestamp + 30);
        vm.prank(address(0xBAD));
        vm.expectRevert(ProjectPolicy.ProjectPolicy_TooEarly.selector);
        policy.cashOutProduction(100 ether, block.timestamp + 30);
        vm.warp(block.timestamp + 1 days);
        // Read through the cheatcode after warp; optimizer assumptions treat block.timestamp as transaction-constant.
        policy.cashOutProduction(100 ether, vm.getBlockTimestamp() + 30);
    }

    function test_RejectsTinyKeeperSelectedBatch() public {
        vm.expectRevert(ProjectPolicy.ProjectPolicy_InvalidBatch.selector);
        policy.cashOutProduction(10 ether, block.timestamp + 30);
    }

    function test_RejectsExpiredAndUnboundedDeadlines() public {
        vm.expectRevert(ProjectPolicy.ProjectPolicy_InvalidDeadline.selector);
        policy.cashOutProduction(100 ether, block.timestamp - 1);
        vm.expectRevert(ProjectPolicy.ProjectPolicy_InvalidDeadline.selector);
        policy.cashOutProduction(100 ether, block.timestamp + 2 hours);
    }

    function test_AllocationUsesImmutableMintFloorAndClearsApproval() public {
        token.mint(address(policy), 10 ether);
        policy.allocate(10 ether, block.timestamp + 30);
        assertEq(vault.allocated(), 10 ether);
        assertEq(vault.minimum(), 1 ether);
        assertEq(token.allowance(address(policy), address(vault)), 0);
        assertEq(policy.totalAllocated(), 10 ether);
    }

    function test_LifetimeCapCannotBeExceeded() public {
        token.mint(address(policy), 101 ether);
        vm.expectRevert(ProjectPolicy.ProjectPolicy_AllocationLimit.selector);
        policy.allocate(101 ether, block.timestamp + 30);
    }

    function test_RaisedFloorCannotBeLoweredByCreatorOrKeeper() public {
        vm.prank(creator);
        policy.raiseMinimumOutputs(2e17, 2e17);
        vm.prank(creator);
        vm.expectRevert(ProjectPolicy.ProjectPolicy_InvalidConfiguration.selector);
        policy.raiseMinimumOutputs(1e17, 2e17);
        vm.prank(address(0xBAD));
        vm.expectRevert(ProjectPolicy.ProjectPolicy_Unauthorized.selector);
        policy.raiseMinimumOutputs(3e17, 3e17);
    }

    function test_WinddownStopsCashoutsAndAllocationButPermitsReturns() public {
        vm.prank(creator);
        policy.announceWinddown();
        assertTrue(vault.windingDown());
        vm.expectRevert(ProjectPolicy.ProjectPolicy_AllocationStopped.selector);
        policy.cashOutProduction(100 ether, block.timestamp + 30);
        token.mint(address(vault), 5 ether);
        vault.returnFunds(5 ether);
        assertEq(terminal.returnedToProject(), 5 ether);
        assertEq(terminal.returnProject(), 42);
        assertEq(token.allowance(address(policy), address(terminal)), 0);
    }

    function test_PauseDoesNotPreventRecovery() public {
        vm.prank(recovery);
        policy.setAllocationPaused(true);
        vm.prank(creator);
        policy.announceWinddown();
        assertTrue(vault.windingDown());
    }

    function test_OnlyVaultCanInvokeReturnCallback() public {
        vm.expectRevert(ProjectPolicy.ProjectPolicy_Unauthorized.selector);
        policy.returnToRevnet(1);
    }

    function test_ExcessVVVHasPermissionlessReturnOnlyPath() public {
        token.mint(address(policy), 110 ether);
        policy.allocate(100 ether, block.timestamp + 30);
        policy.returnUnallocatedVVV();
        assertEq(terminal.returnedToProject(), 10 ether);
    }

    function testFuzz_CashoutFloorRoundsUp(uint96 amount) public {
        uint256 count = bound(uint256(amount), 10 ether, 100 ether);
        _balance(count);
        uint256 floor = (count * 1e17 + 1e18 - 1) / 1e18;
        terminal.configure(floor - 1, type(uint256).max);
        vm.expectRevert(ProjectPolicy.ProjectPolicy_InsufficientOutput.selector);
        policy.cashOutProduction(count, block.timestamp + 30);
        terminal.configure(floor, 0);
        assertEq(policy.cashOutProduction(count, block.timestamp + 30), floor);
    }

    function _balance(uint256 count) internal {
        vm.mockCall(tokens, abi.encodeCall(IJBTokens.totalBalanceOf, (address(policy), 42)), abi.encode(count));
    }

    function _config() internal pure returns (TelligencePolicyConfig memory) {
        return TelligencePolicyConfig({
            conversionCadence: 1 days,
            minBatchTokens: 10 ether,
            maxBatchTokens: 100 ether,
            minVVVPerProjectToken: 1e17,
            minDiemPerVVV: 1e17,
            maxPrincipal: 100 ether
        });
    }
}
