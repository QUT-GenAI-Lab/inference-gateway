import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { MODEL_ARTIFACT_BUCKET_NAME } from "../lib/inference-gateway-stack";

const SAGEMAKER_DIRECTORY = "sagemaker";

function normaliseToS3Path(value: string): string {
  return value.split(path.sep).join("/");
}

function getInvocationDirectory(): string {
  return process.env.INIT_CWD ?? process.cwd();
}

function getS3KeyFromDirectory(directory: string): string {
  const parts = path.resolve(directory).split(path.sep);
  const sagemakerIndex = parts.lastIndexOf(SAGEMAKER_DIRECTORY);

  if (sagemakerIndex === -1) {
    throw new Error(
      `Expected the command to be run from a directory under "${SAGEMAKER_DIRECTORY}". Received: ${directory}`,
    );
  }

  const keyParts = parts.slice(sagemakerIndex + 1);

  if (keyParts.length === 0) {
    throw new Error(`Could not derive an S3 key from directory: ${directory}`);
  }

  return normaliseToS3Path(path.join(...keyParts, "model.tar.gz"));
}

function uploadToS3(localFilePath: string, s3Uri: string): void {
  const result = spawnSync("aws", ["s3", "cp", localFilePath, s3Uri], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`aws s3 cp failed with exit code ${result.status}`);
  }
}

function main(): void {
  const bucket =
    process.env.SAGEMAKER_MODELS_BUCKET ?? MODEL_ARTIFACT_BUCKET_NAME;
  const invocationDirectory = getInvocationDirectory();
  const modelPath = path.join(invocationDirectory, "model.tar.gz");

  if (!existsSync(modelPath)) {
    throw new Error(`Model artifact not found: ${modelPath}`);
  }

  const s3Key = getS3KeyFromDirectory(invocationDirectory);
  const s3Uri = `s3://${bucket}/${s3Key}`;

  console.log(`Uploading ${modelPath}`);
  console.log(`Destination: ${s3Uri}`);

  uploadToS3(modelPath, s3Uri);

  console.log("Upload complete.");
}

main();
