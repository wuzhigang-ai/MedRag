import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
import { createRouter, authedQuery } from "./middleware";
import { db, getInsertId } from "./queries/connection";
import { chatSessions, chatMessages } from "../db/schema";

export const chatRouter = createRouter({
  // List sessions for user
  listSessions: authedQuery.query(async ({ ctx }) => {
    return db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, ctx.user.id))
      .orderBy(desc(chatSessions.updatedAt));
  }),

  // Create session
  createSession: authedQuery
    .input(
      z.object({
        title: z.string(),
        scopeArticles: z.array(z.number()).optional(),
        scopeCategories: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await db.insert(chatSessions).values({
        userId: ctx.user.id,
        ...input,
      });
      return { id: getInsertId(result), ...input };
    }),

  // Get session with messages
  getSession: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [session] = await db
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.id, input.id));

      if (!session) return null;

      const messages = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, input.id))
        .orderBy(chatMessages.createdAt);

      return { session, messages };
    }),

  // Add message
  addMessage: authedQuery
    .input(
      z.object({
        sessionId: z.number(),
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
        contentType: z.enum(["text", "image", "pdf", "voice", "mixed"]).optional(),
        attachments: z.array(z.any()).optional(),
        ragTrace: z.any().optional(),
        citations: z.array(z.any()).optional(),
        tokenCount: z.number().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await db.insert(chatMessages).values(input);

      // Update session message count
      const msgs = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, input.sessionId));

      await db
        .update(chatSessions)
        .set({ messageCount: msgs.length, updatedAt: new Date() })
        .where(eq(chatSessions.id, input.sessionId));

      return { id: getInsertId(result), ...input };
    }),

  // Delete session
  deleteSession: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db
        .delete(chatMessages)
        .where(eq(chatMessages.sessionId, input.id));
      await db
        .delete(chatSessions)
        .where(eq(chatSessions.id, input.id));
      return { success: true };
    }),

  // Rate message
  rateMessage: authedQuery
    .input(
      z.object({
        id: z.number(),
        rating: z.number().min(1).max(5),
        feedback: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      await db
        .update(chatMessages)
        .set({ rating: input.rating, feedback: input.feedback })
        .where(eq(chatMessages.id, input.id));
      return { success: true };
    }),
});
