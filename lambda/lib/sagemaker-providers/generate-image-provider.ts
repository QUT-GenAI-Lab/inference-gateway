import {
  InvokeEndpointCommand,
  SageMakerRuntimeClient,
} from "@aws-sdk/client-sagemaker-runtime";
import { z } from "zod";
import {
  GenerateImageProvider,
  GenerateImageSchema,
  ImageMediaType,
} from "../provider";
import { validateImageResponse } from "../utils/image-response";

const client = new SageMakerRuntimeClient({
  region: process.env.AWS_REGION,
});

class SageMakerGenerateImageProvider implements GenerateImageProvider {
  private readonly endpointName?: string;

  constructor(endpointName?: string) {
    this.endpointName = endpointName;
  }

  async isReady(): Promise<boolean> {
    if (!this.endpointName) {
      throw new Error(
        "A SageMaker image generation endpoint name is required to check readiness.",
      );
    }

    try {
      await client.send(
        new InvokeEndpointCommand({
          EndpointName: this.endpointName,
          InferenceComponentName: `${this.endpointName}-inference-component`,
          ContentType: "application/json",
          Accept: "application/json",
          Body: Buffer.from(JSON.stringify({ healthCheck: true })),
        }),
      );
      return true;
    } catch (error) {
      // SageMaker real-time endpoints backed by inference components with
      // scale-to-zero return a ValidationError while there are zero active
      // copies. That failed invocation emits NoCapacityInvocationFailures and
      // wakes the inference component. Report not-ready until a copy is live.
      console.error(
        `SageMaker endpoint ${this.endpointName} not ready (possibly scaling out from zero):`,
        error,
      );
      return false;
    }
  }

  async generateImage(
    input: z.infer<typeof GenerateImageSchema.input>,
    accept: ImageMediaType,
  ): Promise<z.infer<typeof GenerateImageSchema.output>> {
    if (!this.endpointName) {
      throw new Error(
        "A SageMaker image generation endpoint name is required to generate an image.",
      );
    }

    const response = await client.send(
      new InvokeEndpointCommand({
        EndpointName: this.endpointName,
        InferenceComponentName: `${this.endpointName}-inference-component`,
        ContentType: "application/json",
        Accept: accept,
        Body: Buffer.from(JSON.stringify(input)),
      }),
    );

    if (!response.Body || response.Body.byteLength === 0) {
      throw new Error("SageMaker returned an empty image response body.");
    }

    const bytes = Uint8Array.from(response.Body);
    return validateImageResponse(bytes, response.ContentType, accept, "SageMaker");
  }
}

export function SageMakerGenerateImageProviderClassFactory(
  endpointName?: string,
): new () => SageMakerGenerateImageProvider {
  return class extends SageMakerGenerateImageProvider {
    constructor() {
      super(endpointName);
    }
  };
}
