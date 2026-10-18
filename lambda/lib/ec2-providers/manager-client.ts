/** CDK supplies the manager's private URL through EC2_GPU_MANAGER_URL. */

const MANAGER_URL_ENV = "EC2_GPU_MANAGER_URL";
const STATUS_TIMEOUT_MS = 5000;

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

/** Wake cold models in the background and report not ready until they can serve. */
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
    return false;
  }

  try {
    await client.wake();
  } catch (error) {
    console.error("Failed to request an EC2 GPU model wake:", error);
  }
  return false;
}
