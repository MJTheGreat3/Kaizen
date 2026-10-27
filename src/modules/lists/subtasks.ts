/**
 * Subtasks: a to-do task can have subtasks, and those their own, three
 * levels in all. `parentId` points one level up; a task whose parent is gone
 * shows at the top level.
 */
import { createContext } from "react";

import type { Task } from "@/core/db/schema";

/** Levels of nesting: a task, its subtasks and theirs. */
export const MAX_DEPTH = 3;

export interface Tree {
  /** Live subtasks of each task, open ones first, then in the order they were added. */
  children: Map<string, Task[]>;
  /** 0 for a top-level task. */
  depth: Map<string, number>;
  /** Top-level tasks (no parent, or a parent that is gone). */
  roots: Task[];
}

export function buildTree(tasks: Task[]): Tree {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const children = new Map<string, Task[]>();
  const roots: Task[] = [];
  for (const t of tasks) {
    const parent = t.parentId ? byId.get(t.parentId) : undefined;
    if (!parent) {
      roots.push(t);
      continue;
    }
    if (!children.has(parent.id)) children.set(parent.id, []);
    children.get(parent.id)!.push(t);
  }
  for (const list of children.values()) {
    list.sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || a.createdAt - b.createdAt);
  }
  const depth = new Map<string, number>();
  const walk = (t: Task, d: number) => {
    depth.set(t.id, d);
    for (const c of children.get(t.id) ?? []) walk(c, d + 1);
  };
  for (const r of roots) walk(r, 0);
  return { children, depth, roots };
}

/** Every task below `id`, nearest first. */
export function descendants(id: string, children: Map<string, Task[]>): Task[] {
  const out: Task[] = [];
  const queue = [...(children.get(id) ?? [])];
  while (queue.length) {
    const t = queue.shift()!;
    out.push(t);
    queue.push(...(children.get(t.id) ?? []));
  }
  return out;
}

/** The tasks above one, nearest first. */
export function ancestors(task: Task, byId: Map<string, Task>): Task[] {
  const out: Task[] = [];
  const seen = new Set([task.id]);
  let parent = task.parentId ? byId.get(task.parentId) : undefined;
  while (parent && !seen.has(parent.id)) {
    out.push(parent);
    seen.add(parent.id);
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return out;
}

/** How many of the subtasks below a task are done, at every level. */
export function subtaskProgress(id: string, children: Map<string, Task[]>) {
  const all = descendants(id, children);
  return { done: all.filter((t) => t.status === "done").length, total: all.length };
}

/** Whether a task at `depth` can take subtasks. */
export const canNest = (depth: number) => depth < MAX_DEPTH - 1;

/** The list's tree, for rows to find their subtasks. */
export const TreeContext = createContext<Tree>(buildTree([]));
