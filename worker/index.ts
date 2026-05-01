import { Hono } from "hono";

type Env = {
  ASSETS: Fetcher;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true, service: "style-extractor" }));

app.get("*", async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
