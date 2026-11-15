/** Exact conversion at the BTC entry boundary; ledger amounts stay whole units. */
export function bitcoinInput(value: string, unit: "BTC" | "BITCOIN") {
  const trimmed = value.trim();
  if (unit === "BITCOIN") {
    if (!/^\d+$/.test(trimmed))
      throw new Error("Enter a whole number of bitcoin units.");
    return BigInt(trimmed).toString();
  }
  if (!/^\d+(?:\.\d{1,8})?$/.test(trimmed))
    throw new Error("Enter a legacy BTC amount with up to eight decimal places.");
  const [whole, fraction = ""] = trimmed.split(".");
  return (
    BigInt(whole) * 100000000n +
    BigInt(fraction.padEnd(8, "0"))
  ).toString();
}

export function bitcoinAsBtc(value: string) {
  const units = BigInt(value);
  return `${units / 100000000n}.${String(units % 100000000n).padStart(8, "0")}`;
}
