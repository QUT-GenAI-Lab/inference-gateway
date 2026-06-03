import { z } from "zod";

export const GenerateChatSchema = {
  input: z.object({
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]).openapi({
            description:
              "The role of the message sender, which can be 'user', or 'assistant'.",
          }),
          content: z.string(),
        }),
      )
      .openapi({
        description: "An array of messages forming the conversation history.",
        example: [
          {
            role: "user",
            content: "Who are you?",
          },
        ],
      }),
    system: z.string().optional().openapi({
      description:
        "Optional system instructions to guide the model's behavior.",
      example: "You are a helpful assistant that provides concise answers.",
    }),
    model: z
      .enum([
        "amazon.nova-micro-v1:0",
        "google.gemma-3-4b-it",
        "openai.gpt-oss-20b-1:0",
        "deepseek.v3-v1:0",
      ])
      .default("amazon.nova-micro-v1:0")
      .openapi({
        description: "The Bedrock model to use for generating the response.",
      }),
  }),
  output: z
    .object({
      content: z.string(),
    })
    .openapi({
      description: "The generated response from the model.",
      example: {
        content: "The capital of France is Paris.",
      },
    }),
};

export const GenerateTextSchema = {};

export interface Provider {
  generateChat(
    input: z.infer<typeof GenerateChatSchema.input>,
  ): Promise<z.infer<typeof GenerateChatSchema.output>>;
}
