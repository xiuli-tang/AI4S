import express from "express";
import { resolve, sep } from "node:path";

export function productionAssets(directory = "dist") {
  const root = resolve(directory), assets = root + sep + "assets" + sep;
  return express.static(root, {
    setHeaders(res, filename) {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", filename.startsWith(assets) && /-[\w-]{8,}\.[\w.]+$/.test(filename)
        ? "public, max-age=31536000, immutable" : "no-cache");
    },
  });
}
