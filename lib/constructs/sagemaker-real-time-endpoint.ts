import * as cdk from "aws-cdk-lib/core";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sagemaker from "aws-cdk-lib/aws-sagemaker";
import * as applicationautoscaling from "aws-cdk-lib/aws-applicationautoscaling";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";

export interface SageMakerRealtimeEndpointProps {
  endpointName: string;
  imageUri: string;
  modelArtifactBucket: s3.IBucket;

  /**
   * Example:
   * - "ml.g4dn.xlarge" for NVIDIA T4
   * - "ml.g5.xlarge" for newer NVIDIA A10G
   */
  instanceType: string;

  /**
   * SageMaker endpoint backing instances.
   *
   * For scale-to-zero:
   * - minInstanceCount should be 0
   * - maxInstanceCount should be >= 1
   *
   * initialInstanceCount is usually 1 so the endpoint can be created.
   */
  initialInstanceCount?: number;
  minInstanceCount?: number;
  maxInstanceCount?: number;

  /**
   * Inference component model copies.
   *
   * For scale-to-zero:
   * - minCopyCount should be 0
   * - maxCopyCount should be >= 1
   */
  initialCopyCount?: number;
  minCopyCount?: number;
  maxCopyCount?: number;

  /**
   * Cooldown period after scaling out before another scale-out can occur.
   */
  scaleOutCooldownSeconds?: number;
  /**
   * Cooldown period after scaling in before another scale-in can occur.
   */
  scaleInCooldownSeconds?: number;

  /**
   * Target concurrent requests per model copy.
   *
   * For LLMs, start low, e.g. 2-5.
   */
  targetConcurrentRequestsPerCopy?: number;

  /**
   * Resource reservation for the inference component.
   *
   * For ml.g4dn.xlarge:
   * - 1 T4 GPU
   * - 4 vCPU
   * - 16 GiB instance memory
   *
   * For Llama 3.2 3B, start around 12-15 GB and tune.
   */
  numberOfAcceleratorDevicesRequired?: number;
  numberOfCpuCoresRequired?: number;
  minMemoryRequiredMb?: number;
  maxMemoryRequiredMb?: number;

  /**
   * Extra EBS storage for model artifacts/container startup.
   */
  volumeSizeInGb?: number;

  /**
   * Long timeouts are useful for LLM model artifact download and container startup.
   */
  modelDataDownloadTimeoutSeconds?: number;
  containerStartupHealthCheckTimeoutSeconds?: number;

  containerEnvironment?: Record<string, string>;
}

const DEFAULT_PROPS = {
  initialInstanceCount: 1,
  minInstanceCount: 0,
  maxInstanceCount: 1,
  initialCopyCount: 1,
  minCopyCount: 0,
  maxCopyCount: 1,
  targetConcurrentRequestsPerCopy: 5,
  scaleOutCooldownSeconds: 300,
  scaleInCooldownSeconds: 120,

  numberOfAcceleratorDevicesRequired: 1,
  numberOfCpuCoresRequired: 2,
  minMemoryRequiredMb: 12000,
  maxMemoryRequiredMb: 15000,

  modelDataDownloadTimeoutSeconds: 3600,
  containerStartupHealthCheckTimeoutSeconds: 3600,
} satisfies Partial<SageMakerRealtimeEndpointProps>;

/**
 * Register the inference component as a scalable target. Equivalent to:
 * 
 * aws application-autoscaling register-scalable-target \
  --service-namespace sagemaker \
  --resource-id inference-component/inference-component-name \
  --scalable-dimension sagemaker:inference-component:DesiredCopyCount \
  --min-capacity 0 \
  --max-capacity n 
 */
function registerInferenceComponentScalableTarget(
  scope: Construct,
  inferenceComponentName: string,
  props: {
    minCapacity: number;
    maxCapacity: number;
  },
) {
  return new applicationautoscaling.CfnScalableTarget(
    scope,
    "InferenceComponentScalableTarget",
    {
      serviceNamespace: "sagemaker",
      resourceId: `inference-component/${inferenceComponentName}`,
      scalableDimension: "sagemaker:inference-component:DesiredCopyCount",
      minCapacity: props.minCapacity,
      maxCapacity: props.maxCapacity,
    },
  );
}

