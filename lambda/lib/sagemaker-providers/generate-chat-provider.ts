import {
  InvokeEndpointCommand,
  SageMakerRuntimeClient,
} from "@aws-sdk/client-sagemaker-runtime";
import { GenerateChatProvider, GenerateChatSchema } from "../provider";
import { z } from "zod";

const client = new SageMakerRuntimeClient({
  region: process.env.AWS_REGION,
});

const LFM2_5_SERVERLESS_ENDPOINT = "lfm2-5-230m-generate-text";

class SageMakerGenerateChatProvider implements GenerateChatProvider {
  private readonly endpointName?: string;
  private readonly invocationConfig: { InferenceComponentName?: string };

  constructor(endpointName?: string) {
    this.endpointName = endpointName;
    this.invocationConfig = endpointName === LFM2_5_SERVERLESS_ENDPOINT
      ? {}
      : { InferenceComponentName: `${endpointName}-inference-component` };
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
          ...this.invocationConfig,
          ContentType: "application/json",
          Accept: "application/json",
          Body: Buffer.from(JSON.stringify({ healthCheck: true })),
        }),
      );
      return true;
    } catch (error) {
      // No-capacity invocations emit NoCapacityInvocationFailures to wake real-time components.
      // Return not ready until capacity is available.
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
        ...this.invocationConfig,
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
 * Bind an endpoint to the constructor expected by the provider router.
 * Have I been coding too much Java? Maybe.
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
