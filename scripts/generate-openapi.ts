import fs from "fs";
import path from "path";
import { app } from "../lambda"; // Your main app file

const args = process.argv.slice(2);
const baseUrl = args[0] || "https://inference.genai-arcade.net";

// Get the spec from your OpenAPIHono instance
const spec = app.getOpenAPIDocument({
  openapi: "3.1.0",
  info: { title: "Inference Gateway API", version: "1.0.0" },
  ...(baseUrl ? { servers: [{ url: baseUrl }] } : {}),
});

// Write the spec to a file
const OUTPUT_PATH = path.join(__dirname, "..", "public", "swagger.json");
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(spec, null, 2));
console.log(
  `OpenAPI spec generated at ${OUTPUT_PATH}` +
    (baseUrl ? ` with base URL ${baseUrl}` : ""),
);
