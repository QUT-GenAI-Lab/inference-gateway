import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { GenerateChatSchema } from "../lib/provider";
import { BedrockProvider } from "$lib/bedrock-provider";

const route = new OpenAPIHono();
const provider = new BedrockProvider();

route.openapi(
  createRoute({
    path: "text",
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
    },
  }),
  async (c) => {
    const input = c.req.valid("json");
    const output = await provider.generateChat(input);
    return c.json(output);
  },
);

export default route;
