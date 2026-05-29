import { createRouter, publicQuery, authedQuery } from "./middleware";
import { db } from "./queries/connection";
import {
  articles,
  knowledgeNodes,
  knowledgeEdges,
  chatSessions,
  chatMessages,
} from "../db/schema";

export const statsRouter = createRouter({
  // Get system-wide statistics
  system: publicQuery.query(async () => {

    const allArticles = await db.select().from(articles);
    const nodes = await db.select().from(knowledgeNodes);
    const edges = await db.select().from(knowledgeEdges);
    const sessions = await db.select().from(chatSessions);
    const messages = await db.select().from(chatMessages);

    return {
      totalArticles: allArticles.length,
      parsedArticles: allArticles.filter((a) =>
        ["parsed", "reviewing", "approved"].includes(a.status),
      ).length,
      knowledgeBaseArticles: allArticles.filter((a) => a.isInKnowledgeBase)
        .length,
      totalNodes: nodes.length,
      totalEdges: edges.length,
      totalChatSessions: sessions.length,
      totalChatMessages: messages.length,
      avgParseTime: 12.5, // simulated
    };
  }),

  // Get monthly article trends (simulated)
  trends: publicQuery.query(async () => {
    const months = [
      "2025-01",
      "2025-02",
      "2025-03",
      "2025-04",
      "2025-05",
      "2025-06",
    ];
    return months.map((month) => ({
      month,
      uploaded: Math.floor(Math.random() * 50) + 10,
      parsed: Math.floor(Math.random() * 40) + 5,
      approved: Math.floor(Math.random() * 30) + 3,
    }));
  }),

  // Department distribution (simulated)
  departmentDist: publicQuery.query(async () => {
    return [
      { department: "Cardiology", count: 45 },
      { department: "Oncology", count: 38 },
      { department: "Neurology", count: 32 },
      { department: "Pediatrics", count: 28 },
      { department: "Surgery", count: 25 },
      { department: "Radiology", count: 20 },
      { department: "Dermatology", count: 15 },
      { department: "Psychiatry", count: 12 },
    ];
  }),
});
