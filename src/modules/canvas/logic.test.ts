import { describe, expect, it } from "vitest";

import { fileIds, KEEP_DELETED_MS, mergeElements, pruneDeleted, sameScene, titleFromIdea, type SceneElement } from "./logic";

const el = (id: string, version = 1, extra: Partial<SceneElement> = {}): SceneElement => ({ id, version, versionNonce: 5, ...extra });
const ids = (list: SceneElement[]) => list.map((e) => `${e.id}${e.version}`);

describe("mergeElements", () => {
  it("keeps the newer copy of each element", () => {
    expect(ids(mergeElements([el("a", 3), el("b", 1)], [el("a", 2), el("b", 4)]))).toEqual(["a3", "b4"]);
  });

  it("breaks version ties by the lower nonce on both sides", () => {
    const a = el("a", 2, { versionNonce: 9, text: "mine" });
    const b = el("a", 2, { versionNonce: 3, text: "theirs" });
    expect(mergeElements([a], [b])[0].text).toBe("theirs");
    expect(mergeElements([b], [a])[0].text).toBe("theirs");
  });

  it("adds elements only the other side has, where they sat", () => {
    expect(ids(mergeElements([el("a"), el("c")], [el("a"), el("b"), el("c"), el("d")]))).toEqual(["a1", "b1", "c1", "d1"]);
    expect(ids(mergeElements([el("x")], [el("a"), el("b")]))).toEqual(["x1", "a1", "b1"]);
  });

  it("lets a deletion win when it is the newer change", () => {
    const merged = mergeElements([el("a", 1)], [el("a", 2, { isDeleted: true })]);
    expect(merged[0].isDeleted).toBe(true);
  });
});

describe("scene helpers", () => {
  it("prunes old deletions only", () => {
    const now = 100 * 86_400_000;
    const list = [el("a"), el("b", 1, { isDeleted: true, updated: now - KEEP_DELETED_MS - 1 }), el("c", 1, { isDeleted: true, updated: now - 1000 })];
    expect(ids(pruneDeleted(list, now))).toEqual(["a1", "c1"]);
  });

  it("compares scenes by versions", () => {
    expect(sameScene([el("a", 1)], [el("a", 1)])).toBe(true);
    expect(sameScene([el("a", 1)], [el("a", 2)])).toBe(false);
  });

  it("lists the files visible images use", () => {
    const list = [el("a", 1, { type: "image", fileId: "f1" }), el("b", 1, { type: "image", fileId: "f2", isDeleted: true }), el("c")];
    expect([...fileIds(list)]).toEqual(["f1"]);
  });

  it("titles a board from an idea's first line", () => {
    expect(titleFromIdea("App for #college notes\nmore")).toBe("App for notes");
    expect(titleFromIdea("#only")).toBe("Untitled board");
  });
});
