// cloudflare.ts (TypeScript) or cloudflare.mjs (JavaScript)
import { createApp, defineEventHandler, readBody } from "h3";
import { toWebHandler } from "h3";
//import { getContentField } from "./modelconfig";

type ModelConfig = {
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

const getContentField = (model: string): string => {
  const config = modelConfigs.find((c) => c.model === model);
  return config?.contentField || "content";
};

// IMPORTANT: Cloudflare Workers don't support `process.env` or `process.argv`,
// so you must rely on environment variables set via Wrangler or read them
// from the request headers, etc.

// Add type at the top
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

const app = createApp();

// Recreate the same logic from default.ts.
// Instead of reading from process.env or process.argv,
// read from env (passed in below) or from request headers.

app.use(
  "/v1/chat/completions",
  defineEventHandler(async (event) => {
    const request = event.node.req;
    const authHeader = request.headers["authorization"];
    const headerApiKey = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

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

    const formattedAuthToken = headerApiKey.startsWith("Bearer ")
      ? headerApiKey
      : `Bearer ${headerApiKey}`;

    try {
      const body = await readBody<any>(event);
      const effectiveModel = body.model || "deepseek-reasoner";
      const messages = body.messages || [];
      const stream = body.stream || false;

      const url = `https://api.deepseek.com/v1/chat/completions`;

      // Use fetch directly instead of $fetch to avoid Buffer issues
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: formattedAuthToken,
        },
        body: JSON.stringify({ model: effectiveModel, messages, stream }),
      });

      const deepseekResponse = (await response.json()) as DeepseekResponse;

      if (deepseekResponse?.error) {
        event.node.res.statusCode = 400;
        return deepseekResponse;
      }

      return {
        id: `gen-${Date.now()}-${crypto.randomUUID()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: deepseekResponse.model || effectiveModel,
        choices: deepseekResponse.choices.map(
          (choice: {
            index: number;
            message: {
              role: string;
              content: string;
              reasoning_content?: string;
            };
            finish_reason: string;
          }) => {
            const contentField = getContentField(effectiveModel);
            return {
              index: choice.index,
              message: {
                role: choice.message.role,
                content:
                  (choice.message as Record<string, string>)[contentField] ||
                  choice.message.content ||
                  "DUMMY",
                refusal: null,
              },
              logprobs: null,
              finish_reason: choice.finish_reason,
            };
          }
        ),
        usage: {
          prompt_tokens: deepseekResponse.usage?.prompt_tokens || 0,
          completion_tokens: deepseekResponse.usage?.completion_tokens || 0,
          total_tokens: deepseekResponse.usage?.total_tokens || 0,
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

// Convert your `app` to a standard Web Fetch handler
const handler = toWebHandler(app);

// Export the Cloudflare Worker fetch() method
export default {
  async fetch(request: Request, env: any, ctx: any) {
    // Optionally use env, ctx in your route logic above.
    // Pass them as part of the "cloudflare" property if you'd like:
    return handler(request, {
      cloudflare: { env, ctx },
    });
  },
};
