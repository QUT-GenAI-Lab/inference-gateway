import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { ServingConstruct } from "./constructs/serving-construct";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { SageMakerServerlessEndpoint } from "./constructs/sagemaker-serverless-endpoint";
import { SageMakerRealtimeEndpoint } from "./constructs/sagemaker-real-time-endpoint";

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

export class InferenceGatewayStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    const fn = new NodejsFunction(this, "InferenceGatewayFn", {
      entry: "lambda/index.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
    });

    new ServingConstruct(this, "InferenceGatewayServing", fn);

    const existingBucket = s3.Bucket.fromBucketName(
      this,
      "ExistingModelArtifactsBucket",
      MODEL_ARTIFACT_BUCKET_NAME,
    );

    const modelArtifactBucket =
      existingBucket ||
      new s3.Bucket(this, "ModelArtifactsBucket", {
        bucketName: MODEL_ARTIFACT_BUCKET_NAME,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        versioned: true,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        autoDeleteObjects: false,
      });

    const gpt2Endpoint = new SageMakerServerlessEndpoint(
      this,
      "Gpt2NextTokenEndpoint",
      {
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
      },
    );

    fn.addEnvironment(
      "SAGEMAKER_GPT_2_ENDPOINT_NAME",
      gpt2Endpoint.endpointName,
    );
    gpt2Endpoint.grantInvoke(fn);

    const llamaEndpoint = new SageMakerRealtimeEndpoint(
      this,
      "Llama1_7bGenerateChatEndpoint",
      {
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
        minMemoryRequiredMb: 3 * MB_PER_GB, // 3 GB
        maxMemoryRequiredMb: 5 * MB_PER_GB, // 5 GB
      },
    );

    fn.addEnvironment(
      "SAGEMAKER_LLAMA_1_ENDPOINT_NAME",
      llamaEndpoint.endpointName,
    );
    llamaEndpoint.grantInvoke(fn);

    // Enable necessary permissions for Bedrock
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:Converse"],
        resources: ["*"], // TODO: tighten this to specific model ARNs later
      }),
    );

    new cdk.CfnOutput(this, "ModelArtifactsBucketName", {
      value: modelArtifactBucket.bucketName,
    });
  }
}
