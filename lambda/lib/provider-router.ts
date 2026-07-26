import { BedrockProvider } from "./bedrock-provider";
import { GenerateChatProvider } from "./provider";
import { SageMakerGenerateChatProviderClassFactory } from "./sagemaker-providers/generate-chat-provider";

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

type GetProviderResult =
  | {
      provider: GenerateChatProvider;
      error: null;
    }
  | {
      provider: null;
      error: string;
    };

export function getProvider(
  modelId: string,
  type = "generate-chat",
): GetProviderResult {
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
  return {
    provider: null,
    error: `Unsupported provider type: ${type}`,
  };
}
