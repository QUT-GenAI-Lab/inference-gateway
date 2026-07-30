import {
  InvokeEndpointCommand,
  SageMakerRuntimeClient,
} from "@aws-sdk/client-sagemaker-runtime";
import { z } from "zod";
import {
  GenerateImageProvider,
  GenerateImageSchema,
  IMAGE_MEDIA_TYPES,
  ImageMediaType,
} from "../provider";

const client = new SageMakerRuntimeClient({
  region: process.env.AWS_REGION,
});

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function normalizeImageContentType(contentType?: string): ImageMediaType | null {
  const normalized = contentType?.split(";", 1)[0].trim().toLowerCase();
  return IMAGE_MEDIA_TYPES.includes(normalized as ImageMediaType)
    ? (normalized as ImageMediaType)
    : null;
}

function hasSignature(bytes: Uint8Array, signature: readonly number[]): boolean {
  return (
    bytes.byteLength >= signature.length &&
    signature.every((value, index) => bytes[index] === value)
  );
}

function hasValidImageSignature(
  bytes: Uint8Array,
  contentType: ImageMediaType,
): boolean {
  return hasSignature(
    bytes,
    contentType === "image/jpeg" ? JPEG_SIGNATURE : PNG_SIGNATURE,
  );
}

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

    const contentType = normalizeImageContentType(response.ContentType);
    if (!contentType || contentType !== accept) {
      throw new Error(
        `SageMaker returned an invalid image content type: ${response.ContentType ?? "missing"}.`,
      );
    }

    const bytes = Uint8Array.from(response.Body);
    if (!hasValidImageSignature(bytes, contentType)) {
      throw new Error(
        `SageMaker returned a malformed ${contentType} response body.`,
      );
    }

    return GenerateImageSchema.output.parse({ bytes, contentType });
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
