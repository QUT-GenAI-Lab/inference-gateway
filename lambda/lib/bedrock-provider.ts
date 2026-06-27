import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { GenerateChatProvider, GenerateChatSchema } from "./provider";
import { z } from "zod";

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION,
});

export class BedrockProvider implements GenerateChatProvider {
  async generateChat(
    input: z.infer<typeof GenerateChatSchema.input>,
  ): Promise<z.infer<typeof GenerateChatSchema.output>> {
    const { messages, model, system } = input;
    const command = new ConverseCommand({
      modelId: model,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: [
          {
            text: msg.content,
          },
        ],
      })),
      ...(system && {
        system: [
          {
            text: system,
          },
        ],
      }),
    });
    const response = await client.send(command);
    const text = response.output?.message?.content?.[0]?.text ?? "";
    return { content: text };
  }
}
