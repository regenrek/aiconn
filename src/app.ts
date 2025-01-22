import {
  createApp,
  defineEventHandler,
  readBody,
  setHeader,
  getMethod,
} from "h3";

/** CORS helper */
function setCors(event: any) {
  setHeader(event, "Access-Control-Allow-Origin", "*");
  setHeader(event, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  setHeader(
    event,
    "Access-Control-Allow-Headers",
    "Origin, Content-Type, Accept, Authorization"
  );
  setHeader(event, "Access-Control-Expose-Headers", "Content-Length");
  setHeader(event, "Access-Control-Allow-Credentials", "true");
}

/** DeepSeek response type */
type DeepseekResponse = {
  error?: { message: string; type: string };
  model?: string;
  choices?: Array<{
    index: number;
    message: {
      role: string;
      content?: string;
      reasoning_content?: string;
      [key: string]: string | undefined;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

const modelConfigs = [
  { model: "deepseek-reasoner", contentField: "reasoning_content" },
  { model: "deepseek-chat", contentField: "content" },
];
function getContentField(model: string): string {
  const conf = modelConfigs.find((c) => c.model === model);
  return conf?.contentField || "content";
}

/** Map model from Cursor to DeepSeek */
function mapIncomingModel(originalModel: string): string {
  if (originalModel === "gpt-3.5-turbo") return "deepseek-chat";
  if (originalModel === "gpt-4") return "deepseek-reasoner";
  return originalModel;
}

/** Create your H3 app */
export const app = createApp();

/** Optional: /v1/models endpoint */
app.use(
  "/v1/models",
  defineEventHandler((event) => {
    setCors(event);

    if (getMethod(event) === "OPTIONS") {
      event.node.res.statusCode = 204;
      event.node.res.end();
      return;
    }

    return {
      object: "list",
      data: [
        {
          id: "deepseek-chat",
          object: "model",
          created: Date.now(),
          owned_by: "deepseek",
        },
        {
          id: "deepseek-reasoner",
          object: "model",
          created: Date.now(),
          owned_by: "deepseek",
        },
      ],
    };
  })
);

/** Main /v1/chat/completions route */
app.use(
  "/v1/chat/completions",
  defineEventHandler(async (event) => {
    setCors(event);

    if (getMethod(event) === "OPTIONS") {
      event.node.res.statusCode = 204;
      event.node.res.end();
      return;
    }

    // Auth
    const authHeader = event.node.req.headers["authorization"];
    const headerApiKey = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!headerApiKey) {
      event.node.res.statusCode = 401;
      return {
        error: {
          message:
            "No API key found. Provide it via 'Authorization: Bearer <key>'.",
          type: "invalid_request_error",
        },
      };
    }

    const formattedAuthToken = headerApiKey.startsWith("Bearer ")
      ? headerApiKey
      : `Bearer ${headerApiKey}`;

    // Read JSON body
    let body: any;
    try {
      body = await readBody(event);
    } catch {
      event.node.res.statusCode = 400;
      return {
        error: {
          message: "Invalid JSON body",
          type: "invalid_request_error",
        },
      };
    }

    const originalModel = body.model || "gpt-3.5-turbo";
    const messages = body.messages ?? [];
    const stream = !!body.stream;
    const deepseekModel = mapIncomingModel(originalModel);

    // Forward to DeepSeek
    let deepSeekResp: Response;
    try {
      deepSeekResp = await fetch(
        "https://api.deepseek.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: formattedAuthToken,
          },
          body: JSON.stringify({
            model: deepseekModel,
            messages,
            stream,
          }),
        }
      );
    } catch (error_: any) {
      event.node.res.statusCode = 502;
      return {
        error: {
          message: error_?.message || "Error calling DeepSeek API",
          type: "api_error",
        },
      };
    }

    // STREAMING (SSE) logic:
    if (stream) {
      if (!deepSeekResp.ok) {
        let errData = null;
        try {
          errData = await deepSeekResp.json();
        } catch {}
        event.node.res.statusCode = deepSeekResp.status;
        return (
          errData || {
            error: {
              message: `DeepSeek streaming error (HTTP ${deepSeekResp.status})`,
              type: "api_error",
            },
          }
        );
      }

      // Set SSE headers
      event.node.res.setHeader("Content-Type", "text/event-stream");
      event.node.res.setHeader("Connection", "keep-alive");
      event.node.res.setHeader("Cache-Control", "no-cache");

      // We do a minimal pass-through of lines
      let leftover = "";
      try {
        for await (const chunk of deepSeekResp.body as any) {
          const chunkStr = leftover + new TextDecoder().decode(chunk);
          const lines = chunkStr.split("\n");
          leftover = lines.pop() || "";

          for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            // Just pass line + blank line
            event.node.res.write(line + "\n");
            event.node.res.write("\n");
          }
        }

        if (leftover.trim()) {
          event.node.res.write(`data: ${leftover.trim()}\n\n`);
        }
        event.node.res.write("data: [DONE]\n\n");
      } catch (error_) {
        console.error("Stream error from DeepSeek:", error_);
      }

      // End
      event.node.res.end();
      return;
    }

    // NON-STREAM logic
    let dsJson: DeepseekResponse;
    try {
      dsJson = (await deepSeekResp.json()) as DeepseekResponse;
    } catch {
      event.node.res.statusCode = 502;
      return {
        error: {
          message: "Failed to parse JSON from DeepSeek",
          type: "api_error",
        },
      };
    }

    if (!deepSeekResp.ok || dsJson?.error) {
      event.node.res.statusCode = deepSeekResp.status || 400;
      return (
        dsJson ?? {
          error: {
            message: "Unknown error calling DeepSeek",
            type: "api_error",
          },
        }
      );
    }

    const contentField = getContentField(deepseekModel);

    return {
      id: `gen-${Date.now()}-${crypto.randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: originalModel,
      choices: (dsJson.choices ?? []).map((choice) => ({
        index: choice.index,
        message: {
          role: choice.message.role,
          content:
            choice.message[contentField] ?? choice.message.content ?? "DUMMY",
        },
        finish_reason: choice.finish_reason,
      })),
      usage: {
        prompt_tokens: dsJson.usage?.prompt_tokens ?? 0,
        completion_tokens: dsJson.usage?.completion_tokens ?? 0,
        total_tokens: dsJson.usage?.total_tokens ?? 0,
      },
    };
  })
);
