import { z } from "zod";
import { eq, desc, like, and, sql } from "drizzle-orm";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { db, getInsertId } from "./queries/connection";
import { articles, textSegments, extractedFigures } from "../db/schema";

export const articlesRouter = createRouter({
  // List all articles with optional filters
  list: authedQuery
    .input(
      z
        .object({
          status: z.string().optional(),
          search: z.string().optional(),
          articleType: z.string().optional(),
          department: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];

      if (input?.status) {
        conditions.push(eq(articles.status, input.status as any));
      }
      if (input?.articleType) {
        conditions.push(eq(articles.articleType, input.articleType));
      }
      if (input?.department) {
        conditions.push(eq(articles.department, input.department));
      }
      if (input?.search) {
        conditions.push(like(articles.title, `%${input.search}%`));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const results = await db
        .select()
        .from(articles)
        .where(where)
        .orderBy(desc(articles.uploadedAt));

      return results;
    }),

  // Get single article with segments and figures
  get: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [article] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, input.id));

      if (!article) return null;

      const segments = await db
        .select()
        .from(textSegments)
        .where(eq(textSegments.articleId, input.id))
        .orderBy(textSegments.sequence);

      const figures = await db
        .select()
        .from(extractedFigures)
        .where(eq(extractedFigures.articleId, input.id))
        .orderBy(extractedFigures.sequence);

      return { article, segments, figures };
    }),

  // Create article
  create: authedQuery
    .input(
      z.object({
        title: z.string(),
        fileName: z.string(),
        fileSize: z.number().optional(),
        articleType: z.string().optional(),
        department: z.string().optional(),
        authors: z.array(z.string()).optional(),
        journal: z.string().optional(),
        publishDate: z.string().optional(),
        doi: z.string().optional(),
        keywords: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await db.insert(articles).values({
        userId: ctx.user.id,
        ...input,
        status: "pending",
      });
      return { id: getInsertId(result), ...input };
    }),

  // Update article status
  updateStatus: authedQuery
    .input(
      z.object({
        id: z.number(),
        status: z.enum([
          "pending",
          "parsing",
          "parsed",
          "reviewing",
          "approved",
          "rejected",
          "error",
        ]),
      }),
    )
    .mutation(async ({ input }) => {
      await db
        .update(articles)
        .set({ status: input.status })
        .where(eq(articles.id, input.id));
      return { success: true };
    }),

  // Delete article
  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(articles).where(eq(articles.id, input.id));
      await db.delete(textSegments).where(eq(textSegments.articleId, input.id));
      await db
        .delete(extractedFigures)
        .where(eq(extractedFigures.articleId, input.id));
      return { success: true };
    }),

  // Add text segments
  addSegments: authedQuery
    .input(
      z.object({
        articleId: z.number(),
        segments: z.array(
          z.object({
            sequence: z.number(),
            content: z.string(),
            segmentType: z.enum([
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
            ]),
            sectionTitle: z.string().optional(),
            pageNumber: z.number().optional(),
            confidence: z.number().optional(),
            wordCount: z.number().optional(),
            evidenceLevel: z.string().optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ input }) => {
      for (const seg of input.segments) {
        await db.insert(textSegments).values({
          articleId: input.articleId,
          ...seg,
        });
      }
      await db
        .update(articles)
        .set({
          textSegmentsCount: input.segments.length,
          status: "parsed",
          parsedAt: new Date(),
        })
        .where(eq(articles.id, input.articleId));
      return { success: true };
    }),

  // Add extracted figures
  addFigures: authedQuery
    .input(
      z.object({
        articleId: z.number(),
        figures: z.array(
          z.object({
            sequence: z.number(),
            figureType: z.enum(["table", "figure", "chart", "image"]),
            caption: z.string().optional(),
            description: z.string().optional(),
            pageNumber: z.number().optional(),
            confidence: z.number().optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ input }) => {
      for (const fig of input.figures) {
        await db.insert(extractedFigures).values({
          articleId: input.articleId,
          ...fig,
        });
      }
      await db
        .update(articles)
        .set({ figuresCount: input.figures.length })
        .where(eq(articles.id, input.articleId));
      return { success: true };
    }),

  // Approve and add to knowledge base
  approve: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db
        .update(articles)
        .set({
          status: "approved",
          isInKnowledgeBase: 1,
          approvedAt: new Date(),
        })
        .where(eq(articles.id, input.id));
      return { success: true };
    }),

  // Get article statistics
  stats: authedQuery.query(async () => {
    const allArticles = await db.select().from(articles);
    const total = allArticles.length;
    const pending = allArticles.filter((a) => a.status === "pending").length;
    const parsed = allArticles.filter((a) => a.status === "parsed").length;
    const approved = allArticles.filter((a) => a.status === "approved").length;
    const inKb = allArticles.filter((a) => a.isInKnowledgeBase).length;

    return { total, pending, parsed, approved, inKb };
  }),
});
