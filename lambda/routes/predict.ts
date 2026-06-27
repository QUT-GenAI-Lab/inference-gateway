import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  ApiErrorSchema,
  NextTokenSchema,
  normalizeNextTokenInput,
} from "../lib/provider";
import { SageMakerGpt2Provider } from "$lib/sagemaker-gpt2-provider";

const route = new OpenAPIHono();
const provider = new SageMakerGpt2Provider();

route.openapi(
  createRoute({
    path: "next-token",
    method: "post",
    security: [{ apiKey: [] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: NextTokenSchema.input,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Successful next-token prediction response",
        content: {
          "application/json": {
            schema: NextTokenSchema.output,
          },
        },
      },
      500: {
        description: "Prediction failed",
        content: {
          "application/json": {
            schema: ApiErrorSchema,
          },
        },
      },
    },
  }),
  async (c) => {
    const input = normalizeNextTokenInput(c.req.valid("json"));

    if (!input.text.trim()) {
      return c.json({ tokens: [] }, 200);
    }

    try {
      const output = await provider.predictNextToken(input);
      return c.json(output, 200);
    } catch (error) {
      console.error("Next-token prediction failed", error);
      return c.json(
        {
          error: {
            code: "PREDICTION_FAILED",
            message: "Prediction failed",
          },
        },
        500,
      );
    }
  },
);

export default route;
