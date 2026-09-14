import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at"),
});
export const rentals = sqliteTable(
  "rentals",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    payload: text("payload").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("rentals_workspace").on(t.workspaceId)],
);
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    rentalId: text("rental_id")
      .notNull()
      .references(() => rentals.id),
    status: text("status").notNull(),
    mode: text("mode").notNull(),
    callId: text("call_id"),
    payload: text("payload").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("jobs_workspace").on(t.workspaceId),
    index("jobs_rental").on(t.rentalId),
    uniqueIndex("jobs_call_id").on(t.callId),
  ],
);
export const locks = sqliteTable("dispatch_locks", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
});
export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  createdAt: text("created_at").notNull(),
});
export const audit = sqliteTable(
  "audit",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    rentalId: text("rental_id"),
    action: text("action").notNull(),
    detail: text("detail").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("audit_workspace").on(t.workspaceId)],
);
export const limits = sqliteTable("usage_limits", {
  id: text("id").primaryKey(),
  used: integer("used").notNull().default(0),
});
