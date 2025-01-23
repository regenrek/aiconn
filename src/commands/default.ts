import {
  createApp,
  defineEventHandler,
  readBody,
  setHeader,
  getMethod,
} from "h3";

import { createServer } from "node:http";
import process from "node:process";
import { toNodeListener } from "h3";

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

type DeepseekResponse = {
  error?: { message: string; type: string };
  model?: string;
  choices?: Array<{
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

/** If Cursor calls "gpt-3.5-turbo" or "gpt-4", override them with "deepseek-chat" or "deepseek-reasoner". */
function mapIncomingModel(originalModel: string): string {
  if (originalModel === "gpt-3.5-turbo") return "deepseek-chat";
  if (originalModel === "gpt-4") return "deepseek-reasoner";
  return originalModel;
}

export default async function defaultMain(rawArgs: Argv) {
  // Create H3 app
  const app = createApp();

  app.use(
    "/v1/models",
    defineEventHandler((event) => {
      setCors(event);

      // Handle preflight
      if (getMethod(event) === "OPTIONS") {
        event.node.res.statusCode = 204;
        event.node.res.end();
        return;
      }

      // Return a sample list (like the Go code)
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

  app.use(
    "/v1/chat/completions",
    defineEventHandler(async (event) => {
      setCors(event);

      if (getMethod(event) === "OPTIONS") {
        event.node.res.statusCode = 204;
        event.node.res.end();
        return;
      }

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

      const messages = body?.messages ?? [];
      const stream = !!body?.stream;

      const deepseekModel = mapIncomingModel(originalModel);

      const url = "https://api.deepseek.com/v1/chat/completions";
      let deepSeekResp: Response;
      try {
        deepSeekResp = await fetch(url, {
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
        });
      } catch (error_: any) {
        event.node.res.statusCode = 502;
        return {
          error: {
            message: error_?.message || "Error calling DeepSeek API",
            type: "api_error",
          },
        };
      }

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

        event.node.res.setHeader("Content-Type", "text/event-stream");
        event.node.res.setHeader("Connection", "keep-alive");
        event.node.res.setHeader("Cache-Control", "no-cache");
        // Optionally chunked:
        event.node.res.setHeader("Transfer-Encoding", "chunked");

        let leftover = "";
        try {
          for await (const chunk of deepSeekResp.body as any) {
            const chunkStr = leftover + new TextDecoder().decode(chunk);
            const lines = chunkStr.split("\n");
            leftover = lines.pop() || ""; // keep any partial line

            for (let line of lines) {
              line = line.trim();
              if (!line) continue;

              // Typically, DeepSeek might already send "data: {...}" lines.
              event.node.res.write(line + "\n");
              event.node.res.write("\n"); // blank line (SSE requires two newlines)
            }
          }

          if (leftover.trim()) {
            event.node.res.write(`data: ${leftover.trim()}\n\n`);
          }
          event.node.res.write("data: [DONE]\n\n");
        } catch (error_: any) {
          console.error("Error streaming from DeepSeek:", error_);
        }

        // End SSE
        event.node.res.end();
        return;
      }

      // 6) Non-streaming flow: read entire JSON
      let deepseekJson: DeepseekResponse | null = null;
      try {
        deepseekJson = (await deepSeekResp.json()) as DeepseekResponse;
      } catch {
        event.node.res.statusCode = 502;
        return {
          error: {
            message: "Failed to parse JSON from DeepSeek",
            type: "api_error",
          },
        };
      }

      // If error, forward the status + JSON
      if (!deepSeekResp.ok || deepseekJson?.error) {
        event.node.res.statusCode = deepSeekResp.status || 400;
        return (
          deepseekJson || {
            error: {
              message: "Unknown error calling DeepSeek",
              type: "api_error",
            },
          }
        );
      }

      // Build an OpenAI-like response
      return {
        id: `gen-${Date.now()}-${crypto.randomUUID()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: originalModel,
        choices: (deepseekJson.choices ?? []).map((choice) => ({
          index: choice.index,
          message: {
            role: choice.message.role,
            content: choice.message.content ?? "",
            reasoning_content: choice.message.reasoning_content,
            refusal: null,
          },
          logprobs: null,
          finish_reason: choice.finish_reason,
        })),

        usage: {
          prompt_tokens: deepseekJson.usage?.prompt_tokens ?? 0,
          completion_tokens: deepseekJson.usage?.completion_tokens ?? 0,
          total_tokens: deepseekJson.usage?.total_tokens ?? 0,
        },
      };
    })
  );

  const args = process.argv.slice(2);
  const port = args.includes("--port")
    ? Number.parseInt(args[args.indexOf("--port") + 1], 10)
    : 6000;
  const hostname = args.includes("--hostname")
    ? args[args.indexOf("--hostname") + 1]
    : "0.0.0.0";

  console.log(`Starting Bun server on ${hostname}:${port}...`);

  const nodeListener = toNodeListener(app);
  const server = createServer(nodeListener);

  server.listen(port, hostname, () => {
    console.log(`Server is running at http://${hostname}:${port}/`);
  });
}
