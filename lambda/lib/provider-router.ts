import { BedrockProvider } from "./bedrock-provider";
import { GenerateChatProvider, GenerateImageProvider } from "./provider";
import { SageMakerGenerateChatProviderClassFactory } from "./sagemaker-providers/generate-chat-provider";
import { SageMakerGenerateImageProviderClassFactory } from "./sagemaker-providers/generate-image-provider";

// Passing the classes directly for lazy instantiation to avoid creating instances of all providers on startup.
const GENERATE_CHAT_PROVIDERS: Record<string, new () => GenerateChatProvider> =
  {
    "amazon.nova-micro-v1:0": BedrockProvider,
    "google.gemma-3-4b-it": BedrockProvider,
    "openai.gpt-oss-20b-1:0": BedrockProvider,
    "deepseek.v3-v1:0": BedrockProvider,
    "meta.llama-1-7b": SageMakerGenerateChatProviderClassFactory(
      "llama-1-7b-generate-text",
    ),
    "meta.llama-3.2-3b-instruct": SageMakerGenerateChatProviderClassFactory(
      "llama-3-2-3b-instruct-generate-text",
    ),
  } as const satisfies Record<string, new () => GenerateChatProvider>;

export const GENERATE_CHAT_PROVIDER_NAMES = Object.keys(
  GENERATE_CHAT_PROVIDERS,
);

const GENERATE_IMAGE_PROVIDERS: Record<
  string,
  new () => GenerateImageProvider
> = {
  "stable-diffusion-v1-5/stable-diffusion-v1-5":
    SageMakerGenerateImageProviderClassFactory(
      "stable-diffusion-v1-5-generate-image",
    ),
} as const satisfies Record<string, new () => GenerateImageProvider>;

export const GENERATE_IMAGE_PROVIDER_NAMES = Object.keys(
  GENERATE_IMAGE_PROVIDERS,
);

type GetGenerateChatProviderResult =
  | {
      provider: GenerateChatProvider;
      error: null;
    }
  | {
      provider: null;
      error: string;
    };

type GetGenerateImageProviderResult =
  | {
      provider: GenerateImageProvider;
      error: null;
    }
  | {
      provider: null;
      error: string;
    };

export function getProvider(
  modelId: string,
  type: "generate-image",
): GetGenerateImageProviderResult;
export function getProvider(
  modelId: string,
  type?: "generate-chat",
): GetGenerateChatProviderResult;
export function getProvider(
  modelId: string,
  type: "generate-chat" | "generate-image" = "generate-chat",
): GetGenerateChatProviderResult | GetGenerateImageProviderResult {
  if (type === "generate-chat") {
    const ProviderClass = GENERATE_CHAT_PROVIDERS[modelId];
    if (!ProviderClass)
      return {
        provider: null,
        error: `No provider found for model: ${modelId}`,
      };
    return {
      provider: new ProviderClass(),
      error: null,
    };
  }
  if (type === "generate-image") {
    const ProviderClass = GENERATE_IMAGE_PROVIDERS[modelId];
    if (!ProviderClass)
      return {
        provider: null,
        error: `No provider found for model: ${modelId}`,
      };
    return {
      provider: new ProviderClass(),
      error: null,
    };
  }
  return {
    provider: null,
    error: `Unsupported provider type: ${type}`,
  };
}
