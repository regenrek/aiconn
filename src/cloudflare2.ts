import { createApp, defineEventHandler, readBody } from "h3";
import { toWebHandler } from "h3";

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
      // const effectiveModel = body.model || "deepseek-reasoner";
      // const messages = body.messages || [];
      // const stream = body.stream || false;

      return {
        id: `gen-${Date.now()}-${crypto.randomUUID()}`,
        headerApiKey: headerApiKey,
        body: body.model,
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

const webHandler = toWebHandler(app);

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    return webHandler(request, {
      cloudflare: { env, ctx },
    });
  },
};
