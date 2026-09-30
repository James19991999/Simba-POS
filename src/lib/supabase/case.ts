// Generic snake_case <-> camelCase conversion between Postgres rows and the
// app's domain types (src/types/index.ts), PLUS timestamp conversion.
//
// The app's domain types represent every timestamp as a `number` (epoch
// milliseconds) — that was true of the Firestore version too, where
// `Date.now()` was written directly. Postgres stores these as `timestamptz`
// columns (ISO 8601 strings over the wire), so every column whose snake_case
// name ends in `_at` (created_at, seated_at, plan_current_period_end_at, ...)
// is converted both ways here: ISO string -> epoch ms on read, epoch ms ->
// ISO string on write. This keeps every other file in the app (tax math,
// sorting by createdAt, `Date.now() - seatedAt`, etc.) unchanged.
//
// Everything else is a SHALLOW conversion, deliberately: JSONB columns
// (orders.items, menu_items.modifiers, audit_log.metadata,
// tip_pool_entries.disbursement_results) are opaque blobs the app already
// reads/writes in camelCase internally — recursing into them would mangle
// keys that were never meant to be transformed.

function isTimestampKey(snakeKey: string): boolean {
  return snakeKey.endsWith("_at");
}

export function rowToCamel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    if (isTimestampKey(key) && typeof value === "string") {
      out[camelKey] = Date.parse(value);
    } else {
      out[camelKey] = value;
    }
  }
  return out as T;
}

export function rowsToCamel<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((r) => rowToCamel<T>(r));
}

export function camelToRow(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue; // let DB defaults apply, as Firestore's setDoc merge semantics did implicitly
    const snakeKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    if (isTimestampKey(snakeKey) && typeof value === "number") {
      out[snakeKey] = new Date(value).toISOString();
    } else if (isTimestampKey(snakeKey) && value === null) {
      out[snakeKey] = null;
    } else {
      out[snakeKey] = value;
    }
  }
  return out;
}
