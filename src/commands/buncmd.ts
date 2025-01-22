// buncmd.ts

import { createApp, defineEventHandler, readBody } from "h3";
import { toWebHandler } from "h3";

/**
 * DeepseekResponse models the shape of a typical DeepSeek response.
 * If the actual API differs, please adjust as needed.
 */
type DeepseekResponse = {
  error?: { message: string; type: string };
  model?: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
      reasoning_content?: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

/**
 * If you have multiple DeepSeek "models" that place content in
 * different fields (e.g., 'content' vs. 'reasoning_content'),
 * configure them here. The getContentField helper will pick the right
 * property from each 'message' in the DeepSeek response.
 */
export type ModelConfig = {
  model: string;
  contentField: string;
};

const modelConfigs: ModelConfig[] = [
  {
    model: "deepseek-reasoner",
    contentField: "reasoning_content",
  },
  {
    model: "deepseek-chat",
    contentField: "content",
  },
];

/**
 * Helper to find the correct content field for the specified model.
 */
const getContentField = (model: string): string => {
  const config = modelConfigs.find((c) => c.model === model);
  return config?.contentField || "content";
};

/**
 * The exported default function is what you call from your Bun script,
 * typically something like:
 *
 *    bun run buncmd.ts
 *
 * or
 *
 *    import bunCommand from './buncmd';
 *    bunCommand({});
 */
export default async function bunCommand(args: any): Promise<void> {
  const app = createApp();

  /**
   * Main route: /v1/chat/completions
   *
   * - Expects a JSON body containing { model, messages, stream? }
   * - Forwards the request to DeepSeek’s API with the same payload.
   * - Translates the DeepSeek response into an OpenAI-like JSON object.
   */
  app.use(
    "/v1/chat/completions",
    defineEventHandler(async (event) => {
      const request = event.node.req;

      // Get the Authorization header (Bearer token)
      const authHeader = request.headers["authorization"];
      const headerApiKey = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;

      // If no API key, return 401
      if (!headerApiKey) {
        event.node.res.statusCode = 401;
        return {
          error: {
            message:
              "No API key found. Provide via Bearer token in your Authorization header.",
            type: "invalid_request_error",
          },
        };
      }

      // If the incoming header does NOT start with Bearer, prepend it.
      const formattedAuthToken = headerApiKey.startsWith("Bearer ")
        ? headerApiKey
        : `Bearer ${headerApiKey}`;

      try {
        // Read JSON body from client. We expect { model, messages, stream? }.
        const body = await readBody<any>(event);

        // Fallback to "deepseek-reasoner" if no model is specified
        const effectiveModel = body.model || "deepseek-reasoner";
        const messages = body.messages || [];
        const stream = body.stream || false; // Not handled for SSE in this snippet

        // Construct the request to DeepSeek. The path is:
        //   https://api.deepseek.com/v1/chat/completions
        // (Or whichever endpoint you need.)
        const url = `https://api.deepseek.com/v1/chat/completions`;

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: formattedAuthToken,
          },
          body: JSON.stringify({
            model: effectiveModel,
            messages,
            stream, // Will be ignored by this snippet for streaming
          }),
        });

        // Attempt to parse JSON from DeepSeek
        const deepseekResponse = (await response.json()) as DeepseekResponse;

        // If DeepSeek returned an error field, forward it with status=400
        if (deepseekResponse?.error) {
          event.node.res.statusCode = 400;
          return deepseekResponse;
        }

        // Format the result as an OpenAI-like response:
        //  { id, object, created, model, choices[], usage, etc. }
        return {
          id: `gen-${Date.now()}-${crypto.randomUUID()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: deepseekResponse.model || effectiveModel,
          choices: deepseekResponse.choices.map((choice) => {
            const contentField = getContentField(effectiveModel);
            return {
              index: choice.index,
              message: {
                role: choice.message.role,
                // If the model is "deepseek-reasoner", we pick "reasoning_content"
                // If "deepseek-chat", we pick "content"
                // If it’s missing, fallback to the standard "content" or "DUMMY".
                content:
                  (choice.message as Record<string, string>)[contentField] ||
                  choice.message.content ||
                  "DUMMY",
                refusal: null, // Extra property for your usage, if needed
              },
              logprobs: null,
              finish_reason: choice.finish_reason,
            };
          }),
          usage: {
            prompt_tokens: deepseekResponse.usage?.prompt_tokens || 0,
            completion_tokens: deepseekResponse.usage?.completion_tokens || 0,
            total_tokens: deepseekResponse.usage?.total_tokens || 0,
            // Some frontends expect extra usage details; these are placeholders.
            prompt_tokens_details: {
              cached_tokens: 0,
              audio_tokens: 0,
            },
            completion_tokens_details: {
              reasoning_tokens: 0,
              audio_tokens: 0,
              accepted_prediction_tokens: 0,
              rejected_prediction_tokens: 0,
            },
          },
          service_tier: "default",
          system_fingerprint: `fp_${crypto.randomUUID()}`,
        };
      } catch (error: any) {
        // If fetch or JSON parse fails, respond with a 502
        event.node.res.statusCode = 502;
        return {
          error: {
            message: error?.message || "Error calling DeepSeek API",
            type: "api_error",
          },
        };
      }
    })
  );

  // Convert the h3 app into a native Web Fetch Handler for Bun
  const handler = toWebHandler(app);

  console.log("Starting Bun server on port 6000...");

  // Start Bun.serve on port 3000
  Bun.serve({
    hostname: "0.0.0.0",
    port: 6000,
    fetch: (req) => handler(req),
  });

  // Keep the process running
  await new Promise(() => {});
}
