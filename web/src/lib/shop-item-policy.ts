/** A single reserved mint cannot be unlocked by a paid mint. */
export function reserveWouldDeadlock(initialSupply: number, reserveFrequency: number): boolean {
  return initialSupply === 1 && reserveFrequency > 0;
}
