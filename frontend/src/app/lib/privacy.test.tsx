import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { hideAmounts, isPrivate, reloadPrivacy, setPrivate, Tip, usePrivacy } from "./privacy";

afterEach(() => {
  act(() => setPrivate(false));
  localStorage.clear();
});

function Switch() {
  const [hidden, setHidden] = usePrivacy();
  return (
    <button aria-pressed={hidden} onClick={() => setHidden(!hidden)}>
      Blur
    </button>
  );
}

describe("privacy blur", () => {
  it("is off until chosen, and marks the page while on", () => {
    reloadPrivacy();
    expect(isPrivate()).toBe(false);
    expect(document.documentElement.hasAttribute("data-private")).toBe(false);
    act(() => setPrivate(true));
    expect(document.documentElement.hasAttribute("data-private")).toBe(true);
    act(() => setPrivate(false));
    expect(document.documentElement.hasAttribute("data-private")).toBe(false);
  });

  it("is remembered on this device between launches", () => {
    act(() => setPrivate(true));
    expect(localStorage.getItem("ledger:private")).toBe("on");
    // A fresh launch reads the saved choice before the first screen draws.
    act(() => reloadPrivacy());
    expect(isPrivate()).toBe(true);
    expect(document.documentElement.hasAttribute("data-private")).toBe(true);
    act(() => setPrivate(false));
    expect(localStorage.getItem("ledger:private")).toBeNull();
    act(() => reloadPrivacy());
    expect(isPrivate()).toBe(false);
  });

  it("turns on and off from any switch, and every switch follows", () => {
    render(
      <>
        <Switch />
        <Switch />
      </>,
    );
    const [first, second] = screen.getAllByRole("button", { name: "Blur" });
    fireEvent.click(first);
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(isPrivate()).toBe(true);
    fireEvent.click(second);
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(isPrivate()).toBe(false);
  });

  it("hides amounts in hover tips, which a blur cannot reach", () => {
    expect(hideAmounts("November 2026: ₿21,932,000, bought ₿334,300 for $400.00", true)).toBe("November 2026: ₿ hidden, bought ₿ hidden for $400.00");
    expect(hideAmounts("November 2026: ₿21,932,000", false)).toBe("November 2026: ₿21,932,000");
    const { container } = render(
      <svg>
        <circle>
          <Tip text="November 2026: ₿21,932,000" />
        </circle>
      </svg>,
    );
    const tips = () => [...container.querySelectorAll("title")].map((title) => title.textContent);
    expect(tips()).toEqual(["November 2026: ₿21,932,000"]);
    act(() => setPrivate(true));
    expect(tips()).toEqual(["November 2026: ₿ hidden"]);
  });
});
