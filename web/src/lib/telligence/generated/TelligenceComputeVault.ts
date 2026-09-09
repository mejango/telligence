// Generated from contracts/out by npm run abi:generate.
export const TelligenceComputeVaultAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "policy",
        type: "address",
        internalType: "address",
      },
      {
        name: "vvv",
        type: "address",
        internalType: "contract IERC20",
      },
      {
        name: "staking",
        type: "address",
        internalType: "contract IVeniceStaking",
      },
      {
        name: "diem",
        type: "address",
        internalType: "contract IVeniceDiem",
      },
      {
        name: "maxPrincipal",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "winddownNotice",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "inferenceSigner",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "AUTH_POLICY",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "DIEM",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IVeniceDiem",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_AUTH_LIFETIME_MS",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_PRINCIPAL",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "POLICY",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "STAKING",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IVeniceStaking",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "VVV",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IERC20",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "WINDDOWN_NOTICE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allocate",
    inputs: [
      {
        name: "vvvAmount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minDiemOut",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allocationPaused",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "announceWinddown",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "authenticationEnabled",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "authenticationPermanentlyDisabled",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "beginDiemUnstake",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimDiemAndBeginVVVUnstake",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimRewardsAndReturn",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimVVVAndReturn",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "inferenceSigner",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isValidSignature",
    inputs: [
      {
        name: "hash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "signature",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [
      {
        name: "magicValue",
        type: "bytes4",
        internalType: "bytes4",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "noticeEndsAt",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "quoteDiem",
    inputs: [
      {
        name: "vvvAmount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "recoverDonatedStake",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "returnLiquidVVV",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAllocationPaused",
    inputs: [
      {
        name: "paused",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAuthenticationEnabled",
    inputs: [
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setInferenceSigner",
    inputs: [
      {
        name: "signer",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "signerGeneration",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "state",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "enum TelligenceVaultState",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalAllocated",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalReturned",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "Allocated",
    inputs: [
      {
        name: "vvvAmount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "diemAmount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "caller",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "AllocationPauseSet",
    inputs: [
      {
        name: "paused",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
      {
        name: "caller",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ReturnedToRevnet",
    inputs: [
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "caller",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "SetAuthenticationEnabled",
    inputs: [
      {
        name: "enabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
      {
        name: "permanentlyDisabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
      {
        name: "generation",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "SetInferenceSigner",
    inputs: [
      {
        name: "signer",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "generation",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "WinddownAdvanced",
    inputs: [
      {
        name: "state",
        type: "uint8",
        indexed: false,
        internalType: "enum TelligenceVaultState",
      },
      {
        name: "caller",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "WinddownAnnounced",
    inputs: [
      {
        name: "noticeEndsAt",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "caller",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "ReentrancyGuardReentrantCall",
    inputs: [],
  },
  {
    type: "error",
    name: "SafeERC20FailedOperation",
    inputs: [
      {
        name: "token",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "StringsInsufficientHexLength",
    inputs: [
      {
        name: "value",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "length",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "TelligenceComputeVault_AllocationPaused",
    inputs: [],
  },
  {
    type: "error",
    name: "TelligenceComputeVault_Cooldown",
    inputs: [
      {
        name: "currentTime",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "readyAt",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "TelligenceComputeVault_InvalidAmount",
    inputs: [
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimum",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "TelligenceComputeVault_InvalidConfiguration",
    inputs: [],
  },
  {
    type: "error",
    name: "TelligenceComputeVault_InvalidState",
    inputs: [
      {
        name: "current",
        type: "uint8",
        internalType: "enum TelligenceVaultState",
      },
      {
        name: "required",
        type: "uint8",
        internalType: "enum TelligenceVaultState",
      },
    ],
  },
  {
    type: "error",
    name: "TelligenceComputeVault_NoDonatedStake",
    inputs: [],
  },
  {
    type: "error",
    name: "TelligenceComputeVault_PrincipalLimit",
    inputs: [
      {
        name: "allocated",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "maximum",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "TelligenceComputeVault_Unauthorized",
    inputs: [
      {
        name: "caller",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "TelligenceComputeVault_UnexpectedBalance",
    inputs: [
      {
        name: "token",
        type: "address",
        internalType: "address",
      },
      {
        name: "expected",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "actual",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "TelligenceComputeVault_UnexpectedPosition",
    inputs: [],
  },
  {
    type: "error",
    name: "TelligenceVeniceAuth_AuthenticationPermanentlyDisabled",
    inputs: [],
  },
  {
    type: "error",
    name: "TelligenceVeniceAuth_InvalidPolicy",
    inputs: [],
  },
  {
    type: "error",
    name: "TelligenceVeniceAuth_InvalidSigner",
    inputs: [],
  },
  {
    type: "error",
    name: "TelligenceVeniceAuth_Unauthorized",
    inputs: [
      {
        name: "caller",
        type: "address",
        internalType: "address",
      },
    ],
  },
] as const;
