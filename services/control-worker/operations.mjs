import { fault } from './errors.mjs';

export const OPERATIONS = Object.freeze({
  distribute_production: { target: 'controller', method: 'sendReservedTokensToSplitsOf', fields: [] },
  cash_out_production: { target: 'wrapper', method: 'cashOutProduction', fields: ['tokenCount', 'deadline'] },
  allocate: { target: 'wrapper', method: 'allocate', fields: ['vvvAmount', 'deadline'] },
  begin_diem_unstake: { target: 'vault', method: 'beginDiemUnstake', fields: [] },
  claim_diem_begin_vvv_unstake: { target: 'vault', method: 'claimDiemAndBeginVVVUnstake', fields: [] },
  claim_vvv_return: { target: 'vault', method: 'claimVVVAndReturn', fields: [] },
  claim_rewards_return: { target: 'vault', method: 'claimRewardsAndReturn', fields: [] },
  return_liquid_vvv: { target: 'vault', method: 'returnLiquidVVV', fields: [] },
  recover_donated_stake: { target: 'vault', method: 'recoverDonatedStake', fields: [] },
  return_unallocated_vvv: { target: 'wrapper', method: 'returnUnallocatedVVV', fields: [] },
  burn_late_production: { target: 'wrapper', method: 'burnLateProduction', fields: [] },
});

export function validateOperation(operation, payload) {
  const spec = Object.hasOwn(OPERATIONS, operation) && OPERATIONS[operation];
  if (!spec) throw fault('INVALID_OPERATION', 'Unsupported keeper operation', true);
  if (!payload || Array.isArray(payload) || typeof payload !== 'object'
    || Object.keys(payload).sort().join(',') !== [...spec.fields].sort().join(',')) {
    throw fault('INVALID_PAYLOAD', 'Unexpected operation fields', true);
  }
  for (const field of spec.fields) {
    const value = payload[field];
    if (typeof value !== 'string' || !/^[1-9][0-9]{0,77}$/.test(value) || BigInt(value) >= 2n ** 256n) {
      throw fault('INVALID_PAYLOAD', 'Amounts and deadlines must be positive uint256 decimal strings', true);
    }
  }
  return payload;
}
