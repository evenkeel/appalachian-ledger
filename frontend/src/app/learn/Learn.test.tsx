import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { categories, empty, periods, reading, report, transactions } from "../test/fixture";
import type { DashboardData } from "../dashboard/types";

let current: DashboardData = reading;
let offline = false;
vi.mock("../../lib/api", () => ({
  setCsrf: () => {},
  api: vi.fn(async (path: string) => {
    if (offline) throw new Error("The local server did not answer.");
    if (path === "/dashboard") return current;
    if (path.startsWith("/transactions")) return current === empty ? [] : transactions;
    if (path === "/categories") return categories;
    if (path.startsWith("/reports")) return report;
    if (path.startsWith("/spending-history")) return { periods };
    return { ok: true };
  }),
}));

import { LEARN_TOPICS, Learn, learnHash, topicFromHash } from "./Learn";
import { SUPPLY, parseBtc, parseWhole, wholeText, wholeToBtc } from "./units";

const go = vi.fn();
const scrolled: string[] = [];
const show = () => render(<Learn go={go} />);
const loaded = () => screen.findByText(/^Since June, a month of your life costs/);

beforeEach(() => {
  current = reading;
  offline = false;
  go.mockClear();
  scrolled.length = 0;
  window.location.hash = "#/learn";
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  };
});
afterEach(() => {
  window.location.hash = "";
});

