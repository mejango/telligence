// Generated from contracts/out by npm run abi:generate.
export const ProjectPolicyAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "factory",
        type: "address",
        internalType: "address",
      },
      {
        name: "creator",
        type: "address",
        internalType: "address",
      },
      {
        name: "recovery",
        type: "address",
        internalType: "address",
      },
      {
        name: "controller",
        type: "address",
        internalType: "contract IJBController",
      },
      {
        name: "terminal",
        type: "address",
        internalType: "contract IJBTerminal",
      },
      {
        name: "vvv",
        type: "address",
        internalType: "contract IERC20",
      },
      {
        name: "configuration",
        type: "tuple",
        internalType: "struct TelligencePolicyConfig",
        components: [
          {
            name: "conversionCadence",
            type: "uint48",
            internalType: "uint48",
          },
          {
            name: "minBatchTokens",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "maxBatchTokens",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "minVVVPerProjectToken",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "minDiemPerVVV",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "maxPrincipal",
            type: "uint128",
            internalType: "uint128",
          },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "CONTROLLER",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IJBController",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "CREATOR",
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
    name: "FACTORY",
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
    name: "MAX_DEADLINE_WINDOW",
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
    name: "RECOVERY",
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
    name: "TERMINAL",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IJBTerminal",
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
    name: "allocate",
    inputs: [
      {
        name: "vvvAmount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "deadline",
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
    name: "bind",
    inputs: [
      {
        name: "projectId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "computeVault",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "burnLateProduction",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cashOutProduction",
    inputs: [
      {
        name: "tokenCount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "vvvReceived",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "conversionCadence",
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
    name: "maxBatchTokens",
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
    name: "maxPrincipal",
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
    name: "minBatchTokens",
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
    name: "minDiemPerVVV",
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
    name: "minVVVPerProjectToken",
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
    name: "nextConversionAt",
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
    name: "raiseMinimumOutputs",
    inputs: [
      {
        name: "vvvFloor",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "diemFloor",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "returnToRevnet",
    inputs: [
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "returnUnallocatedVVV",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revnetId",
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
    name: "vault",
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
    name: "windingDown",
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
    type: "event",
    name: "Allocate",
    inputs: [
      {
        name: "revnetId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "vvvAmount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "totalAllocated",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "AnnounceWinddown",
    inputs: [
      {
        name: "revnetId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "caller",
        type: "address",
        indexed: false,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Bind",
    inputs: [
      {
        name: "revnetId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "vault",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "CashOutProduction",
    inputs: [
      {
        name: "revnetId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "tokenCount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "vvvReceived",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "caller",
        type: "address",
        indexed: false,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RaiseMinimumOutputs",
    inputs: [
      {
        name: "minVVVPerProjectToken",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "minDiemPerVVV",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ReturnToRevnet",
    inputs: [
      {
        name: "revnetId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "SetAllocationPaused",
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
        indexed: false,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "ProjectPolicy_AllocationLimit",
    inputs: [],
  },
  {
    type: "error",
    name: "ProjectPolicy_AllocationStopped",
    inputs: [],
  },
  {
    type: "error",
    name: "ProjectPolicy_AlreadyBound",
    inputs: [],
  },
  {
    type: "error",
    name: "ProjectPolicy_InsufficientOutput",
    inputs: [],
  },
  {
    type: "error",
    name: "ProjectPolicy_InvalidBatch",
    inputs: [],
  },
  {
    type: "error",
    name: "ProjectPolicy_InvalidConfiguration",
    inputs: [],
  },
  {
    type: "error",
    name: "ProjectPolicy_InvalidDeadline",
    inputs: [],
  },
  {
    type: "error",
    name: "ProjectPolicy_NotBound",
    inputs: [],
  },
  {
    type: "error",
    name: "ProjectPolicy_NothingToReturn",
    inputs: [],
  },
  {
    type: "error",
    name: "ProjectPolicy_TooEarly",
    inputs: [],
  },
  {
    type: "error",
    name: "ProjectPolicy_Unauthorized",
    inputs: [],
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
] as const;