/**
 * Apply a target tracking policy to the inference component. Equivalent to:
 * aws application-autoscaling put-scaling-policy \
  --policy-name my-scaling-policy \
  --policy-type TargetTrackingScaling \
  --resource-id inference-component/inference-component-name \
  --service-namespace sagemaker \
  --scalable-dimension sagemaker:inference-component:DesiredCopyCount \
  --target-tracking-scaling-policy-configuration file://config.json
 * where config.json contains:
  {
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "SageMakerInferenceComponentInvocationsPerCopy"
    },
    "TargetValue": 1,
    "ScaleInCooldown": 300,
    "ScaleOutCooldown": 300
  }
 *
 * @param scope 
 * @param inferenceComponentName 
 * @param targetValue 
 * @param scaleInCooldown 
 * @param scaleOutCooldown 
 * @returns 
 */
function applyTargetTrackingPolicy(
  scope: Construct,
  inferenceComponentName: string,
  props: {
    targetValue: number;
    scaleInCooldown: number;
    scaleOutCooldown: number;
  },
) {
  return new applicationautoscaling.CfnScalingPolicy(
    scope,
    "InferenceComponentTargetTrackingPolicy",
    {
      policyName: `${inferenceComponentName}-target-tracking`,
      policyType: "TargetTrackingScaling",

      resourceId: `inference-component/${inferenceComponentName}`,
      serviceNamespace: "sagemaker",
      scalableDimension: "sagemaker:inference-component:DesiredCopyCount",

      targetTrackingScalingPolicyConfiguration: {
        targetValue: props.targetValue,
        predefinedMetricSpecification: {
          // https://docs.aws.amazon.com/sagemaker/latest/dg/endpoint-auto-scaling-add-code-define.html
          // Use SageMakerInferenceComponentConcurrentRequestsPerCopyHighResolution for quick scaling
          predefinedMetricType:
            "SageMakerInferenceComponentConcurrentRequestsPerCopyHighResolution",
        },
        scaleInCooldown: props.scaleInCooldown,
        scaleOutCooldown: props.scaleOutCooldown,
      },
    },
  );
}

/**
 * Apply a step scaling policy to the inference component, allowing it to scale out from zero. Equivalent to:
 * aws application-autoscaling put-scaling-policy \
  --policy-name my-scaling-policy \
  --policy-type StepScaling \
  --resource-id inference-component/inference-component-name \
  --service-namespace sagemaker \
  --scalable-dimension sagemaker:inference-component:DesiredCopyCount \
  --step-scaling-policy-configuration file://config.json
 * where config.json contains:
  {
    "AdjustmentType": "ChangeInCapacity",
    "MetricAggregationType": "Maximum",
    "Cooldown": 60,
    "StepAdjustments":
      [
        {
          "MetricIntervalLowerBound": 0,
          "ScalingAdjustment": 1
        }
      ]
  }
 */
function applyStepScalingOutFromZeroPolicy(
  scope: Construct,
  inferenceComponentName: string,
  props: {
    scalingAdjustment: number;
    metricIntervalLowerBound: number;
    cooldown: number;
  },
) {
  return new applicationautoscaling.CfnScalingPolicy(
    scope,
    "InferenceComponentStepScalingPolicy",
    {
      policyName: `${inferenceComponentName}-step-scaling`,
      policyType: "StepScaling",

      resourceId: `inference-component/${inferenceComponentName}`,
      serviceNamespace: "sagemaker",
      scalableDimension: "sagemaker:inference-component:DesiredCopyCount",

      stepScalingPolicyConfiguration: {
        adjustmentType: "ChangeInCapacity",
        metricAggregationType: "Maximum",
        cooldown: props.cooldown,
        stepAdjustments: [
          {
            metricIntervalLowerBound: props.metricIntervalLowerBound,
            scalingAdjustment: props.scalingAdjustment,
          },
        ],
      },
    },
  );
}

/**
 * Create a CloudWatch alarm and assign the step scaling policy to it. Equivalent to:
  aws cloudwatch put-metric-alarm \
    --dimensions "Name=InferenceComponentName,Value=inference-component-name" \
    --evaluation-periods 1 \
    --metric-name NoCapacityInvocationFailures \
    --namespace AWS/SageMaker \
    --period 60 \
    --statistic Sum \
    --threshold 1
 */
