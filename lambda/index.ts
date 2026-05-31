import { handle } from "hono/aws-lambda";
import generateRoute from "./routes/generate";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
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

app.openapi(
  createRoute({
    path: "/",
    method: "get",
    security: [{ apiKey: [] }],
    responses: {
      200: {
        description: "Successful response",
        content: {
          "application/json": {
            schema: z
              .object({
                message: z.string(),
              })
              .openapi({
                example: {
                  message: "Hello Hono!",
                },
              }),
          },
        },
      },
    },
  }),
  async (c) => {
    return c.json({ message: "Hello Hono!" });
  },
);
app.route("/generate", generateRoute);

export const handler = handle(app);
