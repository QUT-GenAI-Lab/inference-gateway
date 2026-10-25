import { z } from "zod";
import {
  GenerateChatProvider,
  GenerateChatSchema,
  ProviderNotReadyError,
} from "../provider";
import { Ec2GpuManagerClient, isEc2ModelReady } from "./manager-client";

export class Ec2GenerateChatProvider implements GenerateChatProvider {
  private readonly client: Ec2GpuManagerClient;
  private readonly modelId: string;

  constructor(service: string, modelId: string) {
    this.client = new Ec2GpuManagerClient(service);
    this.modelId = modelId;
  }

  isReady(): Promise<boolean> {
    return isEc2ModelReady(this.client);
  }

  async generateChat(
    input: z.infer<typeof GenerateChatSchema.input>,
  ): Promise<z.infer<typeof GenerateChatSchema.output>> {
    const response = await this.client.invoke({
      messages: input.messages,
      system: input.system,
      includeEcoMetrics: input.includeEcoMetrics,
    });

    if (response.status === 503) {
      throw new ProviderNotReadyError(
        `Provider for model ${this.modelId} is not ready. Please try again later.`,
      );
    }
    if (!response.ok) {
      throw new Error(`EC2 GPU model returned HTTP ${response.status}.`);
    }

    const payload: unknown = await response.json();
    const result = GenerateChatSchema.output.safeParse(payload);
    if (!result.success) {
      throw new Error(
        `EC2 GPU model returned an invalid chat response: ${result.error.message}`,
      );
    }

    return result.data;
  }
}

export function Ec2GenerateChatProviderClassFactory(
  service: string,
  modelId: string,
): new () => Ec2GenerateChatProvider {
  return class extends Ec2GenerateChatProvider {
    constructor() {
      super(service, modelId);
    }
  };
}
