import { handle } from "hono/aws-lambda";
import generateRoute from "./routes/generate";
import healthRoute from "./routes/health";
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";

export const app = new OpenAPIHono();
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["*"],
  }),
);
app.openAPIRegistry.registerComponent("securitySchemes", "apiKey", {
  type: "apiKey",
  in: "header",
  name: "x-api-key",
});

app.route("/health", healthRoute);
app.route("/generate", generateRoute);

export const handler = handle(app);
