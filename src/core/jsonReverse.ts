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

/**
 * Records every value Orbit changed. Objects Orbit created or removed are walked
 * into (so Claude may add its own keys inside them meanwhile); `created` collects
 * the containers Orbit made, to tidy away if the undo leaves them empty.
 */
function diff(
  before: Value,
  after: Value,
  path: string[],
  out: (Change | ListChange)[],
  created: string[][],
): void {
  if (equal(before, after)) return;
  const b = before === MISSING && isObject(after) ? {} : before;
  const a = after === MISSING && isObject(before) ? {} : after;
  if (isObject(b) && isObject(a)) {
    if (before === MISSING) created.push(path);
    for (const k of new Set([...Object.keys(b), ...Object.keys(a)]))
      diff(k in b ? b[k] : MISSING, k in a ? a[k] : MISSING, [...path, k], out, created);
    return;
  }
  const bl = before === MISSING && isPrimitiveList(after) ? [] : before;
  const al = after === MISSING && isPrimitiveList(before) ? [] : after;
  if (isPrimitiveList(bl) && isPrimitiveList(al)) {
    if (before === MISSING) created.push(path);
    out.push({
      path,
      added: al.filter((x) => !bl.includes(x)),
      removed: bl.filter((x) => !al.includes(x)),
    });
    return;
  }
  out.push({ path, before, after });
}

/** Removes containers Orbit created that the undo left empty, deepest first. */
function prune(root: Json, created: string[][]): void {
  for (const path of [...created].sort((x, y) => y.length - x.length)) {
    if (!path.length) continue;
    const p = parentOf(root, path, false);
    const k = path[path.length - 1]!;
    const v = p?.[k];
    if (p && ((Array.isArray(v) && v.length === 0) || (isObject(v) && !Object.keys(v).length)))
      delete p[k];
  }
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
  const created: string[][] = [];
  diff(before, after, [], changes, created);
  return (current) => {
    const where = (c: { path: string[] }) => c.path.join(".");
    for (const c of changes) {
      const now = read(current, c.path);
      if ("added" in c) {
        if (now === null || (now !== MISSING && !isPrimitiveList(now)))
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
    prune(current, created);
  };
}