function applyStepScalingOutFromZeroAlarm(
  scope: Construct,
  inferenceComponentName: string,
  props: {
    endpointName: string;
    stepScalingPolicyArn: string;
  },
) {
  return new cloudwatch.CfnAlarm(scope, "NoCapacityInvocationFailuresAlarm", {
    alarmActions: [props.stepScalingPolicyArn],
    alarmDescription:
      "Alarm when SageMaker inference component endpoint invoked that has 0 instances.",
    alarmName: `${props.endpointName}-step-scaling-alarm`,
    comparisonOperator: "GreaterThanOrEqualToThreshold",
    datapointsToAlarm: 1,
    dimensions: [
      {
        name: "InferenceComponentName",
        value: inferenceComponentName,
      },
    ],
    evaluationPeriods: 1,
    metricName: "NoCapacityInvocationFailures",
    namespace: "AWS/SageMaker",

    period: 60,
    statistic: "Sum",
    threshold: 1,
  });
}

export class SageMakerRealtimeEndpoint extends Construct {
  public readonly endpointName: string;
  public readonly endpointArn: string;

  public readonly inferenceComponentName: string;
  public readonly inferenceComponentArn: string;

  public readonly modelArtifactBucket: s3.IBucket;
  public readonly modelArtifactKey: string;
  public readonly modelArtifactUrl: string;

