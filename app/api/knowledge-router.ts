import { z } from "zod";
import { eq, desc, like, and } from "drizzle-orm";
import { createRouter, authedQuery } from "./middleware";
import { db, getInsertId } from "./queries/connection";
import { knowledgeNodes, knowledgeEdges } from "../db/schema";

export const knowledgeRouter = createRouter({
  // List all nodes
  listNodes: authedQuery
    .input(
      z
        .object({
          nodeType: z.string().optional(),
          search: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const conditions = [];

      if (input?.nodeType) {
        conditions.push(eq(knowledgeNodes.nodeType, input.nodeType as any));
      }
      if (input?.search) {
        conditions.push(like(knowledgeNodes.label, `%${input.search}%`));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      return db
        .select()
        .from(knowledgeNodes)
        .where(where)
        .orderBy(desc(knowledgeNodes.occurrenceCount));
    }),

  // Get single node with connected edges
  getNode: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [node] = await db
        .select()
        .from(knowledgeNodes)
        .where(eq(knowledgeNodes.id, input.id));

      if (!node) return null;

      const edges = await db
        .select()
        .from(knowledgeEdges)
        .where(
          and(
            eq(knowledgeEdges.sourceNodeId, input.id),
          ),
        );

      const incomingEdges = await db
        .select()
        .from(knowledgeEdges)
        .where(eq(knowledgeEdges.targetNodeId, input.id));

      return { node, edges: [...edges, ...incomingEdges] };
    }),

  // Create node
  createNode: authedQuery
    .input(
      z.object({
        label: z.string(),
        nodeType: z.enum([
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
        ]),
        description: z.string().optional(),
        sourceArticleIds: z.array(z.number()).optional(),
        icd10Code: z.string().optional(),
        meshTerm: z.string().optional(),
        confidence: z.number().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await db.insert(knowledgeNodes).values(input);
      return { id: getInsertId(result), ...input };
    }),

  // Create edge
  createEdge: authedQuery
    .input(
      z.object({
        sourceNodeId: z.number(),
        targetNodeId: z.number(),
        relationType: z.enum([
          "treats",
          "causes",
          "associated_with",
          "contraindicated",
          "diagnoses",
          "prevents",
          "symptom_of",
          "interacts_with",
          "related_to",
        ]),
        strength: z.number().optional(),
        description: z.string().optional(),
        sourceArticleIds: z.array(z.number()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await db.insert(knowledgeEdges).values(input);
      return { id: getInsertId(result), ...input };
    }),

  // Get full graph data
  getGraph: authedQuery.query(async () => {
    const nodes = await db.select().from(knowledgeNodes);
    const edges = await db.select().from(knowledgeEdges);
    return { nodes, edges };
  }),

  // Get stats
  stats: authedQuery.query(async () => {
    const nodes = await db.select().from(knowledgeNodes);
    const edges = await db.select().from(knowledgeEdges);

    const nodeTypes = nodes.reduce(
      (acc, n) => {
        acc[n.nodeType] = (acc[n.nodeType] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      nodeTypes,
    };
  }),

  // Search nodes
  search: authedQuery
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(knowledgeNodes)
        .where(like(knowledgeNodes.label, `%${input.query}%`))
        .limit(20);
    }),
});
