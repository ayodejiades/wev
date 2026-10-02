// db/schema.ts — one example table, migrated with drizzle-kit (see drizzle.config.ts).
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const records = pgTable("records", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Record = typeof records.$inferSelect;
