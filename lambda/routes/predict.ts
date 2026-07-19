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
      503: {
        description: "Service Unavailable - SageMaker endpoint not ready",
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
      const isReady = await provider.isReady();
      if (!isReady) {
        return c.json(
          {
            error: {
              code: "PROVIDER_NOT_READY",
              message:
                "SageMaker endpoint is not ready. Please try again later.",
            },
          },
          503,
        );
      }

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
