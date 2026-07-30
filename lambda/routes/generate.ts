import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  GenerateChatSchema,
  GenerateImageSchema,
  ImageMediaType,
} from "../lib/provider";
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

const ImageErrorSchema = z.object({
  error: z.string(),
});

const BinaryImageSchema = z.string().openapi({
  format: "binary",
  description: "Generated image bytes.",
});

type AcceptedMediaRange = {
  mediaRange: string;
  quality: number;
  order: number;
};

function parseAcceptedMediaRanges(acceptHeader: string): AcceptedMediaRange[] {
  return acceptHeader.split(",").map((entry, order) => {
    const [rawMediaRange, ...parameters] = entry.split(";");
    const qualityParameter = parameters
      .map((parameter) => parameter.trim().toLowerCase())
      .find((parameter) => parameter.startsWith("q="));
    const parsedQuality = qualityParameter
      ? Number(qualityParameter.slice(2))
      : 1;
    const quality =
      Number.isFinite(parsedQuality) && parsedQuality >= 0 && parsedQuality <= 1
        ? parsedQuality
        : 0;

    return {
      mediaRange: rawMediaRange.trim().toLowerCase(),
      quality,
      order,
    };
  });
}

function matchSpecificity(
  mediaRange: string,
  candidate: ImageMediaType,
): number {
  if (mediaRange === candidate) return 2;
  if (mediaRange === "image/*") return 1;
  if (mediaRange === "*/*") return 0;
  return -1;
}

export function negotiateImageMediaType(
  acceptHeader?: string,
): ImageMediaType | null {
  if (!acceptHeader?.trim()) {
    return "image/jpeg";
  }

  const ranges = parseAcceptedMediaRanges(acceptHeader);
  const candidates = (["image/jpeg", "image/png"] as const)
    .map((contentType, preference) => {
      const match = ranges
        .map((range) => ({
          ...range,
          specificity: matchSpecificity(range.mediaRange, contentType),
        }))
        .filter((range) => range.specificity >= 0)
        .sort(
          (left, right) =>
            right.specificity - left.specificity || left.order - right.order,
        )[0];

      return {
        contentType,
        quality: match?.quality ?? 0,
        specificity: match?.specificity ?? -1,
        preference,
      };
    })
    .filter((candidate) => candidate.quality > 0)
    .sort(
      (left, right) =>
        right.quality - left.quality ||
        right.specificity - left.specificity ||
        left.preference - right.preference,
    );

  return candidates[0]?.contentType ?? null;
}

route.openapi(
  createRoute({
    path: "image",
    method: "post",
    security: [{ apiKey: [] }],
    request: {
      headers: z.object({
        accept: z.string().optional().openapi({
          description:
            "Preferred image response media type. Missing and wildcard values default to image/jpeg.",
          example: "image/png",
        }),
      }),
      body: {
        content: {
          "application/json": {
            schema: GenerateImageSchema.input,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Generated image",
        content: {
          "image/jpeg": { schema: BinaryImageSchema },
          "image/png": { schema: BinaryImageSchema },
        },
      },
      400: {
        description: "Invalid image generation request",
        content: {
          "application/json": { schema: ImageErrorSchema },
        },
      },
      404: {
        description: "Provider not found",
        content: {
          "application/json": { schema: ImageErrorSchema },
        },
      },
      406: {
        description: "No supported image response media type is acceptable",
        content: {
          "application/json": { schema: ImageErrorSchema },
        },
      },
      500: {
        description: "Image generation failed",
        content: {
          "application/json": { schema: ImageErrorSchema },
        },
      },
      503: {
        description: "Service Unavailable - Provider not ready",
        content: {
          "application/json": { schema: ImageErrorSchema },
        },
      },
    },
  }),
  async (c) => {
    const input = c.req.valid("json");
    const accept = negotiateImageMediaType(c.req.header("accept"));

    if (!accept) {
      return c.json(
        { error: "Accept must allow image/jpeg or image/png." },
        406,
      );
    }

    const { provider, error } = getProvider(input.model, "generate-image");
    if (!provider) {
      return c.json({ error }, 404);
    }

    try {
      if (!(await provider.isReady())) {
        return c.json(
          {
            error: `Provider for model ${input.model} is not ready. Please try again later.`,
          },
          503,
        );
      }

      const output = await provider.generateImage(input, accept);
      return c.body(output.bytes, 200, {
        "Content-Type": output.contentType,
        "Cache-Control": "no-store",
      });
    } catch (error) {
      console.error("Image generation failed", error);
      return c.json({ error: "Image generation failed." }, 500);
    }
  },
  (result, c) => {
    if (result.success) {
      return undefined;
    }
    if (
      result.target === "json" &&
      result.error.issues.some((issue) => issue.path.at(-1) === "model")
    ) {
      return c.json({ error: "No provider found for requested model." }, 404);
    }
    return c.json({ error: "Invalid image generation request." }, 400);
  },
);

export default route;
