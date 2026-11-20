/* The alert thresholds as the owner edits them. Bounds mirror `Thresholds` in backend/app/alerts.py,
   so a value this file accepts is one the server accepts. */

export const LIGHT_IDS = ["overdue", "cash", "card", "pace", "util", "allow", "price", "conv", "backup", "stack"] as const;
export type LightId = (typeof LIGHT_IDS)[number];
export type Rule = { on: boolean } & { [field: string]: number | boolean };
export type Thresholds = Record<LightId, Rule>;

export interface FieldSpec {
  key: string;
  /** Words before the number. */
  label: string;
  /** Words after the number: the unit, in plain words. */
  unit: string;
  min: number;
  max: number;
}
export interface LightSpec {
  id: LightId;
  name: string;
  /** What lights it that is not adjustable here. */
  when: string;
  fields: FieldSpec[];
  /** Two fields that only make sense in this order. */
  order?: { low: string; high: string; message: string };
}

export const SPECS: LightSpec[] = [
  {
    id: "overdue",
    name: "Bill overdue",
    when: "Caution from the first day a bill is late.",
    fields: [{ key: "warning_days", label: "Warning from", unit: "days late", min: 1, max: 60 }],
  },
  {
    id: "cash",
    name: "Cash short",
    when: "Lights when checking is projected to drop below zero. Further out, it is a caution.",
    fields: [{ key: "warning_within_days", label: "Warning within", unit: "days", min: 0, max: 30 }],
  },
  {
    id: "card",
    name: "Card due",
    when: "Only for a card that has a balance and a due day.",
    fields: [
      { key: "advisory_days", label: "Advisory", unit: "days before", min: 0, max: 30 },
      { key: "caution_days", label: "Caution", unit: "days before", min: 0, max: 30 },
    ],
    order: { low: "caution_days", high: "advisory_days", message: "The caution cannot start earlier than the advisory." },
  },
  {
    id: "pace",
    name: "Spend pace",
    when: "Caution when this month is ahead of the same days last month by both amounts.",
    fields: [
      { key: "percent", label: "Ahead by", unit: "percent", min: 1, max: 500 },
      { key: "dollars", label: "and by", unit: "dollars", min: 0, max: 1_000_000 },
      { key: "from_day", label: "From day", unit: "of the month", min: 1, max: 28 },
    ],
  },
  {
    id: "util",
    name: "Credit use",
    when: "Reads the most-used card that has a limit.",
    fields: [
      { key: "caution_percent", label: "Caution at", unit: "percent of limit", min: 1, max: 100 },
      { key: "warning_percent", label: "Warning at", unit: "percent of limit", min: 1, max: 200 },
    ],
    order: { low: "caution_percent", high: "warning_percent", message: "The caution line cannot be above the warning line." },
  },
  {
    id: "allow",
    name: "Allowance",
    when: "Caution once a category goes over its allowance.",
    fields: [
      { key: "advisory_percent", label: "Advisory at", unit: "percent used", min: 1, max: 100 },
      { key: "advisory_days_left", label: "with more than", unit: "days left", min: 0, max: 31 },
    ],
  },
  {
    id: "price",
    name: "Price feed",
    when: "Only while automatic prices are on.",
    fields: [
      { key: "stale_minutes", label: "Advisory after", unit: "minutes without a new price", min: 1, max: 1440 },
      { key: "failing_minutes", label: "Caution after", unit: "minutes of failed updates", min: 1, max: 10080 },
    ],
  },
  {
    id: "conv",
    name: "Missing price",
    when: "Advisory as soon as one expense has no bitcoin price for its day.",
    fields: [
      { key: "caution_count", label: "Caution at", unit: "expenses", min: 1, max: 100_000 },
      { key: "caution_age_days", label: "or one older than", unit: "days", min: 1, max: 3650 },
    ],
  },
  {
    id: "backup",
    name: "Backup",
    when: "Counts days since the last encrypted backup.",
    fields: [
      { key: "advisory_days", label: "Advisory after", unit: "days", min: 1, max: 3650 },
      { key: "caution_days", label: "Caution after", unit: "days", min: 1, max: 3650 },
      { key: "grace_days", label: "Never backed up: caution after", unit: "days of records", min: 0, max: 365 },
    ],
    order: { low: "advisory_days", high: "caution_days", message: "The advisory cannot come after the caution." },
  },
  {
    id: "stack",
    name: "No stack yet",
    when: "A month with income and no bitcoin bought.",
    fields: [{ key: "by_day", label: "Advisory from day", unit: "of the month", min: 1, max: 28 }],
  },
];

export type Draft = Record<LightId, { on: boolean; values: Record<string, string> }>;

export function toDraft(saved: Thresholds): Draft {
  const draft = {} as Draft;
  for (const spec of SPECS) {
    const rule = saved[spec.id];
    draft[spec.id] = {
      on: rule?.on !== false,
      values: Object.fromEntries(spec.fields.map((field) => [field.key, String(rule?.[field.key] ?? "")])),
    };
  }
  return draft;
}

/** Only call once `check` passes for every light. */
export function toPayload(draft: Draft): Thresholds {
  const payload = {} as Thresholds;
  for (const spec of SPECS) {
    const rule: Rule = { on: draft[spec.id].on };
    for (const field of spec.fields) rule[field.key] = Number(draft[spec.id].values[field.key].trim());
    payload[spec.id] = rule;
  }
  return payload;
}

const count = (value: number) => value.toLocaleString("en-US");

/** The first problem with one light's numbers, in plain words, or null. */
export function check(spec: LightSpec, values: Record<string, string>): string | null {
  for (const field of spec.fields) {
    const text = (values[field.key] ?? "").trim();
    const value = Number(text);
    if (!/^\d{1,9}$/.test(text) || value < field.min || value > field.max)
      return `“${field.label}” takes a whole number from ${count(field.min)} to ${count(field.max)} ${field.unit}.`;
  }
  if (spec.order && Number(values[spec.order.low]) > Number(values[spec.order.high])) return spec.order.message;
  return null;
}

/** Sorts a server refusal ("pace percent: Input should be…; …") onto the lights it names. */
export function sortServerErrors(message: string) {
  const rows: Partial<Record<LightId, string>> = {};
  const rest: string[] = [];
  for (const part of message.split("; ")) {
    const match = /^(\w+)(?: (\w+))?: (.+)$/.exec(part);
    const spec = match && SPECS.find((item) => item.id === match[1]);
    if (!match || !spec) {
      rest.push(part);
      continue;
    }
    const field = spec.fields.find((item) => item.key === match[2]);
    const text = field ? `“${field.label}”: ${match[3]}` : match[3];
    rows[spec.id] = rows[spec.id] ? `${rows[spec.id]} ${text}` : text;
  }
  return { rows, rest: rest.join("; ") };
}
