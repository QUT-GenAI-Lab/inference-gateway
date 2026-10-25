import { z } from "zod";
import {
  GenerateImageProvider,
  GenerateImageSchema,
  ImageMediaType,
  ProviderNotReadyError,
} from "../provider";
import { validateImageResponse } from "../utils/image-response";
import { Ec2GpuManagerClient, isEc2ModelReady } from "./manager-client";

export class Ec2GenerateImageProvider implements GenerateImageProvider {
  private readonly client: Ec2GpuManagerClient;
  private readonly modelId: string;

  constructor(service: string, modelId: string) {
    this.client = new Ec2GpuManagerClient(service);
    this.modelId = modelId;
  }

  isReady(): Promise<boolean> {
    return isEc2ModelReady(this.client);
  }

  async generateImage(
    input: z.infer<typeof GenerateImageSchema.input>,
    accept: ImageMediaType,
  ): Promise<z.infer<typeof GenerateImageSchema.output>> {
    const response = await this.client.invoke(input, accept);

    if (response.status === 503) {
      throw new ProviderNotReadyError(
        `Provider for model ${this.modelId} is not ready. Please try again later.`,
      );
    }
    if (!response.ok) {
      throw new Error(`EC2 GPU model returned HTTP ${response.status}.`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    return validateImageResponse(
      bytes,
      response.headers.get("content-type") ?? undefined,
      accept,
      "EC2 GPU model",
    );
  }
}

export function Ec2GenerateImageProviderClassFactory(
  service: string,
  modelId: string,
): new () => Ec2GenerateImageProvider {
  return class extends Ec2GenerateImageProvider {
    constructor() {
      super(service, modelId);
    }
  };
}
