import { existsSync } from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { MODEL_ARTIFACT_BUCKET_NAME } from "../../infra/sagemaker-endpoints";

const MODELS_DIRECTORY = "models";

function normaliseToS3Path(value: string): string {
  return value.split(path.sep).join("/");
}

function getS3KeyFromDirectory(directory: string): string {
  const parts = path.resolve(directory).split(path.sep);
  const modelsIndex = parts.lastIndexOf(MODELS_DIRECTORY);

  if (modelsIndex === -1) {
    throw new Error(
      `Expected the command to be run from a directory under "${MODELS_DIRECTORY}". Received: ${directory}`,
    );
  }

  const keyParts = parts.slice(modelsIndex + 1);

  if (keyParts.length === 0) {
    throw new Error(`Could not derive an S3 key from directory: ${directory}`);
  }

  return normaliseToS3Path(path.join(...keyParts, "model.tar.gz"));
}

function uploadToS3(
  localFilePath: string,
  s3Uri: string,
  profile: string | undefined,
): void {
  const args = [
    ...(profile ? ["--profile", profile] : []),
    "s3",
    "cp",
    localFilePath,
    s3Uri,
  ];
  const result = spawnSync("aws", args, {
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

export function main(profile?: string): void {
  const bucket =
    process.env.SAGEMAKER_MODELS_BUCKET ?? MODEL_ARTIFACT_BUCKET_NAME;
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const modelPath = path.join(invocationDirectory, "model.tar.gz");

  if (!existsSync(modelPath)) {
    throw new Error(`Model artifact not found: ${modelPath}`);
  }

  const s3Key = getS3KeyFromDirectory(invocationDirectory);
  const s3Uri = `s3://${bucket}/${s3Key}`;

  console.log(`Uploading ${modelPath}`);
  console.log(`Destination: ${s3Uri}`);

  uploadToS3(modelPath, s3Uri, profile);

  console.log("Upload complete.");
}
