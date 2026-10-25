import { existsSync } from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { MODEL_ARTIFACT_BUCKET_NAME } from "../../infra/sagemaker-endpoints";

const MODELS_DIRECTORY = "models";
const CODE_DIRECTORY = "code";

function normaliseToS3Path(value: string): string {
  return value.split(path.sep).join("/");
}

function getS3PrefixFromDirectory(directory: string): string {
  const parts = path.resolve(directory).split(path.sep);
  const modelsIndex = parts.lastIndexOf(MODELS_DIRECTORY);

  if (modelsIndex === -1) {
    throw new Error(
      `Expected the command to be run from a directory under "${MODELS_DIRECTORY}". Received: ${directory}`,
    );
  }

  const keyParts = parts.slice(modelsIndex + 1);

  if (keyParts.length === 0) {
    throw new Error(
      `Could not derive an S3 prefix from directory: ${directory}`,
    );
  }

  return `${normaliseToS3Path(path.join(...keyParts, "uncompressed"))}/`;
}

function syncToS3(
  localDirectory: string,
  s3Uri: string,
  profile: string | undefined,
  additionalArguments: string[] = [],
): void {
  const args = [
    ...(profile ? ["--profile", profile] : []),
    "s3",
    "sync",
    localDirectory,
    s3Uri,
    ...additionalArguments,
  ];

  console.log(`Running: aws ${args.join(" ")}`);

  const result = spawnSync("aws", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`aws s3 sync failed with exit code ${result.status}`);
  }
}

function uploadToS3(
  modelPath: string,
  s3Uri: string,
  profile: string | undefined,
): void {
  const codePath = path.join(modelPath, CODE_DIRECTORY);

  console.log("Syncing model files using file-size comparison only.");

  syncToS3(modelPath, s3Uri, profile, [
    "--delete",
    "--size-only",
    "--exclude",
    `${CODE_DIRECTORY}/*`,
  ]);

  if (!existsSync(codePath)) {
    console.log(`Code directory not found; skipping: ${codePath}`);
    return;
  }

  console.log("Syncing code files using normal size and timestamp comparison.");

  syncToS3(codePath, `${s3Uri}${CODE_DIRECTORY}/`, profile, ["--delete"]);
}

export function main(profile?: string): void {
  const bucket =
    process.env.SAGEMAKER_MODELS_BUCKET ?? MODEL_ARTIFACT_BUCKET_NAME;

  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const modelPath = path.join(invocationDirectory, "model");

  if (!existsSync(modelPath)) {
    throw new Error(`Model artifact directory not found: ${modelPath}`);
  }

  const s3Prefix = getS3PrefixFromDirectory(invocationDirectory);
  const s3Uri = `s3://${bucket}/${s3Prefix}`;

  console.log(`Uploading ${modelPath}`);
  console.log(`Destination: ${s3Uri}`);

  uploadToS3(modelPath, s3Uri, profile);

  console.log("Upload complete.");
}
