import {
  InvokeEndpointCommand,
  SageMakerRuntimeClient,
} from "@aws-sdk/client-sagemaker-runtime";
import { GenerateChatProvider, GenerateChatSchema } from "../provider";
import { z } from "zod";

const client = new SageMakerRuntimeClient({
  region: process.env.AWS_REGION,
});

class SageMakerGenerateChatProvider implements GenerateChatProvider {
  private readonly endpointName?: string;

  constructor(endpointName?: string) {
    this.endpointName = endpointName;
  }

  async isReady(): Promise<boolean> {
    if (!this.endpointName) {
      throw new Error(
        "A sagemaker chat generation endpoint name is required to check readiness.",
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
      // scale-to-zero return a ValidationError (HTTP 400, "Inference Component
      // has no capacity to process this request") when there are zero active
      // copies. That failed invocation emits the NoCapacityInvocationFailures
      // CloudWatch metric, which drives the step-scaling policy that scales the
      // inference component back out from zero. Until a copy is ready, treat
      // the endpoint as not ready so callers retry.
      console.error(
        `SageMaker endpoint ${this.endpointName} not ready (possibly scaling out from zero):`,
        error,
      );
      return false;
    }
  }

  async generateChat(
    input: z.infer<typeof GenerateChatSchema.input>,
  ): Promise<z.infer<typeof GenerateChatSchema.output>> {
    if (!this.endpointName) {
      throw new Error(
        "A sagemaker chat generation endpoint name is required to generate chat.",
      );
    }

    const response = await client.send(
      new InvokeEndpointCommand({
        EndpointName: this.endpointName,
        InferenceComponentName: `${this.endpointName}-inference-component`,
        ContentType: "application/json",
        Accept: "application/json",
        Body: Buffer.from(
          JSON.stringify({
            messages: input.messages,
            system: input.system,
            includeEcoMetrics: input.includeEcoMetrics,
          }),
        ),
      }),
    );

    if (!response.Body) {
      throw new Error("SageMaker returned an empty response body.");
    }

    const payload = new TextDecoder().decode(response.Body);
    console.log(`SageMaker ${this.endpointName} response payload: ${payload}`);
    const parsed: unknown = JSON.parse(payload);
    const result = GenerateChatSchema.output.safeParse(parsed);

    if (!result.success) {
      throw new Error(
        `SageMaker returned an invalid chat response: ${result.error.message}`,
      );
    }

    return result.data;
  }
}

/**
 * Factory function to create a SageMakerGenerateChatProvider class with a specific endpoint name.
 * This allows for dynamic creation of provider classes for different SageMaker endpoints.
 *
 * Have I been coding too much Java? Maybe.
 *
 * @param endpointName - The name of the SageMaker endpoint to be used by the provider.
 * @returns A new class that extends SageMakerGenerateChatProvider, configured with the specified endpoint name.
 */
export function SageMakerGenerateChatProviderClassFactory(
  endpointName?: string,
): new () => SageMakerGenerateChatProvider {
  return class extends SageMakerGenerateChatProvider {
    constructor() {
      super(endpointName);
    }
  };
}
