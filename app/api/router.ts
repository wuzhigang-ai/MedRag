import { authRouter } from "./auth-router";
import { articlesRouter } from "./articles-router";
import { knowledgeRouter } from "./knowledge-router";
import { chatRouter } from "./chat-router";
import { statsRouter } from "./stats-router";
import { notesRouter } from "./notes-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  articles: articlesRouter,
  knowledge: knowledgeRouter,
  chat: chatRouter,
  stats: statsRouter,
  notes: notesRouter,
});

export type AppRouter = typeof appRouter;
