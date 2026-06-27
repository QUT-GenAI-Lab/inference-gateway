import {
  InvokeEndpointCommand,
  SageMakerRuntimeClient,
} from "@aws-sdk/client-sagemaker-runtime";
import { NextTokenProvider, NextTokenSchema } from "./provider";
import { z } from "zod";

const client = new SageMakerRuntimeClient({
  region: process.env.AWS_REGION,
});

export class SageMakerGpt2Provider implements NextTokenProvider {
  private readonly endpointName?: string;

  constructor(endpointName = process.env.SAGEMAKER_ENDPOINT_NAME) {
    this.endpointName = endpointName;
  }

  async predictNextToken(
    input: z.infer<typeof NextTokenSchema.input> & { top_k: number },
  ): Promise<z.infer<typeof NextTokenSchema.output>> {
    if (!this.endpointName) {
      throw new Error("SAGEMAKER_ENDPOINT_NAME is required.");
    }

    const response = await client.send(
      new InvokeEndpointCommand({
        EndpointName: this.endpointName,
        ContentType: "application/json",
        Accept: "application/json",
        Body: Buffer.from(JSON.stringify(input)),
      }),
    );

    if (!response.Body) {
      throw new Error("SageMaker returned an empty response body.");
    }

    const payload = new TextDecoder().decode(response.Body);
    console.log(`SageMaker response payload: ${payload}`);
    const parsed: unknown = JSON.parse(payload);
    console.log(`Parsed SageMaker response: ${JSON.stringify(parsed)}`);
    const result = NextTokenSchema.output.safeParse(parsed);
    console.log(`Validation result: ${JSON.stringify(result)}`);

    if (!result.success) {
      throw new Error(
        `SageMaker returned an invalid next-token response: ${result.error.message}`,
      );
    }

    return result.data;
  }
}
