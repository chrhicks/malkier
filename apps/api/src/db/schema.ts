import { sql } from "drizzle-orm"
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core"

export const sessionStatusValues = ["active", "archived", "deleted"] as const
export const messageRoleValues = ["system", "user", "assistant", "tool"] as const
export const messageStatusValues = ["streaming", "complete", "error"] as const

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    title: text("title"),
    status: text("status", { enum: sessionStatusValues }).notNull().default("active"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`)
  },
  (table) => [index("idx_sessions_user_updated").on(table.userId, table.updatedAt)]
)

export const sessionMessages = sqliteTable(
  "session_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role", { enum: messageRoleValues }).notNull(),
    content: text("content").notNull(),
    status: text("status", { enum: messageStatusValues })
      .notNull()
      .default("complete"),
    sequence: integer("sequence").notNull(),
    tokenCount: integer("token_count"),
    metadata: text("metadata"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`)
  },
  (table) => [
    uniqueIndex("idx_messages_session_sequence").on(
      table.sessionId,
      table.sequence
    ),
    index("idx_messages_session_created").on(table.sessionId, table.createdAt)
  ]
)

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type SessionMessage = typeof sessionMessages.$inferSelect
export type NewSessionMessage = typeof sessionMessages.$inferInsert
export type SessionMessageRole = NewSessionMessage['role']
export type SessionMessageStatus = NewSessionMessage['status']
