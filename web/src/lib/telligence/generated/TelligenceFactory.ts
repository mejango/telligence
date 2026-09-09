// Generated from contracts/out by npm run abi:generate.
export const TelligenceFactoryAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "revnetDeployer",
        type: "address",
        internalType: "contract IREVDeployer",
      },
      {
        name: "vaultDeployer",
        type: "address",
        internalType: "contract ITelligenceComputeVaultDeployer",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "CHAIN_ID",
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
    name: "MAX_STAGES",
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
    name: "POLICY_VERSION",
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
    name: "REV_DEPLOYER",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IREVDeployer",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "VAULT_DEPLOYER",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract ITelligenceComputeVaultDeployer",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "VVV_ADDRESS",
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
    name: "creationFee",
    inputs: [],
    outputs: [
      {
        name: "fee",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "creatorOf",
    inputs: [
      {
        name: "revnetId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "creator",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "deployFor",
    inputs: [
      {
        name: "description",
        type: "tuple",
        internalType: "struct REVDescription",
        components: [
          {
            name: "name",
            type: "string",
            internalType: "string",
          },
          {
            name: "ticker",
            type: "string",
            internalType: "string",
          },
          {
            name: "uri",
            type: "string",
            internalType: "string",
          },
          {
            name: "salt",
            type: "bytes32",
            internalType: "bytes32",
          },
        ],
      },
      {
        name: "stages",
        type: "tuple[]",
        internalType: "struct TelligenceStageConfig[]",
        components: [
          {
            name: "startsAtOrAfter",
            type: "uint48",
            internalType: "uint48",
          },
          {
            name: "splitPercent",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "initialIssuance",
            type: "uint112",
            internalType: "uint112",
          },
          {
            name: "issuanceCutFrequency",
            type: "uint32",
            internalType: "uint32",
          },
          {
            name: "issuanceCutPercent",
            type: "uint32",
            internalType: "uint32",
          },
          {
            name: "cashOutTaxRate",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "operatorSplitPercent",
            type: "uint16",
            internalType: "uint16",
          },
        ],
      },
      {
        name: "policyConfiguration",
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
      {
        name: "recovery",
        type: "address",
        internalType: "address",
      },
      {
        name: "inferenceSigner",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "revnetId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "policy",
        type: "address",
        internalType: "contract ProjectPolicy",
      },
      {
        name: "vault",
        type: "address",
        internalType: "contract TelligenceComputeVault",
      },
    ],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "originalPayer",
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
    name: "policyHashOf",
    inputs: [
      {
        name: "revnetId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "policyHash",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "policyOf",
    inputs: [
      {
        name: "revnetId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "policy",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "vaultOf",
    inputs: [
      {
        name: "revnetId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "vault",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "DeployProject",
    inputs: [
      {
        name: "revnetId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "creator",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "policy",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "vault",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "policyHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
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
    name: "TelligenceFactory_IncorrectCreationFee",
    inputs: [
      {
        name: "expected",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "received",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "TelligenceFactory_InvalidDescription",
    inputs: [],
  },
  {
    type: "error",
    name: "TelligenceFactory_InvalidIntegration",
    inputs: [],
  },
  {
    type: "error",
    name: "TelligenceFactory_InvalidProject",
    inputs: [],
  },
  {
    type: "error",
    name: "TelligenceFactory_InvalidStage",
    inputs: [
      {
        name: "stageIndex",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "TelligenceFactory_WrongChainOrAsset",
    inputs: [],
  },
] as const;
