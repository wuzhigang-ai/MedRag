import { relations } from "drizzle-orm";
import {
  users,
  articles,
  textSegments,
  extractedFigures,
  knowledgeNodes,
  knowledgeEdges,
  chatSessions,
  chatMessages,
} from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  articles: many(articles),
  chatSessions: many(chatSessions),
}));

export const articlesRelations = relations(articles, ({ one, many }) => ({
  user: one(users, { fields: [articles.userId], references: [users.id] }),
  textSegments: many(textSegments),
  extractedFigures: many(extractedFigures),
}));

export const textSegmentsRelations = relations(textSegments, ({ one }) => ({
  article: one(articles, {
    fields: [textSegments.articleId],
    references: [articles.id],
  }),
}));

export const extractedFiguresRelations = relations(extractedFigures, ({ one }) => ({
  article: one(articles, {
    fields: [extractedFigures.articleId],
    references: [articles.id],
  }),
}));

export const chatSessionsRelations = relations(chatSessions, ({ one, many }) => ({
  user: one(users, { fields: [chatSessions.userId], references: [users.id] }),
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  session: one(chatSessions, {
    fields: [chatMessages.sessionId],
    references: [chatSessions.id],
  }),
}));

export const knowledgeEdgesRelations = relations(knowledgeEdges, ({ one }) => ({
  sourceNode: one(knowledgeNodes, {
    fields: [knowledgeEdges.sourceNodeId],
    references: [knowledgeNodes.id],
  }),
  targetNode: one(knowledgeNodes, {
    fields: [knowledgeEdges.targetNodeId],
    references: [knowledgeNodes.id],
  }),
}));
