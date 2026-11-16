"use client";

import { createContext, useContext, useLayoutEffect } from "react";

export type TransactionReviewScope = {
  identity: string;
  verify: () => Promise<boolean>;
};

export const ReviewScopeContext = createContext<
  ((scope: TransactionReviewScope) => () => void) | null
>(null);

/** The project registers its binding with the existing global review owner. */
export function useTransactionReviewScope(scope: TransactionReviewScope | null) {
  const register = useContext(ReviewScopeContext);
  useLayoutEffect(() => (scope && register ? register(scope) : undefined), [register, scope]);
}
