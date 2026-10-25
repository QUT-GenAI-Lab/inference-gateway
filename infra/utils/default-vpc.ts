import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";

export function getDefaultVpc(scope: Construct): ec2.IVpc {
  const vpcId = "vpc-0b3044a2ec2e59ccb";
  return ec2.Vpc.fromLookup(scope, "DefaultVPC", { vpcId });
}
