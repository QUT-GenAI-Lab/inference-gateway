import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { ServingConstruct } from "./constructs/serving-construct";
import * as iam from "aws-cdk-lib/aws-iam";
import { SageMakerEndpoints } from "./sagemaker-endpoints";
import { CustomDockerImagesStack } from "./custom-docker-images";

export class InferenceGatewayStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const customDockerImagesStack = new CustomDockerImagesStack(
      this,
      "CustomDockerImagesStack",
    );

    const sageMakerEndpoints = new SageMakerEndpoints(
      this,
      "SageMakerEndpoints",
      {
        customDockerImageUris: customDockerImagesStack.imageUrls,
      },
    );
    sageMakerEndpoints.node.addDependency(customDockerImagesStack);

    const fn = new NodejsFunction(this, "InferenceGatewayFn", {
      entry: "lambda/index.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
    });
    fn.node.addDependency(sageMakerEndpoints);
    sageMakerEndpoints.grantInvoke(fn);

    const servingConstruct = new ServingConstruct(
      this,
      "InferenceGatewayServing",
      fn,
    );
    servingConstruct.node.addDependency(fn);

    // Enable necessary permissions for Bedrock
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:Converse"],
        resources: ["*"], // TODO: tighten this to specific model ARNs later
      }),
    );
  }
}
