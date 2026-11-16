export function ImportantInfo({
  collateralAmount,
  tokenSymbol,
}: {
  collateralAmount: string;
  tokenSymbol: string;
}) {
  return (
    <div className="mt-2 text-sm text-gray-700 space-y-1">
      <p>
        Your {collateralAmount || "0"} {tokenSymbol} tokens are removed from supply to back the
        loan.
      </p>
      <p>An NFT records the loan. Whoever holds it can repay to create the tokens again.</p>
      <p>After 10 years, the right to recover any remaining tokens ends.</p>
    </div>
  );
}
