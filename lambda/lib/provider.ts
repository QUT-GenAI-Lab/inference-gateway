import { z } from "zod";
import { randomBytes } from "node:crypto";
import {
  GENERATE_CHAT_PROVIDER_NAMES,
  GENERATE_IMAGE_PROVIDER_NAMES,
} from "./provider-router";
import { PreprocessorBuilder } from "./utils/preprocessors";

export const NEXT_TOKEN_MIN_TOP_K = 1;
export const NEXT_TOKEN_DEFAULT_TOP_K = 10;
export const NEXT_TOKEN_MAX_TOP_K = 50;
export const NEXT_TOKEN_MAX_TEXT_LENGTH = 2000;
export const GENERATE_IMAGE_DEFAULT_INFERENCE_STEPS = 10;
export const GENERATE_IMAGE_DEFAULT_GUIDANCE_SCALE = 5;
export const GENERATE_IMAGE_MAX_PROMPT_LENGTH = 2000;
export const GENERATE_IMAGE_MIN_DIMENSION = 64;
export const GENERATE_IMAGE_MAX_DIMENSION = 1024;
export const GENERATE_IMAGE_MAX_SEED = 4_294_967_295;

export const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png"] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

function randomImageSeed(): number {
  return randomBytes(4).readUInt32BE(0);
}

const jsonPreprocessor = new PreprocessorBuilder()
  .parseJsonTuple()
  .normaliseEcoMetricsResponse()
  .build();

const EmissionsDataSchema = z.object({
  timestamp: z.string().optional().openapi({
    description:
      "The exact timestamp marking when the tracking session ended or data was recorded (UTC, ISO 8601).",
  }),
  project_name: z.string().optional(),
  run_id: z.string().optional(),
  experiment_id: z.string().optional(),
  duration: z.number().optional().openapi({
    description:
      "The total active runtime duration of the tracked block of code, in seconds.",
  }),
  emissions: z.number().optional().openapi({
    description:
      "The total estimated carbon dioxide equivalent emitted during the session, in kilograms (kg CO₂eq).",
  }),
  emissions_rate: z.number().optional().openapi({
    description:
      "The rate of carbon emissions produced per second, in kilograms per second (kg/s).",
  }),
  cpu_power: z.number().optional().openapi({
    description:
      "The average or real-time power draw of the CPU(s), in watts (W).",
  }),
  gpu_power: z.number().optional().openapi({
    description:
      "The average or real-time power draw of the GPU(s), in watts (W).",
  }),
  ram_power: z.number().optional().openapi({
    description:
      "The estimated power draw of the system memory (RAM), in watts (W).",
  }),
  cpu_energy: z.number().optional().openapi({
    description:
      "The specific portion of electrical energy consumed exclusively by the CPU(s), in kilowatt-hours (kWh).",
  }),
  gpu_energy: z.number().optional().openapi({
    description:
      "The specific portion of electrical energy consumed exclusively by the GPU(s) (if present), in kilowatt-hours (kWh).",
  }),
  ram_energy: z.number().optional().openapi({
    description:
      "The estimated portion of electrical energy consumed by the system's RAM, in kilowatt-hours (kWh).",
  }),
  energy_consumed: z.number().optional().openapi({
    description:
      "The total electrical energy consumed by all tracked hardware components combined, in kilowatt-hours (kWh).",
  }),
  water_consumed: z.number().optional().openapi({
    description:
      "The estimated volume of water used for cooling and other data center operations during the tracking session, in liters (L).",
  }),
  country_name: z.string().optional().openapi({
    description:
      "The country name associated with the electricity grid configuration or geolocation.",
  }),
  country_iso_code: z.string().optional().openapi({
    description:
      "The ISO 3166-1 alpha-3 country code (e.g., AUS, USA) used to fetch grid data.",
  }),
  region: z.string().optional().openapi({
    description:
      "The sub-national region or cloud provider zone specified (if applicable).",
  }),
  cloud_provider: z.string().optional().openapi({
    description:
      "The name of the cloud service provider if running on a cloud instance (e.g., aws), or blank if local.",
  }),
  cloud_region: z.string().optional().openapi({
    description: "The specific data center region of the cloud provider.",
  }),
  carbon_intensity: z.number().optional().openapi({
    description:
      "The carbon intensity factor of the local electricity grid at that location, in grams per kilowatt-hour (g CO2eq/kWh).",
  }),
  os: z.string().optional().openapi({
    description: "The operating system running the hardware during tracking.",
  }),
  python_version: z.string().optional().openapi({
    description: "The version of Python being used during execution.",
  }),
  codecarbon_version: z.string().optional().openapi({
    description:
      "The version of the CodeCarbon library used to generate the data.",
  }),
  cpu_count: z.number().optional().openapi({
    description: "The total number of CPU cores available or utilized.",
  }),
  cpu_model: z.string().optional().openapi({
    description: "The specific hardware model name of the CPU.",
  }),
  gpu_count: z.number().optional().openapi({
    description: "The total number of available GPU units.",
  }),
  gpu_model: z.string().optional().openapi({
    description: "The specific hardware model name of the GPU(s), if present.",
  }),
  longitude: z.number().optional().openapi({
    description:
      "The geographic longitude coordinate used for grid carbon intensity lookup.",
  }),
  latitude: z.number().optional().openapi({
    description:
      "The geographic latitude coordinate used for grid carbon intensity lookup.",
  }),
  ram_total_size: z.number().optional().openapi({
    description: "The total system RAM capacity, in gigabytes (GB).",
  }),
  tracking_mode: z.string().optional().openapi({
    description:
      "The mode used by CodeCarbon for hardware power tracking (e.g., process, machine).",
  }),
  cpu_utilization_percent: z.number().optional().openapi({
    description:
      "The percentage of CPU utilization during the tracking session.",
  }),
  gpu_utilization_percent: z.number().optional().openapi({
    description:
      "The percentage of GPU utilization during the tracking session.",
  }),
  ram_utilization_percent: z.number().optional().openapi({
    description:
      "The percentage of system RAM utilization during the tracking session.",
  }),
  ram_used_gb: z.number().optional().openapi({
    description: "The amount of system RAM currently used, in gigabytes (GB).",
  }),
  on_cloud: z.string().optional().openapi({
    description:
      "Indicates whether the workload is running on a cloud instance (typically 'Y' or 'N').",
  }),
  pue: z.number().optional().openapi({
    description:
      "The Power Usage Effectiveness (PUE) factor applied for data center energy efficiency overhead.",
  }),
  wue: z.number().optional().openapi({
    description:
      "The Water Usage Effectiveness (WUE) factor applied for data center water usage estimation.",
  }),
});

