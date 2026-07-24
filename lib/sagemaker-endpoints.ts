import * as cdk from "aws-cdk-lib/core";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { SageMakerRealtimeEndpoint } from "./constructs/sagemaker-real-time-endpoint";
import { SageMakerServerlessEndpoint } from "./constructs/sagemaker-serverless-endpoint";
import { type CustomDockerImageUris } from "./custom-docker-images";

export const MODEL_ARTIFACT_BUCKET_NAME = "genai-arcade-sagemaker-models";

// Reference: https://aws.github.io/deep-learning-containers/reference/available_images/#huggingface-pytorch-inference
const HF_INFERENCE_IMAGE_URIS = {
  "pytorch-inference": {
    "ap-southeast-2":
      "763104351884.dkr.ecr.ap-southeast-2.amazonaws.com/huggingface-pytorch-inference:2.6.0-transformers5.5.3-cpu-py312-ubuntu22.04",
  },
  "pytorch-inference-gpu": {
    "ap-southeast-2":
      "763104351884.dkr.ecr.ap-southeast-2.amazonaws.com/huggingface-pytorch-inference:2.6.0-transformers5.5.3-gpu-py312-cu124-ubuntu22.04",
  },
};

const MB_PER_GB = 1024;

interface SageMakerEndpointsProps {
  customDockerImageUris: CustomDockerImageUris;
}

export class SageMakerEndpoints extends Construct {
  private readonly endpoints: Array<
    SageMakerServerlessEndpoint | SageMakerRealtimeEndpoint
  >;

  constructor(scope: Construct, id: string, props: SageMakerEndpointsProps) {
    super(scope, id);

    const modelArtifactBucket = s3.Bucket.fromBucketName(
      this,
      "ModelArtifactsBucket",
      MODEL_ARTIFACT_BUCKET_NAME,
    );

    this.endpoints = [];

    this.endpoints.push(
      new SageMakerServerlessEndpoint(this, "Gpt2NextTokenEndpoint", {
        endpointName: "gpt-2-next-token",
        imageUri:
          HF_INFERENCE_IMAGE_URIS["pytorch-inference"]["ap-southeast-2"],
        modelArtifactBucket,
        serverlessMemorySizeInMb: 6144,
        serverlessMaxConcurrency: 20,
        // serverlessProvisionedConcurrency: 1, // Uncomment to reduce cold start latency
        containerEnvironment: {
          SAGEMAKER_PROGRAM: "inference.py",
          SAGEMAKER_SUBMIT_DIRECTORY: "/opt/ml/model/code",
        },
      }),
    );
    this.endpoints.push(
      new SageMakerRealtimeEndpoint(this, "Llama1_7bGenerateChatEndpoint", {
        endpointName: "llama-1-7b-generate-text",
        imageUri:
          HF_INFERENCE_IMAGE_URIS["pytorch-inference-gpu"]["ap-southeast-2"],
        modelArtifactBucket,
        // ml.g4dn.xlarge has 1 GPU, 4 vCPUs, and 16 GiB of memory.
        instanceType: "ml.g4dn.xlarge",
        containerEnvironment: {
          SAGEMAKER_PROGRAM: "inference.py",
          SAGEMAKER_SUBMIT_DIRECTORY: "/opt/ml/model/code",
        },
        minMemoryRequiredMb: 3 * MB_PER_GB,
        maxMemoryRequiredMb: 5 * MB_PER_GB,
      }),
    );
    this.endpoints.push(
      new SageMakerRealtimeEndpoint(
        this,
        "Llama3_2_3bInstructGenerateTextEndpoint",
        {
          endpointName: "llama-3.2-3b-instruct-generate-text",
          imageUri:
            props.customDockerImageUris["pytorch-inference-gpu-codecarbon"],
          modelArtifactBucket,
          // ml.g4dn.xlarge has 1 GPU (T4), 4 vCPUs, and 16 GiB of memory.
          // The 3B-parameter FP16 weights (~6 GB) plus KV cache and CodeCarbon
          // sampling happily fit a single T4's 16 GiB VRAM.
          instanceType: "ml.g4dn.xlarge",
          containerEnvironment: {
            SAGEMAKER_PROGRAM: "inference.py",
            SAGEMAKER_SUBMIT_DIRECTORY: "/opt/ml/model/code",
          },
          numberOfAcceleratorDevicesRequired: 1,
          numberOfCpuCoresRequired: 2,
          minMemoryRequiredMb: 6 * MB_PER_GB,
          maxMemoryRequiredMb: 8 * MB_PER_GB,
          // Keep one warm copy at startup, then scale-to-zero on idle, capped at
          // one copy total to bound per-endpoint cost on a single-GPU box.
          initialInstanceCount: 1,
          minInstanceCount: 0,
          maxInstanceCount: 1,
          initialCopyCount: 1,
          minCopyCount: 0,
          maxCopyCount: 1,
          // Single-concurrency-per-copy target ensures queuing kicks off scale
          // alarms promptly on a single T4 box (latency not throughput focus).
          targetConcurrentRequestsPerCopy: 1,
        },
      ),
    );

    new cdk.CfnOutput(this, "ModelArtifactsBucketName", {
      value: modelArtifactBucket.bucketName,
    });
  }

  public grantInvoke(grantee: iam.IGrantable): iam.Grant[] {
    return this.endpoints.map((endpoint) => endpoint.grantInvoke(grantee));
  }
}
