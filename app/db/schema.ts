// db/schema.ts - MySQL Schema
import { sql } from "drizzle-orm";
import {
  mysqlTable,
  serial,
  int,
  varchar,
  text,
  float,
  json,
  timestamp,
  mysqlEnum,
} from "drizzle-orm/mysql-core";

// ─── Users ───
export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("union_id", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 255 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "expert", "admin"]).notNull().default("expert"),
  medicalRole: varchar("medical_role", { length: 100 }),
  institution: varchar("institution", { length: 255 }),
  department: varchar("department", { length: 100 }),
  yearsOfExperience: int("years_of_experience"),
  phone: varchar("phone", { length: 50 }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
  lastSignInAt: timestamp("last_sign_in_at"),
});

// ─── Articles ───
export const articles = mysqlTable("articles", {
  id: serial("id").primaryKey(),
  userId: int("user_id").notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileSize: int("file_size"),
  fileUrl: text("file_url"),
  articleType: varchar("article_type", { length: 100 }),
  status: mysqlEnum("status", [
    "pending",
    "parsing",
    "parsed",
    "reviewing",
    "approved",
    "rejected",
    "error",
  ])
    .notNull()
    .default("pending"),
  parsedContent: text("parsed_content"),
  textSegmentsCount: int("text_segments_count").default(0),
  figuresCount: int("figures_count").default(0),
  tablesCount: int("tables_count").default(0),
  authors: json("authors").$type<string[]>(),
  publishDate: varchar("publish_date", { length: 50 }),
  journal: varchar("journal", { length: 255 }),
  doi: varchar("doi", { length: 255 }),
  keywords: json("keywords").$type<string[]>(),
  department: varchar("department", { length: 100 }),
  isInKnowledgeBase: int("is_in_knowledge_base").default(0), // 0=false, 1=true
  knowledgeNodesCount: int("knowledge_nodes_count").default(0),
  uploadedAt: timestamp("uploaded_at").default(sql`CURRENT_TIMESTAMP`),
  parsedAt: timestamp("parsed_at"),
  approvedAt: timestamp("approved_at"),
});

// ─── Text Segments ───
export const textSegments = mysqlTable("text_segments", {
  id: serial("id").primaryKey(),
  articleId: int("article_id").notNull(),
  sequence: int("sequence").notNull(),
  content: text("content").notNull(),
  segmentType: mysqlEnum("segment_type", [
    "abstract",
    "introduction",
    "methods",
    "results_primary",
    "results_secondary",
    "subgroup_analysis",
    "sensitivity_analysis",
    "discussion",
    "conclusion",
    "references",
    "other",
  ])
    .notNull()
    .default("other"),
  sectionTitle: varchar("section_title", { length: 255 }),
  pageNumber: int("page_number"),
  confidence: float("confidence"),
  wordCount: int("word_count"),
  evidenceLevel: varchar("evidence_level", { length: 50 }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// ─── Extracted Figures ───
export const extractedFigures = mysqlTable("extracted_figures", {
  id: serial("id").primaryKey(),
  articleId: int("article_id").notNull(),
  figureType: mysqlEnum("figure_type", ["table", "figure", "chart", "image"])
    .notNull()
    .default("figure"),
  sequence: int("sequence").notNull(),
  caption: text("caption"),
  description: text("description"),
  pageNumber: int("page_number"),
  confidence: float("confidence"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// ─── Knowledge Nodes ───
export const knowledgeNodes = mysqlTable("knowledge_nodes", {
  id: serial("id").primaryKey(),
  label: varchar("label", { length: 255 }).notNull(),
  nodeType: mysqlEnum("node_type", [
    "disease",
    "drug",
    "symptom",
    "treatment",
    "clinical_indicator",
    "anatomy",
    "procedure",
    "gene",
    "pathogen",
    "other",
  ])
    .notNull()
    .default("other"),
  description: text("description"),
  sourceArticleIds: json("source_article_ids").$type<number[]>(),
  sourceSegmentIds: json("source_segment_ids").$type<number[]>(),
  icd10Code: varchar("icd10_code", { length: 50 }),
  meshTerm: varchar("mesh_term", { length: 255 }),
  confidence: float("confidence"),
  occurrenceCount: int("occurrence_count").default(1),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// ─── Knowledge Edges ───
export const knowledgeEdges = mysqlTable("knowledge_edges", {
  id: serial("id").primaryKey(),
  sourceNodeId: int("source_node_id").notNull(),
  targetNodeId: int("target_node_id").notNull(),
  relationType: mysqlEnum("relation_type", [
    "treats",
    "causes",
    "associated_with",
    "contraindicated",
    "diagnoses",
    "prevents",
    "symptom_of",
    "interacts_with",
    "related_to",
  ])
    .notNull()
    .default("related_to"),
  strength: float("strength").default(0.5),
  sourceArticleIds: json("source_article_ids").$type<number[]>(),
  evidenceCount: int("evidence_count").default(1),
  description: text("description"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// ─── Chat Sessions ───
export const chatSessions = mysqlTable("chat_sessions", {
  id: serial("id").primaryKey(),
  userId: int("user_id").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  scopeArticles: json("scope_articles").$type<number[]>(),
  scopeCategories: json("scope_categories").$type<string[]>(),
  messageCount: int("message_count").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// ─── Chat Messages ───
export const chatMessages = mysqlTable("chat_messages", {
  id: serial("id").primaryKey(),
  sessionId: int("session_id").notNull(),
  role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
  content: text("content").notNull(),
  contentType: mysqlEnum("content_type", [
    "text",
    "image",
    "pdf",
    "voice",
    "mixed",
  ])
    .notNull()
    .default("text"),
  attachments: json("attachments").$type<
    Array<{ type: string; url: string; name: string }>
  >(),
  ragTrace: json("rag_trace"),
  citations: json("citations"),
  rating: int("rating"),
  feedback: text("feedback"),
  tokenCount: int("token_count"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// ─── Operation Logs ───
export const operationLogs = mysqlTable("operation_logs", {
  id: serial("id").primaryKey(),
  userId: int("user_id"),
  userName: varchar("user_name", { length: 255 }),
  action: varchar("action", { length: 100 }).notNull(),
  targetType: varchar("target_type", { length: 100 }),
  targetId: int("target_id"),
  details: json("details"),
  ipAddress: varchar("ip_address", { length: 100 }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// ─── Notes ───
export const notes = mysqlTable("notes", {
  id: serial("id").primaryKey(),
  userId: int("user_id").notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  content: text("content").notNull(),
  tags: json("tags").$type<string[]>(),
  source: varchar("source", { length: 255 }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// ─── Types ───
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Article = typeof articles.$inferSelect;
export type TextSegment = typeof textSegments.$inferSelect;
export type ExtractedFigure = typeof extractedFigures.$inferSelect;
export type KnowledgeNode = typeof knowledgeNodes.$inferSelect;
export type KnowledgeEdge = typeof knowledgeEdges.$inferSelect;
export type ChatSession = typeof chatSessions.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type OperationLog = typeof operationLogs.$inferSelect;
export type Note = typeof notes.$inferSelect;
