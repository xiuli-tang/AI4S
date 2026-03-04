import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

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
