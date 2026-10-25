import * as path from "node:path";
import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { getDefaultVpc } from "../utils/default-vpc";

export const GPU_DEFAULTS = {
  instanceType: "g4dn.xlarge",
  volumeSizeGb: 150,
  volumeThroughputMbPerSec: 125,
  managerPort: 8000,
  idleTimeoutMinutes: 15,
} as const;

export type GpuProviderType = "generate-chat" | "generate-image";

export interface GpuModelCatalogEntry {
  /** Compose service name and manager model key. */
  readonly service: string;
  /** Public model ID exposed by the gateway, e.g. `dev.meta.llama-3.2-3b-instruct`. */
  readonly modelId: string;
  readonly providerType: GpuProviderType;
  /** Model directory relative to the `inference-gateway` root. */
  readonly modelDirectory: string;
}

// Keep service names and model IDs in sync with the Lambda provider router.
// Separate catalogs keep CDK out of the Lambda bundle.
export const GPU_MODEL_CATALOG: readonly GpuModelCatalogEntry[] = [
  {
    service: "llama",
    modelId: "dev.meta.llama-3.2-3b-instruct",
    providerType: "generate-chat",
    modelDirectory:
      "models/realtime-inference/llama-3-2-3b-instruct-generate-text",
  },
  {
    service: "stable-diffusion",
    modelId: "dev.stable-diffusion-v1-5/stable-diffusion-v1-5",
    providerType: "generate-image",
    modelDirectory:
      "models/realtime-inference/stable-diffusion-v1-5-generate-image",
  },
];

const MANAGER_SERVICE = "model-manager";
const MANAGER_IMAGE_DIRECTORY = "models/docker/gpu-model-manager";
const COMPOSE_FILE = "/opt/ml/compose.yaml";
const COMPOSE_PROJECT = "gpu";

const DLAMI_PARAMETER =
  "/aws/service/deeplearning/ami/x86_64/" +
  "base-with-single-cuda-ubuntu-22.04/latest/ami-id";

export interface DevInstanceConstructProps {
  lambdaSecurityGroup: ec2.ISecurityGroup;
  instanceType?: string;
  volumeSizeGb?: number;
  volumeThroughputMbPerSec?: number;
  managerPort?: number;
  idleTimeoutMinutes?: number;
}

/** Model containers share the GPU; the manager starts them one at a time. */
export function buildComposeFile(
  managerImageUri: string,
  modelImageUris: Record<string, string>,
  managerPort: number,
  services: readonly GpuModelCatalogEntry[],
  awsRegion: string,
  idleTimeoutMinutes: number = GPU_DEFAULTS.idleTimeoutMinutes,
): string {
  const modelServices = services
    .map(
      (entry) => `  ${entry.service}:
    image: ${modelImageUris[entry.service]}
    pull_policy: missing
    profiles:
      - models
    restart: "no"
    environment:
      MODEL_PATH: /models
    networks:
      - models
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities:
                - gpu
    healthcheck:
      test:
        - CMD
        - python
        - -c
        - "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
      interval: 2s
      timeout: 2s
      retries: 300
      start_period: 10s`,
    )
    .join("\n\n");

  return `services:
  ${MANAGER_SERVICE}:
    image: ${managerImageUri}
    pull_policy: missing
    restart: "no"
    ports:
      - "${managerPort}:${managerPort}"
    environment:
      GPU_MODEL_SERVICES: ${services.map((entry) => entry.service).join(",")}
      GPU_COMPOSE_FILE: /workspace/compose.yaml
      GPU_COMPOSE_PROJECT: ${COMPOSE_PROJECT}
      GPU_MODEL_PORT: "${managerPort}"
      GPU_IDLE_TIMEOUT_MINUTES: "${idleTimeoutMinutes}"
      AWS_DEFAULT_REGION: ${awsRegion}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ${COMPOSE_FILE}:/workspace/compose.yaml:ro
      - /root/.docker:/root/.docker:ro
    networks:
      - models

${modelServices}

networks:
  models:
    driver: bridge
`;
}

