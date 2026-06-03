import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { ServingConstruct } from "./constructs/serving-construct";
import * as iam from "aws-cdk-lib/aws-iam";

export class InferenceGatewayStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    const fn = new NodejsFunction(this, "InferenceGatewayFn", {
      entry: "lambda/index.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
    });

    new ServingConstruct(this, "InferenceGatewayServing", fn);

    // Enable necessary permissions for Bedrock
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:Converse"],
        resources: ["*"], // TODO: tighten this to specific model ARNs later
      }),
    );
  }
}
