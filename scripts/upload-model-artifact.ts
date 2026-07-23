import { main as uploadRealtimeArtifact } from "./upload-helpers/upload-realtime-artifact";
import { main as uploadServerlessArtifact } from "./upload-helpers/upload-serverless-artifact";

import { existsSync } from "node:fs";

function main(): void {
  // Determine whether the model artifact is a directory (for real-time inference) or a file (for serverless inference)
  const modelPath = process.env.INIT_CWD ?? process.cwd();

  if (!existsSync(modelPath)) {
    throw new Error(`Model artifact not found: ${modelPath}`);
  }

  // Check if the path has realtime-inference, or serverless-inference in its path to determine which upload function to call
  if (modelPath.includes("realtime-inference")) {
    uploadRealtimeArtifact();
  } else if (modelPath.includes("serverless-inference")) {
    uploadServerlessArtifact();
  } else {
    throw new Error(
      `Could not determine inference type from model path: ${modelPath}`,
    );
  }
}

main();
