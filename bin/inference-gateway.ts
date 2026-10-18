#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { InferenceGatewayStack } from "../lib/inference-gateway-stack";

const app = new cdk.App();
new InferenceGatewayStack(app, "InferenceGatewayStack", {
  // VPC lookups need an explicit account and region.
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