const EcoMetricsSchema = z.object({
  co2_emissions_grams: z.number().optional(),
  energy_consumed_kwh: z.number().optional(),
  water_consumed_liters: z.number().optional(),
  detailed_emissions: EmissionsDataSchema,
});

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
    includeEcoMetrics: z.boolean().default(false).openapi({
      description:
        "Whether to include inference energy, water, and emissions metrics in the response when supported by the provider.",
      example: false,
    }),
    model: z
      .enum(GENERATE_CHAT_PROVIDER_NAMES)
      .default("amazon.nova-micro-v1:0")
      .openapi({
        description: "The Bedrock model to use for generating the response.",
      }),
  }),
  output: z
    .preprocess(
      jsonPreprocessor,
      z.object({
        content: z.string(),
        ecoMetrics: EcoMetricsSchema.optional(),
      }),
    )
    .openapi({
      description: "The generated response from the model.",
      example: {
        content: "The capital of France is Paris.",
      },
    }),
};

const ImageDimensionSchema = z
  .number()
  .int()
  .min(GENERATE_IMAGE_MIN_DIMENSION)
  .max(GENERATE_IMAGE_MAX_DIMENSION)
  .multipleOf(8);

export const GenerateImageSchema = {
  input: z.object({
    prompt: z.string().min(0).max(GENERATE_IMAGE_MAX_PROMPT_LENGTH).openapi({
      description: "Text prompt describing the image to generate.",
      example: "A cozy treehouse at sunset, digital art",
    }),
    dimensions: z
      .object({
        width: ImageDimensionSchema.openapi({ example: 512, multipleOf: 8 }),
        height: ImageDimensionSchema.openapi({ example: 512, multipleOf: 8 }),
      })
      .openapi({
        description:
          "Output dimensions in pixels. Each value must be divisible by 8.",
      }),
    seed: z
      .number()
      .int()
      .min(0)
      .max(GENERATE_IMAGE_MAX_SEED)
      .optional()
      .transform((seed) => seed ?? randomImageSeed())
      .openapi({
        description:
          "Unsigned 32-bit seed. A random seed is generated when omitted.",
        example: 42,
      }),
    config: z
      .object({
        num_inference_steps: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(GENERATE_IMAGE_DEFAULT_INFERENCE_STEPS),
        guidance_scale: z
          .number()
          .min(0)
          .max(20)
          .default(GENERATE_IMAGE_DEFAULT_GUIDANCE_SCALE),
      })
      .default({
        num_inference_steps: GENERATE_IMAGE_DEFAULT_INFERENCE_STEPS,
        guidance_scale: GENERATE_IMAGE_DEFAULT_GUIDANCE_SCALE,
      })
      .openapi({
        description: "Stable Diffusion sampling configuration.",
      }),
    model: z.enum(GENERATE_IMAGE_PROVIDER_NAMES).openapi({
      description: "The image generation model to use.",
      example: "stable-diffusion-v1-5/stable-diffusion-v1-5",
    }),
  }),
  output: z
    .object({
      bytes: z.instanceof(Uint8Array<ArrayBuffer>).openapi({
        description: "The generated image bytes.",
      }),
      contentType: z.enum(IMAGE_MEDIA_TYPES).openapi({
        description: "The MIME type of the generated image.",
      }),
    })
    .openapi({
      description: "The generated image and its metadata.",
      example: {
        bytes: [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82],
        contentType: "image/png",
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
      jsonPreprocessor,
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

export interface GenerateImageProvider extends BaseProvider {
  generateImage(
    input: z.infer<typeof GenerateImageSchema.input>,
    accept: ImageMediaType,
  ): Promise<z.infer<typeof GenerateImageSchema.output>>;
}

export interface NextTokenProvider extends BaseProvider {
  predictNextToken(
    input: z.infer<typeof NextTokenSchema.input> & { top_k: number },
  ): Promise<z.infer<typeof NextTokenSchema.output>>;
}