describe("learn", () => {
  it("has every topic, each under its own heading, with a contents list that links to it", async () => {
    show();
    await loaded();
    expect(screen.getByRole("heading", { level: 1, name: "Learn" })).toBeInTheDocument();
    expect(LEARN_TOPICS.map((topic) => topic.id)).toEqual(["cost-of-living", "bitcoin-is-saving", "units", "stack-rate", "bills", "prices", "alert-lights", "private"]);
    const contents = within(screen.getByRole("navigation", { name: "Topics" }));
    for (const topic of LEARN_TOPICS) {
      const heading = screen.getByRole("heading", { level: 2, name: topic.title });
      expect(heading.closest("section")).toHaveAttribute("id", topic.id);
      expect(contents.getByRole("link", { name: topic.title })).toHaveAttribute("href", `#/learn/${topic.id}`);
    }
  });

  it("teaches with the reader's own numbers", async () => {
    show();
    expect(await loaded()).toHaveTextContent("+4.8% in dollars and −11.7% in bitcoin");
    expect(screen.getByText(/^Your stack rate so far in November is/)).toHaveTextContent("Your stack rate so far in November is 11.3%, from 2 buys for $800.00.");
    // Two destroyed bills at $31.98 a month: twelve times that, to the cent.
    expect(screen.getByText(/^You have destroyed 2 bills so far/)).toHaveTextContent("That frees $31.98 a month, $383.76 a year.");
  });

  it("opens on the linked topic and moves focus to its heading", async () => {
    window.location.hash = learnHash("stack-rate");
    show();
    expect(scrolled).toContain("stack-rate");
    expect(screen.getByRole("heading", { level: 2, name: "Stack rate: the score" })).toHaveFocus();
    expect(within(screen.getByRole("navigation", { name: "Topics" })).getByRole("link", { name: "Stack rate: the score" })).toHaveAttribute("aria-current", "true");
    await loaded();
    // Following another link on the page moves to that topic too.
    window.location.hash = learnHash("prices");
    fireEvent(window, new HashChangeEvent("hashchange"));
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "How things get a bitcoin price" })).toHaveFocus());
    expect(scrolled[scrolled.length - 1]).toBe("prices");
  });

  it("reads a topic only from the part of the address after the screen", () => {
    expect(topicFromHash("#/learn/units")).toBe("units");
    expect(topicFromHash("#/learn")).toBeNull();
    expect(topicFromHash("#/learn/not-a-topic")).toBeNull();
    expect(topicFromHash("#/stack/units")).toBeNull();
  });

  it("converts between whole bitcoin and BTC exactly, however large", () => {
    expect(wholeToBtc(1n)).toBe("0.00000001");
    expect(wholeToBtc(125_000n)).toBe("0.00125");
    expect(wholeToBtc(100_000_000n)).toBe("1");
    expect(wholeToBtc(SUPPLY)).toBe("21,000,000");
    // Past the point where a JavaScript number would round.
    expect(wholeToBtc(2_099_999_999_999_999n)).toBe("20,999,999.99999999");
    expect(parseBtc("20,999,999.99999999")).toBe(2_099_999_999_999_999n);
    expect(wholeText(parseWhole("₿9,007,199,254,740,993")!)).toBe("9,007,199,254,740,993");
    expect(parseBtc("0.1")).toBe(10_000_000n);
    expect(parseBtc(".5 BTC")).toBe(50_000_000n);
    expect(parseBtc("0.000000001")).toBeNull();
    expect(parseWhole("1.5")).toBeNull();
    expect(parseWhole("-3")).toBeNull();
  });

  it("lets the reader type an amount either way", async () => {
    show();
    const box = within(screen.getByRole("group", { name: "Convert between whole bitcoin and BTC" }));
    expect(box.getByLabelText("BTC")).toHaveValue("0.00125");
    fireEvent.change(box.getByLabelText("Whole bitcoin (₿)"), { target: { value: "2,099,999,999,999,999" } });
    expect(box.getByLabelText("BTC")).toHaveValue("20,999,999.99999999");
    fireEvent.change(box.getByLabelText("BTC"), { target: { value: "0.5" } });
    expect(box.getByLabelText("Whole bitcoin (₿)")).toHaveValue("50,000,000");
    expect(box.getByRole("status")).toHaveTextContent("₿50,000,000 is 0.5 BTC.");
    fireEvent.change(box.getByLabelText("BTC"), { target: { value: "0.000000001" } });
    expect(box.getByRole("status")).toHaveTextContent("at most eight decimal places");
    expect(box.getByLabelText("BTC")).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(box.getByLabelText("BTC"), { target: { value: "21000001" } });
    expect(box.getByRole("status")).toHaveTextContent("more than all the bitcoin there will ever be");
    await loaded();
  });

  it("ends each topic with one action that opens the right screen", async () => {
    show();
    await loaded();
    const expected: [string, string][] = [
      ["cost-of-living", "spending"],
      ["bitcoin-is-saving", "stack"],
      ["units", "accounts"],
      ["stack-rate", "stack"],
      ["bills", "bills"],
      ["prices", "settings"],
      ["alert-lights", "settings"],
      ["private", "settings"],
    ];
    for (const [id, route] of expected) {
      const buttons = within(document.getElementById(id)!)
        .getAllByRole("button")
        .filter((button) => button.classList.contains("btn"));
      expect(buttons).toHaveLength(1);
      go.mockClear();
      fireEvent.click(buttons[0]);
      expect(go).toHaveBeenCalledWith(route);
    }
  });

  it("names each alert level in words, not by colour alone", async () => {
    show();
    const lights = within(document.getElementById("alert-lights")!);
    for (const [level, shape] of [
      ["Advisory", "blue circle"],
      ["Caution", "amber triangle"],
      ["Warning", "red octagon"],
    ])
      expect(lights.getByText(level).parentElement).toHaveTextContent(`${level} ${shape}`);
    await loaded();
  });

  it("never says sats", async () => {
    show();
    await loaded();
    expect(document.body.textContent).not.toMatch(/\bsats?\b|satoshi/i);
  });

  it("on an empty ledger still reads completely and draws no empty chart", async () => {
    current = empty;
    show();
    expect(await screen.findByText(/Collecting data/)).toHaveTextContent("0 of 60");
    expect(screen.queryByRole("img", { name: /Monthly cost of living/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(LEARN_TOPICS.length);
    // No figure of the reader's own is invented when there is none.
    expect(screen.queryByText(/^Your stack rate so far/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^You have destroyed/)).not.toBeInTheDocument();
    expect(screen.getByText(/A month with income and no buys scores 0%/)).toBeInTheDocument();
  });

  it("still reads completely when the ledger cannot be reached", async () => {
    offline = true;
    show();
    expect(await screen.findByText(/Your own numbers could not be loaded just now/)).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(LEARN_TOPICS.length);
  });
});
