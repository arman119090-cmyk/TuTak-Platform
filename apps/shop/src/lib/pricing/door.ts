/**
 * Door configurator pricing.
 *
 * The browser renders the option groups and shows a running total, but the
 * authoritative price is always recomputed here from the database rows before
 * anything reaches an order.
 */

export type DoorOptionRow = {
  groupKey: string;
  optionKey: string;
  priceMinor: number;
  labels: Record<string, string>;
  sort: number;
  isActive: boolean;
};

/** Groups a customer must choose before a configured door can be ordered. */
export const REQUIRED_DOOR_GROUPS = ['size', 'coating', 'color', 'opening'] as const;

/** Display order of the configurator groups. */
export const DOOR_GROUP_ORDER = [
  'size',
  'coating',
  'color',
  'frame',
  'casing',
  'handle',
  'lock',
  'opening',
  'installation',
] as const;

export type DoorConfigResult = {
  ok: boolean;
  /** Sum of the selected options' price deltas, minor units. */
  deltaMinor: number;
  selected: { groupKey: string; optionKey: string; priceMinor: number }[];
  missingGroups: string[];
  unknownSelections: string[];
};

export const computeDoorConfig = (
  rows: DoorOptionRow[],
  selection: Record<string, string> | null | undefined,
): DoorConfigResult => {
  const chosen = selection ?? {};
  const active = rows.filter((row) => row.isActive);
  const selected: DoorConfigResult['selected'] = [];
  const unknownSelections: string[] = [];

  for (const [groupKey, optionKey] of Object.entries(chosen)) {
    const row = active.find((item) => item.groupKey === groupKey && item.optionKey === optionKey);
    if (!row) {
      unknownSelections.push(`${groupKey}:${optionKey}`);
      continue;
    }
    selected.push({ groupKey, optionKey, priceMinor: row.priceMinor });
  }

  const availableGroups = new Set(active.map((row) => row.groupKey));
  const missingGroups = REQUIRED_DOOR_GROUPS.filter(
    (group) => availableGroups.has(group) && !selected.some((item) => item.groupKey === group),
  );

  return {
    ok: missingGroups.length === 0 && unknownSelections.length === 0,
    deltaMinor: selected.reduce((sum, item) => sum + item.priceMinor, 0),
    selected,
    missingGroups,
    unknownSelections,
  };
};
