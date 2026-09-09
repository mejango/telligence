// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TelligenceComputeVault} from "../../src/TelligenceComputeVault.sol";

contract VaultVVVMock is ERC20 {
    constructor() ERC20("Venice", "VVV") {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}

contract VaultDiemMock is ERC20 {
    struct Stake {
        uint256 amountStaked;
        uint256 coolDownEnd;
        uint256 coolDownAmount;
    }
    mapping(address => Stake) public stakedInfos;
    uint256 public cooldownDuration = 1 days;
    address public minter;
    constructor() ERC20("Diem", "DIEM") {}

    function setMinter(address account) external {
        minter = account;
    }

    function setCooldownDuration(uint256 duration) external {
        cooldownDuration = duration;
    }

    function mint(address account, uint256 amount) external {
        require(msg.sender == minter);
        _mint(account, amount);
    }

    function burn(address account, uint256 amount) external {
        require(msg.sender == minter);
        _burn(account, amount);
    }

    function stake(uint256 amount) external {
        require(amount > 0);
        stakedInfos[msg.sender].amountStaked += amount;
        _transfer(msg.sender, address(this), amount);
    }

    function initiateUnstake(uint256 amount) external {
        require(amount > 0);
        Stake storage info = stakedInfos[msg.sender];
        info.amountStaked -= amount;
        info.coolDownAmount += amount;
        info.coolDownEnd = block.timestamp + cooldownDuration;
    }

    function unstake() external {
        Stake storage info = stakedInfos[msg.sender];
        require(info.coolDownAmount > 0 && block.timestamp >= info.coolDownEnd);
        uint256 amount = info.coolDownAmount;
        info.coolDownAmount = 0;
        info.coolDownEnd = 0;
        _transfer(address(this), msg.sender, amount);
    }
}

contract VaultStakingMock is ERC20 {
    struct Stake {
        uint256 rewardDebt;
        uint256 cooldownEnd;
        uint256 cooldownAmount;
    }

    struct Locked {
        uint256 sVVVLockedAmount;
        uint256 outstandingDiemAmount;
    }
    mapping(address => Stake) public stakes;
    mapping(address => Locked) public lockedStakes;
    mapping(address => uint256) public rewards;
    VaultVVVMock public immutable venice;
    VaultDiemMock public immutable diem;
    uint256 public mintRate = 3e18;
    uint256 public cooldownDuration = 7 days;
    bool public badStake;
    bool public failMint;

    constructor(VaultVVVMock token, VaultDiemMock diemToken) ERC20("Staked Venice", "sVVV") {
        venice = token;
        diem = diemToken;
    }

    function setRate(uint256 rate) external {
        mintRate = rate;
    }

    function setBadStake(bool flag) external {
        badStake = flag;
    }

    function setFailMint(bool flag) external {
        failMint = flag;
    }

    function setCooldownDuration(uint256 duration) external {
        cooldownDuration = duration;
    }

    function setReward(address account, uint256 amount) external {
        rewards[account] = amount;
        venice.mint(address(this), amount);
    }

    function getDiemAmountOut(uint256 amount) public view returns (uint256) {
        return amount * 1e18 / mintRate;
    }

    function balanceOfUnlocked(address user) public view returns (uint256) {
        return balanceOf(user) - lockedStakes[user].sVVVLockedAmount;
    }

    function stake(address recipient, uint256 amount) external {
        require(amount > 0);
        _claim(recipient);
        venice.transferFrom(msg.sender, address(this), amount);
        _mint(recipient, badStake ? amount - 1 : amount);
    }

    function mintDiem(uint256 amount, uint256 minimum) external {
        require(!failMint && amount > 0 && balanceOfUnlocked(msg.sender) >= amount);
        _claim(msg.sender);
        uint256 minted = getDiemAmountOut(amount);
        require(minted >= minimum);
        lockedStakes[msg.sender].sVVVLockedAmount += amount;
        lockedStakes[msg.sender].outstandingDiemAmount += minted;
        diem.mint(msg.sender, minted);
    }

    function burnDiem(uint256 amount) external {
        require(amount > 0);
        _claim(msg.sender);
        Locked storage locked = lockedStakes[msg.sender];
        uint256 unlocked = amount * locked.sVVVLockedAmount / locked.outstandingDiemAmount;
        locked.sVVVLockedAmount -= unlocked;
        locked.outstandingDiemAmount -= amount;
        diem.burn(msg.sender, amount);
    }

    function claim() external {
        _claim(msg.sender);
    }

    function _claim(address account) internal {
        uint256 amount = rewards[account];
        rewards[account] = 0;
        if (amount > 0) venice.transfer(account, amount);
    }

    function initiateUnstake(uint256 amount) external {
        require(amount > 0 && balanceOfUnlocked(msg.sender) >= amount && stakes[msg.sender].cooldownAmount == 0);
        _claim(msg.sender);
        _burn(msg.sender, amount);
        stakes[msg.sender].cooldownEnd = block.timestamp + cooldownDuration;
        stakes[msg.sender].cooldownAmount = amount;
    }

    function finalizeUnstake() external {
        Stake storage info = stakes[msg.sender];
        require(info.cooldownAmount > 0 && block.timestamp >= info.cooldownEnd);
        uint256 amount = info.cooldownAmount;
        info.cooldownAmount = 0;
        info.cooldownEnd = 0;
        venice.transfer(msg.sender, amount);
    }
}

contract VaultPolicyMock {
    IERC20 public immutable VVV;
    address public immutable destination;
    TelligenceComputeVault public vault;
    bool public reenter;
    bool public rejectReturn;
    uint256 public totalReturned;

    constructor(IERC20 token, address reserve) {
        VVV = token;
        destination = reserve;
    }

    function bind(TelligenceComputeVault target) external {
        require(address(vault) == address(0));
        vault = target;
    }

    function setRejectReturn(bool flag) external {
        rejectReturn = flag;
    }

    function setReenter(bool flag) external {
        reenter = flag;
    }

    function allocate(uint256 amount, uint256 minimum) external {
        VVV.approve(address(vault), amount);
        vault.allocate(amount, minimum);
        VVV.approve(address(vault), 0);
    }

    function announceWinddown() external {
        vault.announceWinddown();
    }

    function setAllocationPaused(bool paused) external {
        vault.setAllocationPaused(paused);
    }

    function returnToRevnet(uint256 amount) external {
        require(msg.sender == address(vault) && !rejectReturn);
        if (reenter) vault.returnLiquidVVV();
        VVV.transferFrom(msg.sender, destination, amount);
        totalReturned += amount;
    }
}