export class DevInstanceConstruct extends Construct {
  public readonly managerUrl: string;
  public readonly instanceId: string;
  public readonly hostSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: DevInstanceConstructProps) {
    super(scope, id);

    const instanceType = props.instanceType ?? GPU_DEFAULTS.instanceType;
    const volumeSizeGb = props.volumeSizeGb ?? GPU_DEFAULTS.volumeSizeGb;
    const volumeThroughputMbPerSec =
      props.volumeThroughputMbPerSec ?? GPU_DEFAULTS.volumeThroughputMbPerSec;
    const managerPort = props.managerPort ?? GPU_DEFAULTS.managerPort;
    const idleTimeoutMinutes =
      props.idleTimeoutMinutes ?? GPU_DEFAULTS.idleTimeoutMinutes;
    if (
      !Number.isSafeInteger(idleTimeoutMinutes) ||
      idleTimeoutMinutes < 0
    ) {
      throw new Error("idleTimeoutMinutes must be a nonnegative integer");
    }

    const stack = cdk.Stack.of(this);
    const registry = `${stack.account}.dkr.ecr.${stack.region}.amazonaws.com`;

    const vpc = getDefaultVpc(this);

    const subnetSelection = (() => {
      try {
        return vpc.selectSubnets({
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        });
      } catch {
        return { subnets: [] };
      }
    })();
    if (!subnetSelection.subnets || subnetSelection.subnets.length === 0) {
      throw new Error(
        "The GPU development host requires private subnets with egress " +
          "(a NAT gateway or equivalent) in the selected VPC, but none were found.",
      );
    }

    const instanceRole = new iam.Role(this, "GpuInstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });
    instanceRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AmazonSSMManagedInstanceCore",
      ),
    );
    // ECR login itself requires GetAuthorizationToken.
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      }),
    );

    const managerImage = new ecr_assets.DockerImageAsset(
      this,
      "GpuModelManagerImage",
      {
        directory: path.resolve(__dirname, "../..", MANAGER_IMAGE_DIRECTORY),
        platform: ecr_assets.Platform.LINUX_AMD64,
      },
    );
    managerImage.repository.grantPull(instanceRole);

    const modelImageUris: Record<string, string> = {};
    for (const entry of GPU_MODEL_CATALOG) {
      const modelImage = new ecr_assets.DockerImageAsset(
        this,
        `${entry.service}-model-image`,
        {
          directory: path.resolve(__dirname, "../..", entry.modelDirectory),
          platform: ecr_assets.Platform.LINUX_AMD64,
        },
      );
      modelImage.repository.grantPull(instanceRole);
      modelImageUris[entry.service] = modelImage.imageUri;
    }

    this.hostSecurityGroup = new ec2.SecurityGroup(this, "GpuHostSecurityGroup", {
      vpc,
      description: "GenAI Arcade EC2 GPU development host",
      allowAllOutbound: true,
    });
    this.hostSecurityGroup.addIngressRule(
      props.lambdaSecurityGroup,
      ec2.Port.tcp(managerPort),
      "Inference Gateway Lambda to model manager",
    );

    const composeFile = buildComposeFile(
      managerImage.imageUri,
      modelImageUris,
      managerPort,
      GPU_MODEL_CATALOG,
      stack.region,
      idleTimeoutMinutes,
    );

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      "echo 'GPU bootstrap output: /var/log/gpu-bootstrap.log'",
      "exec >> /var/log/gpu-bootstrap.log 2>&1",
      "set -euxo pipefail",
      "export DEBIAN_FRONTEND=noninteractive",
      "systemctl enable --now amazon-ssm-agent || true",
      "",
      "# Docker Engine",
      "apt-get update",
      "apt-get install -y ca-certificates curl gnupg awscli",
      "install -m 0755 -d /etc/apt/keyrings",
      "curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg",
      "chmod a+r /etc/apt/keyrings/docker.gpg",
      'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" > /etc/apt/sources.list.d/docker.list',
      "apt-get update",
      "apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin",
      "",
      "# NVIDIA Container Toolkit is provided by the DLAMI",
      "nvidia-ctk runtime configure --runtime=docker",
      "systemctl enable docker",
      "systemctl restart docker",
      "nvidia-smi -pm 1 || true",
      "",
      "mkdir -p /opt/ml /root/.docker",
      "",
      `cat > ${COMPOSE_FILE} <<'COMPOSE_EOF'\n${composeFile}COMPOSE_EOF`,
      "",
      "# ECR login helper",
      `cat > /usr/local/bin/ecr-login <<'ECR_LOGIN_EOF'
#!/usr/bin/env bash
set -euo pipefail
aws ecr get-login-password --region ${stack.region} \\
  | docker login --username AWS --password-stdin ${registry}
ECR_LOGIN_EOF`,
      "chmod +x /usr/local/bin/ecr-login",
      "",
      `cat > /etc/systemd/system/ecr-login.service <<'ECR_SERVICE_EOF'
[Unit]
Description=Authenticate Docker to Amazon ECR
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/ecr-login

[Install]
WantedBy=multi-user.target
ECR_SERVICE_EOF`,
      "",
      `cat > /etc/systemd/system/ecr-login.timer <<'ECR_TIMER_EOF'
[Unit]
Description=Refresh Amazon ECR Docker credentials

[Timer]
OnBootSec=5min
OnUnitActiveSec=6h
Unit=ecr-login.service
Persistent=true

[Install]
WantedBy=timers.target
ECR_TIMER_EOF`,
      "",
      "# Start (or refresh) the model manager container",
      `cat > /opt/ml/start-model-manager.sh <<'START_MANAGER_EOF'
#!/usr/bin/env bash
exec >> /var/log/gpu-model-manager.log 2>&1
set -euxo pipefail
docker compose --progress plain --file ${COMPOSE_FILE} --project-name ${COMPOSE_PROJECT} pull ${MANAGER_SERVICE}
docker compose --file ${COMPOSE_FILE} --project-name ${COMPOSE_PROJECT} up --detach ${MANAGER_SERVICE}
curl --fail --silent --show-error --output /dev/null --max-time 5 --retry 35 --retry-delay 3 --retry-max-time 180 --retry-all-errors http://127.0.0.1:${managerPort}/health
echo 'Model manager is healthy'
START_MANAGER_EOF`,
      "chmod +x /opt/ml/start-model-manager.sh",
      "",
      `cat > /etc/systemd/system/model-manager.service <<'MANAGER_SERVICE_EOF'
[Unit]
Description=GenAI Arcade Model Manager
After=network-online.target docker.service ecr-login.service
Wants=network-online.target
Requires=docker.service ecr-login.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/ml
ExecStart=/opt/ml/start-model-manager.sh
ExecStop=/usr/bin/docker compose --file ${COMPOSE_FILE} --project-name ${COMPOSE_PROJECT} stop ${MANAGER_SERVICE}

[Install]
WantedBy=multi-user.target
MANAGER_SERVICE_EOF`,
      "",
      "# Pull model images independently after the manager is ready",
      `cat > /opt/ml/pull-model-images.sh <<'PULL_MODELS_EOF'
#!/usr/bin/env bash
exec >> /var/log/gpu-model-pull.log 2>&1
set -euxo pipefail
docker compose --progress plain --file ${COMPOSE_FILE} --project-name ${COMPOSE_PROJECT} --profile models pull ${GPU_MODEL_CATALOG.map((entry) => entry.service).join(" ")}
echo 'Model image pulls complete'
PULL_MODELS_EOF`,
      "chmod +x /opt/ml/pull-model-images.sh",
      "",
      `cat > /etc/systemd/system/gpu-model-pull.service <<'PULL_SERVICE_EOF'
[Unit]
Description=Pre-pull GenAI Arcade GPU model images
After=model-manager.service
Requires=model-manager.service

[Service]
Type=oneshot
ExecStart=/opt/ml/pull-model-images.sh

[Install]
WantedBy=multi-user.target
PULL_SERVICE_EOF`,
      "",
      "systemctl daemon-reload",
      "systemctl enable ecr-login.service ecr-login.timer model-manager.service gpu-model-pull.service",
      "systemctl start ecr-login.service ecr-login.timer",
      "systemctl start model-manager.service",
      "systemctl start --no-block gpu-model-pull.service",
      "nvidia-smi > /var/log/nvidia-smi.log 2>&1 || true",
      `docker compose --file ${COMPOSE_FILE} --project-name ${COMPOSE_PROJECT} ps > /var/log/gpu-compose.log 2>&1 || true`,
    );

    const machineImage = ec2.MachineImage.resolveSsmParameterAtLaunch(
      DLAMI_PARAMETER,
      { os: ec2.OperatingSystemType.LINUX },
    );

    const instance = new ec2.Instance(this, "GpuDevelopmentInstance", {
      vpc,
      vpcSubnets: { subnets: subnetSelection.subnets },
      instanceType: new ec2.InstanceType(instanceType),
      machineImage,
      role: instanceRole,
      securityGroup: this.hostSecurityGroup,
      userData,
      userDataCausesReplacement: true,
      httpTokens: ec2.HttpTokens.REQUIRED,
      httpPutResponseHopLimit: 2,
      ebsOptimized: true,
      associatePublicIpAddress: false,
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: ec2.BlockDeviceVolume.ebs(volumeSizeGb, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            iops: 3000,
            throughput: volumeThroughputMbPerSec,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
    });

    new iam.Policy(this, "GpuIdleShutdownPolicy", {
      roles: [instanceRole],
      statements: [
        new iam.PolicyStatement({
          actions: ["ec2:StopInstances"],
          resources: [
            stack.formatArn({
              service: "ec2",
              resource: "instance",
              resourceName: instance.instanceId,
            }),
          ],
        }),
      ],
    });
    cdk.Tags.of(instance).add("Name", "genai-arcade-gpu-dev");
    cdk.Tags.of(instance).add("Workload", "GenAIArcade");

    this.instanceId = instance.instanceId;
    this.managerUrl = `http://${instance.instancePrivateIp}:${managerPort}`;
  }
}
