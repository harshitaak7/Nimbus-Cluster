import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Files shared across the cluster. Content is stored base64-encoded. */
export const dcFiles = pgTable("dc_files", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  mime: text("mime").notNull().default("application/octet-stream"),
  size: integer("size").notNull().default(0),
  checksum: text("checksum").notNull(),
  content: text("content").notNull(),
  version: integer("version").notNull().default(1),
  primaryNode: text("primary_node").notNull(),
  replicas: jsonb("replicas").$type<string[]>().notNull().default([]),
  targetReplicas: integer("target_replicas").notNull().default(2),
  downloads: integer("downloads").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** History of MapReduce jobs run on the cluster. */
export const mrJobs = pgTable("mr_jobs", {
  id: serial("id").primaryKey(),
  job: text("job").notNull(),
  inputName: text("input_name").notNull(),
  inputBytes: integer("input_bytes").notNull().default(0),
  mappers: integer("mappers").notNull(),
  reducers: integer("reducers").notNull(),
  combiner: boolean("combiner").notNull().default(false),
  durationMs: integer("duration_ms").notNull().default(0),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
