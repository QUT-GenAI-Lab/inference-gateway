/** CDK supplies the manager's private URL through EC2_GPU_MANAGER_URL. */

import { EC2Client, StartInstancesCommand } from "@aws-sdk/client-ec2";

const MANAGER_URL_ENV = "EC2_GPU_MANAGER_URL";
const INSTANCE_ID_ENV = "EC2_GPU_INSTANCE_ID";
const STATUS_TIMEOUT_MS = 5000;
const ec2 = new EC2Client({});

export interface ManagerModelStatus {
  model: string;
  running: boolean;
  loading: boolean;
}

export class Ec2GpuManagerClient {
  private readonly service: string;
  private readonly managerUrl?: string;

  constructor(service: string, managerUrl = process.env[MANAGER_URL_ENV]) {
    this.service = service;
    this.managerUrl = managerUrl;
  }

  private baseUrl(): string {
    if (!this.managerUrl) {
      throw new Error(
        `${MANAGER_URL_ENV} is required to reach the EC2 GPU model manager.`,
      );
    }
    return this.managerUrl.replace(/\/+$/, "");
  }

  async getStatus(): Promise<ManagerModelStatus> {
    const response = await fetch(
      `${this.baseUrl()}/models/${this.service}/status`,
      { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) },
    );
    if (!response.ok) {
      throw new Error(
        `Model manager status request failed with HTTP ${response.status}.`,
      );
    }
    return (await response.json()) as ManagerModelStatus;
  }

  async wake(): Promise<void> {
    const response = await fetch(
      `${this.baseUrl()}/models/${this.service}/wake`,
      {
        method: "POST",
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Model manager wake request failed with HTTP ${response.status}.`,
      );
    }
  }

  async startInstance(): Promise<void> {
    const instanceId = process.env[INSTANCE_ID_ENV];
    if (!instanceId) {
      throw new Error(`${INSTANCE_ID_ENV} is required to start the EC2 GPU host.`);
    }

    try {
      await ec2.send(
        new StartInstancesCommand({ InstanceIds: [instanceId] }),
        { abortSignal: AbortSignal.timeout(STATUS_TIMEOUT_MS) },
      );
    } catch (error) {
      if (error instanceof Error && error.name === "IncorrectInstanceState") {
        return;
      }
      throw error;
    }
  }

  async invoke(body: unknown, accept?: string): Promise<Response> {
    return fetch(`${this.baseUrl()}/models/${this.service}/invoke`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(accept ? { accept } : {}),
      },
      body: JSON.stringify(body),
    });
  }
}

// Wake cold models, or start the host if the manager is unreachable.
// Report not ready until the model can serve.
export async function isEc2ModelReady(
  client: Ec2GpuManagerClient,
): Promise<boolean> {
  try {
    const status = await client.getStatus();
    if (status.running && !status.loading) {
      return true;
    }
  } catch (error) {
    console.error("EC2 GPU model manager is unavailable:", error);
    try {
      await client.startInstance();
    } catch (startError) {
      console.error("Failed to start EC2 GPU development instance:", startError);
    }
    return false;
  }

  try {
    await client.wake();
  } catch (error) {
    console.error("Failed to request an EC2 GPU model wake:", error);
  }
  return false;
}
