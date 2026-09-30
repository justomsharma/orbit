type Json = Record<string, unknown>;

const MISSING = Symbol("missing");
type Value = unknown | typeof MISSING;

interface Change {
  path: string[];
  before: Value;
  after: Value;
}

interface ListChange {
  path: string[];
  added: unknown[];
  removed: unknown[];
}

const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isPrimitive = (v: unknown) =>
  v === null || ["string", "number", "boolean"].includes(typeof v);
const isPrimitiveList = (v: unknown): v is unknown[] => Array.isArray(v) && v.every(isPrimitive);

function equal(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && equal(a[k], b[k]));
  }
  return false;
}

function diff(before: Value, after: Value, path: string[], out: (Change | ListChange)[]): void {
  if (equal(before, after)) return;
  if (isObject(before) && isObject(after)) {
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)]))
      diff(k in before ? before[k] : MISSING, k in after ? after[k] : MISSING, [...path, k], out);
    return;
  }
  if (isPrimitiveList(before) && isPrimitiveList(after)) {
    out.push({
      path,
      added: after.filter((x) => !before.includes(x)),
      removed: before.filter((x) => !after.includes(x)),
    });
    return;
  }
  out.push({ path, before, after });
}

/** The object holding `path`'s last key, or null when a parent is not an object. */
function parentOf(root: Json, path: string[], create: boolean): Json | null {
  let o = root;
  for (const k of path.slice(0, -1)) {
    const next = o[k];
    if (next === undefined && create) o[k] = {};
    else if (!isObject(next)) return null;
    o = o[k] as Json;
  }
  return o;
}

function read(root: Json, path: string[]): Value | null {
  const p = parentOf(root, path, false);
  if (!p) return path.length > 1 && hasMissingParent(root, path) ? MISSING : null;
  const k = path[path.length - 1]!;
  return k in p ? p[k] : MISSING;
}

/** True when a parent is simply absent (not present with another type). */
function hasMissingParent(root: Json, path: string[]): boolean {
  let o: unknown = root;
  for (const k of path.slice(0, -1)) {
    if (!isObject(o)) return false;
    if (!(k in o)) return true;
    o = o[k];
  }
  return false;
}

export class ReverseConflict extends Error {}

/**
 * The inverse of an edit, as a change to apply to the file as it is now: only
 * the values Orbit changed are put back, so anything Claude wrote since stays.
 * Lists of plain values (permission rules) are undone item by item. Throws
 * ReverseConflict when a value Orbit changed was changed again since.
 */
export function reverseJsonEdit(before: Json, after: Json): (current: Json) => void {
  const changes: (Change | ListChange)[] = [];
  diff(before, after, [], changes);
  return (current) => {
    const where = (c: { path: string[] }) => c.path.join(".");
    for (const c of changes) {
      const now = read(current, c.path);
      if ("added" in c) {
        if (now !== MISSING && !isPrimitiveList(now))
          throw new ReverseConflict(`"${where(c)}" changed again since Orbit's edit.`);
      } else if (now === null || !equal(now, c.after)) {
        throw new ReverseConflict(`"${where(c)}" changed again since Orbit's edit.`);
      }
    }
    for (const c of changes) {
      const k = c.path[c.path.length - 1]!;
      if ("added" in c) {
        const p = parentOf(current, c.path, true)!;
        const list = isPrimitiveList(p[k]) ? p[k] : [];
        const kept = list.filter((x) => !c.added.includes(x));
        p[k] = [...kept, ...c.removed.filter((x) => !kept.includes(x))];
      } else if (c.before === MISSING) {
        const p = parentOf(current, c.path, false);
        if (p) delete p[k];
      } else {
        parentOf(current, c.path, true)![k] = structuredClone(c.before);
      }
    }
  };
}
