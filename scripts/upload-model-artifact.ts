import { main as uploadRealtimeArtifact } from "./upload-helpers/upload-realtime-artifact";
import { main as uploadServerlessArtifact } from "./upload-helpers/upload-serverless-artifact";

import { existsSync } from "node:fs";

export function getProfile(args: string[]): string | undefined {
  const profileIndex = args.lastIndexOf("--profile");

  if (profileIndex === -1) {
    return undefined;
  }

  const profile = args[profileIndex + 1];
  if (!profile || profile.startsWith("--")) {
    throw new Error("Expected a profile name after --profile");
  }

  return profile;
}

export function main(args = process.argv.slice(2)): void {
  const profile = getProfile(args);

  // npm runs scripts from the package root; INIT_CWD keeps the model directory.
  const modelPath = process.env.INIT_CWD ?? process.cwd();

  if (!existsSync(modelPath)) {
    throw new Error(`Model artifact not found: ${modelPath}`);
  }

  if (modelPath.includes("realtime-inference")) {
    uploadRealtimeArtifact(profile);
  } else if (modelPath.includes("serverless-inference")) {
    uploadServerlessArtifact(profile);
  } else {
    throw new Error(
      `Could not determine inference type from model path: ${modelPath}`,
    );
  }
}

if (require.main === module) {
  main();
}
