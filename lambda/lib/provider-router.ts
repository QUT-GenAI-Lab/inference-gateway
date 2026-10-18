import { BedrockProvider } from "./bedrock-provider";
import { Ec2GenerateChatProviderClassFactory } from "./ec2-providers/generate-chat-provider";
import { Ec2GenerateImageProviderClassFactory } from "./ec2-providers/generate-image-provider";
import { GenerateChatProvider, GenerateImageProvider } from "./provider";
import { SageMakerGenerateChatProviderClassFactory } from "./sagemaker-providers/generate-chat-provider";
import { SageMakerGenerateImageProviderClassFactory } from "./sagemaker-providers/generate-image-provider";

// Store constructors so providers are created only when requested.
// EC2 service names must match the GPU Compose catalog.
const GENERATE_CHAT_PROVIDERS: Record<string, new () => GenerateChatProvider> = {
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
  "dev.meta.llama-3.2-3b-instruct": Ec2GenerateChatProviderClassFactory(
    "llama",
    "dev.meta.llama-3.2-3b-instruct",
  ),
};

export const GENERATE_CHAT_PROVIDER_NAMES = Object.keys(
  GENERATE_CHAT_PROVIDERS,
);

const GENERATE_IMAGE_PROVIDERS: Record<string, new () => GenerateImageProvider> = {
  "stable-diffusion-v1-5/stable-diffusion-v1-5":
    SageMakerGenerateImageProviderClassFactory(
      "stable-diffusion-v1-5-generate-image",
    ),
  "dev.stable-diffusion-v1-5/stable-diffusion-v1-5":
    Ec2GenerateImageProviderClassFactory(
      "stable-diffusion",
      "dev.stable-diffusion-v1-5/stable-diffusion-v1-5",
    ),
};

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
