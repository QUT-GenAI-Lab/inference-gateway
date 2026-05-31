import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

const route = new OpenAPIHono();

const GenerateTextInSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.string(),
        content: z.string(),
      }),
    )
    .openapi({
      example: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "What is the capital of France?" },
      ],
    }),
});

const GenerateTextOutSchema = z.object({
  content: z.string(),
});

async function generateText(
  input: z.infer<typeof GenerateTextInSchema>,
): Promise<{ content: string }> {
  const { messages } = input;
  const lastMessage = messages[messages.length - 1];
  return {
    content: `Last message received: ${lastMessage.content}`,
  };
}

route.openapi(
  createRoute({
    path: "text",
    method: "post",
    security: [{ apiKey: [] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: GenerateTextInSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Successful response",
        content: {
          "application/json": {
            schema: GenerateTextOutSchema,
          },
        },
      },
    },
  }),
  async (c) => {
    const { messages } = c.req.valid("json");
    const result = await generateText({ messages });
    return c.json(result);
  },
);

export default route;
