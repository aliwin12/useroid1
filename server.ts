import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { instance as searchEngine } from "./src/lib/search-engine.ts";
import { crawlerInstance } from "./src/lib/crawler.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Search API
  app.post("/api/search", async (req, res) => {
    const { q: query, providers } = req.body;
    if (!query) return res.status(400).json({ error: "Query required" });
    const results = await searchEngine.search(query, providers);
    res.json(results);
  });

  // Crawl API
  app.post("/api/crawl", (req, res) => {
    const { url, maxPages } = req.body;
    if (!url) return res.status(400).json({ error: "URL required" });
    
    // Fire and forget crawling
    crawlerInstance.startCrawl(url, maxPages || 10).catch(console.error);
    res.json({ message: "Crawl started", url });
  });

  // Stats API
  app.get("/api/stats", (req, res) => {
    res.json({
      engine: searchEngine.getStats(),
      crawler: crawlerInstance.getStats()
    });
  });

  // Documents API
  app.get("/api/documents", (req, res) => {
    res.json(searchEngine.getAllDocuments());
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`USEROID Server running on http://localhost:${PORT}`);
    
    // Optional: Auto-index some sample sites for MVP demo
    crawlerInstance.startCrawl("https://en.wikipedia.org/wiki/Main_Page", 5).catch(console.error);
  });
}

startServer();
