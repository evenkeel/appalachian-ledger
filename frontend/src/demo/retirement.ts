/**
 * The Retirement screen in the website demo.
 *
 * The app's server works out every figure. The demo keeps the server's answers to the changes a
 * visitor is likely to try, each named by what differs from the saved choices, and picks one out.
 * Nothing is worked out here.
 */
type Settings = Record<string, unknown>;
export type Asked = { settings: Settings; trying: string[] };

export const NOT_KEPT =
  "The demo holds answers for one change at a time: bitcoin's growth in whole percents from 0 to 40, the Make it sooner boxes, and the main choices under Your costs. Undo to try another. The app on your own computer works out any mix.";

// "15", "15.0" and "15.00" ask the same question.
const tidy = (value: unknown) =>
  typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value) ? (value.includes(".") ? value.replace(/\.?0+$/, "") : value) : value;
const same = (a: unknown, b: unknown) => JSON.stringify(tidy(a)) === JSON.stringify(tidy(b));

/** The question with only what differs from the saved choices, written one way. */
function name(changes: Settings, trying: string[]) {
  const sorted = Object.keys(changes)
    .sort()
    .map((key) => [key, tidy(changes[key])]);
  return JSON.stringify([Object.fromEntries(sorted), [...trying].sort()]);
}

/** The file that holds the server's answer, or null when it is the opening answer itself. Undefined when none was kept. */
export function keptAnswer(saved: Settings, kept: Record<string, string>, asked: Asked): string | null | undefined {
  const changes = Object.fromEntries(Object.entries(asked.settings).filter(([key, value]) => !same(value, saved[key])));
  const wanted = name(changes, asked.trying);
  if (wanted === name({}, [])) return null;
  for (const [question, file] of Object.entries(kept)) {
    const [differs, trying] = JSON.parse(question) as [Settings, string[]];
    if (name(differs, trying) === wanted) return file;
  }
  return undefined;
}
