import { describe, expect, it } from "vitest";

import type { Task } from "@/core/db/schema";
import { ancestors, buildTree, canNest, descendants, subtaskProgress } from "./subtasks";

const task = (id: string, parentId: string | null, status: Task["status"] = "open", createdAt = 1): Task =>
  ({ id, parentId, status, createdAt, list: "todo", title: id }) as Task;

describe("subtasks", () => {
  const tasks = [
    task("a", null),
    task("a1", "a", "done", 1),
    task("a2", "a", "open", 2),
    task("a2x", "a2", "done"),
    task("b", null),
    task("orphan", "gone"),
  ];
  const tree = buildTree(tasks);

  it("nests tasks under their parents, open ones first", () => {
    expect(tree.roots.map((t) => t.id)).toEqual(["a", "b", "orphan"]);
    expect(tree.children.get("a")!.map((t) => t.id)).toEqual(["a2", "a1"]);
    expect(tree.depth.get("a2x")).toBe(2);
    expect(tree.depth.get("orphan")).toBe(0);
  });

  it("walks down and up the tree", () => {
    expect(descendants("a", tree.children).map((t) => t.id)).toEqual(["a2", "a1", "a2x"]);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    expect(ancestors(byId.get("a2x")!, byId).map((t) => t.id)).toEqual(["a2", "a"]);
  });

  it("counts subtasks at every level", () => {
    expect(subtaskProgress("a", tree.children)).toEqual({ done: 2, total: 3 });
    expect(subtaskProgress("b", tree.children)).toEqual({ done: 0, total: 0 });
  });

  it("stops at three levels", () => {
    expect([0, 1, 2].map(canNest)).toEqual([true, true, false]);
  });
});
