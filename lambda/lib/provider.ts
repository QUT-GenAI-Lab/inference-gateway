import { z } from "zod";
import { GENERATE_CHAT_PROVIDER_NAMES } from "./provider-router";

export const NEXT_TOKEN_MIN_TOP_K = 1;
export const NEXT_TOKEN_DEFAULT_TOP_K = 10;
export const NEXT_TOKEN_MAX_TOP_K = 50;
export const NEXT_TOKEN_MAX_TEXT_LENGTH = 2000;

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
      .enum(GENERATE_CHAT_PROVIDER_NAMES)
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

export const NextTokenSchema = {
  input: z.object({
    text: z.string().max(NEXT_TOKEN_MAX_TEXT_LENGTH).openapi({
      description: "Input text used as context for next-token prediction.",
      example: "The weather today is",
    }),
    top_k: z.number().int().optional().openapi({
      description:
        "Number of token predictions to return. Values are clamped to 1-50.",
      example: NEXT_TOKEN_DEFAULT_TOP_K,
    }),
  }),
  output: z
    .preprocess(
      (value) => {
        if (
          Array.isArray(value) &&
          value.length === 2 &&
          typeof value[0] === "string" &&
          value[1] === "application/json"
        ) {
          try {
            return JSON.parse(value[0]);
          } catch {
            return value;
          }
        }

        return value;
      },
      z.object({
        tokens: z.array(
          z.object({
            rank: z.number().int().positive(),
            token_id: z.number().int(),
            token: z.string(),
            display: z.string(),
            probability: z.number(),
            percentage: z.number(),
            logprob: z.number(),
          }),
        ),
      }),
    )
    .openapi({
      description:
        "Top GPT-2 next-token predictions. Also accepts [jsonString, 'application/json'] and parses it.",
      example: {
        tokens: [
          {
            rank: 1,
            token_id: 2576,
            token: " sunny",
            display: "sunny",
            probability: 0.0912,
            percentage: 9.12,
            logprob: -2.395,
          },
        ],
      },
    }),
};

export const ApiErrorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
    }),
  })
  .openapi({
    description: "Error response from the inference gateway.",
    example: {
      error: {
        code: "PREDICTION_FAILED",
        message: "Prediction failed",
      },
    },
  });

export function clampNextTokenTopK(topK?: number): number {
  if (topK === undefined) {
    return NEXT_TOKEN_DEFAULT_TOP_K;
  }

  return Math.min(
    NEXT_TOKEN_MAX_TOP_K,
    Math.max(NEXT_TOKEN_MIN_TOP_K, Math.trunc(topK)),
  );
}

export function normalizeNextTokenInput(
  input: z.infer<typeof NextTokenSchema.input>,
): z.infer<typeof NextTokenSchema.input> & { top_k: number } {
  return {
    text: input.text,
    top_k: clampNextTokenTopK(input.top_k),
  };
}

interface BaseProvider {
  isReady(): Promise<boolean>;
}

export interface GenerateChatProvider extends BaseProvider {
  generateChat(
    input: z.infer<typeof GenerateChatSchema.input>,
  ): Promise<z.infer<typeof GenerateChatSchema.output>>;
}

export interface NextTokenProvider extends BaseProvider {
  predictNextToken(
    input: z.infer<typeof NextTokenSchema.input> & { top_k: number },
  ): Promise<z.infer<typeof NextTokenSchema.output>>;
}
