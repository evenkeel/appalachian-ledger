import type { ChangeEvent, ComponentProps } from "react";

const PLAIN = /^\s*(-?)[$₿]?\s*([\d,]*)(\.\d*)?\s*$/;

/**
 * An amount with thousands separators: "1250000" reads as "1,250,000".
 * Anything that is not a plain number (letters, two decimal points) is left exactly as
 * typed, so the mistake still reaches the form's own check.
 */
export function grouped(text: string) {
  const match = PLAIN.exec(text);
  if (!match) return text;
  const [, sign, whole, fraction = ""] = match;
  const digits = whole.replace(/,/g, "");
  if (!digits && !fraction) return sign;
  const trimmed = digits.replace(/^0+(?=\d)/, "");
  return `${sign}${trimmed.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction}`;
}

/** Where the caret belongs in the new text: after the same number of digits as before. */
function caretAfter(text: string, digitsBefore: number) {
  if (digitsBefore === 0) return text.startsWith("-") ? 1 : 0;
  let seen = 0;
  for (let index = 0; index < text.length; index++) {
    if (/[\d.]/.test(text[index]) && ++seen === digitsBefore) return index + 1;
  }
  return text.length;
}

function regroup(input: HTMLInputElement) {
  const before = input.value;
  const next = grouped(before);
  if (next === before) return;
  const caret = input.selectionStart ?? before.length;
  const digitsBefore = before.slice(0, caret).replace(/[^\d.]/g, "").length;
  input.value = next;
  if (document.activeElement === input) {
    const at = caretAfter(next, digitsBefore);
    input.setSelectionRange(at, at);
  }
}

/** A number box for money: right-aligned, numeric keyboard, commas added as you type. Works with or without `value`. */
export function AmountInput({ onChange, onBlur, defaultValue, className, ...rest }: ComponentProps<"input">) {
  return (
    <input
      {...rest}
      className={className ?? "num"}
      inputMode="decimal"
      autoComplete="off"
      defaultValue={defaultValue === undefined || defaultValue === null ? defaultValue : grouped(String(defaultValue))}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        regroup(event.currentTarget);
        onChange?.(event);
      }}
      onBlur={(event) => {
        // A value set by code (a suggested amount, say) is grouped once the box is left.
        regroup(event.currentTarget);
        onBlur?.(event);
      }}
    />
  );
}
