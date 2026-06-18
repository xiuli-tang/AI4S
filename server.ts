import express, { Request, Response } from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/materials", async (req, res) => {
    const apiKey = process.env.MP_API_KEY?.trim();
    const limit = parseInt(req.query.limit as string) || 150;

    if (!apiKey) {
      console.error("MP_API_KEY is missing in environment variables.");
      return res.status(500).json({ error: "MP_API_KEY not configured on server" });
    }

    console.log(`MP API Request: Key length=${apiKey.length}, Prefix=${apiKey.substring(0, 4)}`);

    try {
      const baseUrl = "https://api.materialsproject.org";
      let allData: any[] = [];
      let skip = 0;
      const batchSize = 1000;
      const targetLimit = limit > 10000 ? 10000 : limit; // Safety cap at 10k

      console.log(`Starting MP data fetch for ${targetLimit} materials...`);

      while (allData.length < targetLimit) {
        const currentLimit = Math.min(batchSize, targetLimit - allData.length);
        const response = await axios.get(`${baseUrl}/materials/summary/`, {
          headers: {
            "accept": "application/json",
            "X-API-KEY": apiKey,
            "User-Agent": "AMI-AL-Prototype/2.0",
          },
          params: {
            elements: "Li,O",
            _limit: currentLimit,
            _skip: skip,
            _fields: "material_id,formula_pretty,elements,composition,band_gap,formation_energy_per_atom",
          },
        });

        const data = response.data.data;
        if (!data || data.length === 0) break;

        allData = allData.concat(data);
        skip += data.length;

        console.log(`Fetched ${allData.length}/${targetLimit} materials...`);

        if (data.length < currentLimit) break; // No more data available
      }

      console.log("MP API Success! Total docs retrieved:", allData.length);
      res.json({ data: allData, meta: { total_doc: allData.length } });
    } catch (error: any) {
      const status = error.response?.status;
      const data = error.response?.data;

      console.error(`MP API Error [${status}]:`, JSON.stringify(data) || error.message);

      // If 403, try a fallback or provide more context
      if (status === 403) {
        console.log("403 detected. This often means the API key is invalid for the new API (v2) or has been rate-limited/blocked.");
      }

      res.status(status || 500).json({
        error: "Failed to fetch from Materials Project",
        status,
        details: data,
        message: error.message
      });
    }
  });

  // Chat completion proxy via DeepSeek (OpenAI-compatible)
  app.post("/api/chat", async (req: Request, res: Response) => {
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();

    if (!apiKey) {
      console.error("DEEPSEEK_API_KEY is missing in environment variables.");
      return res.status(500).json({ error: "DEEPSEEK_API_KEY not configured on server" });
    }

    const { messages, model = "deepseek-chat", temperature = 0.7, max_tokens = 2048 } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages must be a non-empty array" });
    }

    try {
      const completion = await openai.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens,
        stream: false,
      });

      res.json({
        model: completion.model,
        choices: completion.choices.map((choice) => ({
          index: choice.index,
          message: choice.message,
          finish_reason: choice.finish_reason,
        })),
        usage: completion.usage,
      });
    } catch (error: any) {
      const status = error.status || 500;
      const message = error.message || "Unknown error";
      console.error(`DeepSeek API Error [${status}]:`, message);
      res.status(status).json({ error: "Failed to call DeepSeek API", details: message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
