import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { ServingConstruct } from "./constructs/serving-construct";
import * as iam from "aws-cdk-lib/aws-iam";
import { SageMakerEndpoints } from "./sagemaker-endpoints";
import { CustomDockerImagesStack } from "./custom-docker-images";
import { DevInstanceConstruct } from "./constructs/dev-instance-construct";
import { getDefaultVpc } from "./utils/default-vpc";

export interface InferenceGatewayStackProps extends cdk.StackProps {
  gpuIdleTimeoutMinutes?: number;
}

export class InferenceGatewayStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: InferenceGatewayStackProps) {
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

    const vpc = getDefaultVpc(this);

    const lambdaSecurityGroup = new ec2.SecurityGroup(
      this,
      "GatewayLambdaSecurityGroup",
      {
        vpc,
        description: "Inference Gateway Lambda to EC2 GPU model manager",
        allowAllOutbound: true,
      },
    );

    const gpuHost = new DevInstanceConstruct(this, "DevInstance", {
      lambdaSecurityGroup,
      idleTimeoutMinutes: props?.gpuIdleTimeoutMinutes,
    });

    // Keep these outputs at stack scope so their names stay stable.
    new cdk.CfnOutput(this, "GpuManagerUrl", { value: gpuHost.managerUrl });
    new cdk.CfnOutput(this, "GpuInstanceId", { value: gpuHost.instanceId });

    const fn = new NodejsFunction(this, "InferenceGatewayFn", {
      entry: "lambda/index.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSecurityGroup],
      environment: {
        EC2_GPU_MANAGER_URL: gpuHost.managerUrl,
      },
    });
    fn.node.addDependency(sageMakerEndpoints);
    fn.node.addDependency(gpuHost);
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
