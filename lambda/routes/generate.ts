import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { GenerateChatSchema } from "../lib/provider";
import { getProvider } from "../lib/provider-router";
import { z } from "zod";

const route = new OpenAPIHono();

route.openapi(
  createRoute({
    path: "chat",
    method: "post",
    security: [{ apiKey: [] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: GenerateChatSchema.input,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Successful response",
        content: {
          "application/json": {
            schema: GenerateChatSchema.output,
          },
        },
      },
      404: {
        description: "Provider not found",
        content: {
          "application/json": {
            schema: z.object({
              error: z.string().openapi({
                example: "No provider found for model: <model_id>",
              }),
            }),
          },
        },
      },
      503: {
        description: "Service Unavailable - Provider not ready",
        content: {
          "application/json": {
            schema: z.object({
              error: z.string().openapi({
                example:
                  "Provider for model <model_id> is not ready. Please try again later.",
              }),
            }),
          },
        },
      },
    },
  }),
  async (c) => {
    const input = c.req.valid("json");
    const { provider, error } = getProvider(input.model, "generate-chat");
    if (!provider) {
      return c.json({ error }, 404);
    }
    // Checks if the provider is ready first
    const isReady = await provider.isReady();
    if (!isReady) {
      return c.json(
        {
          error: `Provider for model ${input.model} is not ready. Please try again later.`,
        },
        503,
      );
    }
    const output = await provider.generateChat(input);
    return c.json(output, 200);
  },
);

export default route;
