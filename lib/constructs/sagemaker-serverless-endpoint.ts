import * as cdk from "aws-cdk-lib/core";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sagemaker from "aws-cdk-lib/aws-sagemaker";
import { Construct } from "constructs";

export interface SageMakerServerlessEndpointProps {
  endpointName: string;
  imageUri: string;
  modelArtifactBucket: s3.IBucket;
  serverlessMemorySizeInMb: number;
  serverlessMaxConcurrency: number;
  containerEnvironment: Record<string, string>;
}

export class SageMakerServerlessEndpoint extends Construct {
  public readonly endpointName: string;
  public readonly endpointArn: string;
  public readonly modelArtifactBucket: s3.IBucket;
  public readonly modelArtifactKey: string;
  public readonly modelArtifactUrl: string;

  constructor(
    scope: Construct,
    id: string,
    props: SageMakerServerlessEndpointProps,
  ) {
    super(scope, id);

    this.endpointName = props.endpointName;
    this.modelArtifactBucket = props.modelArtifactBucket;
    this.modelArtifactKey = `serverless-inference/${props.endpointName}/model.tar.gz`;
    this.modelArtifactUrl = this.modelArtifactBucket.s3UrlForObject(
      this.modelArtifactKey,
    );
    this.endpointArn = `arn:${cdk.Aws.PARTITION}:sagemaker:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:endpoint/${this.endpointName}`;

    const sageMakerRole = new iam.Role(this, "ExecutionRole", {
      assumedBy: new iam.ServicePrincipal("sagemaker.amazonaws.com"),
    });
    // Allow read from ECR for the inference image (defined in the props)
    sageMakerRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AmazonEC2ContainerRegistryReadOnly",
      ),
    );
    // Allow read access to the model artifact bucket
    this.modelArtifactBucket.grantRead(sageMakerRole);

    const model = new sagemaker.CfnModel(this, "Model", {
      executionRoleArn: sageMakerRole.roleArn,
      primaryContainer: {
        image: props.imageUri,
        modelDataUrl: this.modelArtifactUrl,
        environment: props.containerEnvironment,
      },
    });

    model.node.addDependency(sageMakerRole);

    const endpointConfig = new sagemaker.CfnEndpointConfig(
      this,
      "EndpointConfig",
      {
        productionVariants: [
          {
            initialVariantWeight: 1,
            modelName: model.attrModelName,
            variantName: "AllTraffic",
            serverlessConfig: {
              maxConcurrency: props.serverlessMaxConcurrency,
              memorySizeInMb: props.serverlessMemorySizeInMb,
            },
          },
        ],
      },
    );

    const endpoint = new sagemaker.CfnEndpoint(this, "Endpoint", {
      endpointConfigName: endpointConfig.attrEndpointConfigName,
      endpointName: this.endpointName,
    });

    new cdk.CfnOutput(this, "EndpointName", {
      value: endpoint.attrEndpointName,
    });

    new cdk.CfnOutput(this, "ModelArtifactUrl", {
      value: this.modelArtifactUrl,
    });
  }

  public grantInvoke(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ["sagemaker:InvokeEndpoint"],
      resourceArns: [this.endpointArn],
    });
  }
}