  constructor(
    scope: Construct,
    id: string,
    props: SageMakerRealtimeEndpointProps,
  ) {
    super(scope, id);

    const variantName = "AllTraffic";

    this.endpointName = props.endpointName;
    this.inferenceComponentName = `${props.endpointName}-inference-component`;

    this.modelArtifactBucket = props.modelArtifactBucket;
    // Use uncompressed model artifacts to reduce decompression time on endpoint startup,
    // and to allow partial uploads of model artifacts like inference.py
    this.modelArtifactKey = `realtime-inference/${props.endpointName}/uncompressed/`;
    this.modelArtifactUrl = this.modelArtifactBucket.s3UrlForObject(
      this.modelArtifactKey,
    );
    this.endpointArn = `arn:${cdk.Aws.PARTITION}:sagemaker:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:endpoint/${this.endpointName}`;
    this.inferenceComponentArn = `arn:${cdk.Aws.PARTITION}:sagemaker:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:inference-component/${this.inferenceComponentName}`;

    const appliedProps = { ...DEFAULT_PROPS, ...props };

    /**
     * SageMaker execution role.
     */
    const sageMakerRole = new iam.Role(this, "ExecutionRole", {
      assumedBy: new iam.ServicePrincipal("sagemaker.amazonaws.com"),
    });

    sageMakerRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AmazonEC2ContainerRegistryReadOnly",
      ),
    );

    this.modelArtifactBucket.grantRead(sageMakerRole);

    /**
     * Optional but useful for model/container logs.
     * TODO: Tighten this later if required.
     */
    sageMakerRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchLogsFullAccess"),
    );

    /**
     * SageMaker Model object.
     *
     * This still points to your container image and S3 model artifact prefix, but unlike
     * the non-inference-component deployment style, this model is NOT attached
     * directly to the EndpointConfig production variant.
     */
    const model = new sagemaker.CfnModel(this, "Model", {
      executionRoleArn: sageMakerRole.roleArn,
      primaryContainer: {
        image: props.imageUri,
        environment: props.containerEnvironment,
        // Point directly to an S3 folder prefix instead of a tar.gz file
        modelDataSource: {
          s3DataSource: {
            s3Uri: this.modelArtifactUrl,
            s3DataType: "S3Prefix",
            compressionType: "None",
          },
        },
      },
    });

    model.node.addDependency(sageMakerRole);

    /**
     * Real-time endpoint config.
     *
     * Important:
     * - No serverlessConfig.
     * - Uses an instanceType.
     * - Does NOT set modelName on the production variant.
     * - ManagedInstanceScaling allows backing endpoint instances to scale to 0.
     */
    const endpointConfig = new sagemaker.CfnEndpointConfig(
      this,
      "EndpointConfig",
      {
        executionRoleArn: sageMakerRole.roleArn,
        productionVariants: [
          {
            variantName,
            initialInstanceCount: appliedProps.initialInstanceCount,
            instanceType: props.instanceType,

            modelDataDownloadTimeoutInSeconds:
              appliedProps.modelDataDownloadTimeoutSeconds,
            containerStartupHealthCheckTimeoutInSeconds:
              appliedProps.containerStartupHealthCheckTimeoutSeconds,

            volumeSizeInGb: appliedProps.volumeSizeInGb,

            managedInstanceScaling: {
              status: "ENABLED",
              minInstanceCount: appliedProps.minInstanceCount,
              maxInstanceCount: appliedProps.maxInstanceCount,
            },

            routingConfig: {
              routingStrategy: "LEAST_OUTSTANDING_REQUESTS",
            },
          },
        ],
      },
    );

    /**
     * SageMaker endpoint.
     */
    const endpoint = new sagemaker.CfnEndpoint(this, "Endpoint", {
      endpointConfigName: endpointConfig.attrEndpointConfigName,
      endpointName: this.endpointName,
    });

    endpoint.node.addDependency(endpointConfig);

    /**
     * Inference component.
     *
     * This is what actually attaches the model to the endpoint.
     * SageMaker documents inference components as the mechanism that lets
     * models share endpoint resources and scale copies independently.
     */
    const inferenceComponent = new sagemaker.CfnInferenceComponent(
      this,
      "InferenceComponent",
      {
        inferenceComponentName: this.inferenceComponentName,
        endpointName: this.endpointName,
        variantName,

        specification: {
          modelName: model.attrModelName,

          computeResourceRequirements: {
            numberOfAcceleratorDevicesRequired:
              appliedProps.numberOfAcceleratorDevicesRequired,
            numberOfCpuCoresRequired: appliedProps.numberOfCpuCoresRequired,
            minMemoryRequiredInMb: appliedProps.minMemoryRequiredMb,
            maxMemoryRequiredInMb: appliedProps.maxMemoryRequiredMb,
          },
        },

        runtimeConfig: {
          copyCount: appliedProps.initialCopyCount,
        },
      },
    );

    inferenceComponent.node.addDependency(endpoint);
    inferenceComponent.node.addDependency(model);

    // Source: https://docs.aws.amazon.com/sagemaker/latest/dg/endpoint-auto-scaling-zero-instances.html

    const scalableTarget = registerInferenceComponentScalableTarget(
      this,
      this.inferenceComponentName,
      {
        minCapacity: appliedProps.minCopyCount,
        maxCapacity: appliedProps.maxCopyCount,
      },
    );
    scalableTarget.node.addDependency(inferenceComponent);

    const targetTrackingPolicy = applyTargetTrackingPolicy(
      this,
      this.inferenceComponentName,
      {
        targetValue: appliedProps.targetConcurrentRequestsPerCopy,
        scaleInCooldown: appliedProps.scaleInCooldownSeconds,
        scaleOutCooldown: appliedProps.scaleOutCooldownSeconds,
      },
    );
    targetTrackingPolicy.node.addDependency(scalableTarget);

    const scaleOutFromZeroPolicy = applyStepScalingOutFromZeroPolicy(
      this,
      this.inferenceComponentName,
      {
        scalingAdjustment: 1,
        metricIntervalLowerBound: 0,
        cooldown: appliedProps.scaleOutCooldownSeconds,
      },
    );
    scaleOutFromZeroPolicy.node.addDependency(scalableTarget);

    const noCapacityAlarm = applyStepScalingOutFromZeroAlarm(
      this,
      this.inferenceComponentName,
      {
        endpointName: this.endpointName,
        stepScalingPolicyArn: scaleOutFromZeroPolicy.attrArn,
      },
    );
    noCapacityAlarm.node.addDependency(scaleOutFromZeroPolicy);

    new cdk.CfnOutput(this, "EndpointName", {
      value: endpoint.attrEndpointName,
    });

    new cdk.CfnOutput(this, "EndpointArn", {
      value: this.endpointArn,
    });

    new cdk.CfnOutput(this, "InferenceComponentName", {
      value: this.inferenceComponentName,
    });

    new cdk.CfnOutput(this, "ModelArtifactUrl", {
      value: this.modelArtifactUrl,
    });
  }

  public grantInvoke(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: [
        "sagemaker:InvokeEndpoint",
        "sagemaker:InvokeEndpointWithResponseStream",
      ],
      resourceArns: [this.endpointArn, this.inferenceComponentArn],
    });
  }
}
