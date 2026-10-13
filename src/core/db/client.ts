import { drizzle } from "drizzle-orm/sqlite-proxy";

import { ipc } from "@/lib/ipc";
import * as schema from "./schema";

/**
 * Drizzle over the Rust `db_query` command. The database only accepts
 * queries while the app is unlocked.
 */
export const db = drizzle(
  async (sql, params, method) => {
    const rows = await ipc.dbQuery(sql, params, method);
    // Drizzle expects a single row for `get` and a list of rows otherwise.
    return { rows: method === "get" ? (rows[0] as unknown[]) : rows };
  },
  { schema },
);

export { schema };
