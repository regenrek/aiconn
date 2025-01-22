import { createApp, defineEventHandler, readBody, toNodeListener } from "h3";
import type { Argv } from "mri";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { config } from "dotenv";
import selfsigned from "selfsigned";
import { parseArgs } from "../args";
import { $fetch } from "ofetch";
import consola from "consola";
import { getContentField } from "../modelconfig";

export default async function defaultMain(rawArgs: Argv) {
  config();
  consola.level = 5;

  const args = parseArgs(process.argv.slice(2));

  const API_KEY = args.apiKey || process.env.API_KEY;
  const BASE_URL =
    args.baseUrl || process.env.BASE_URL || "https://api.deepseek.com";
  const DEFAULT_MODEL = args.model || process.env.MODEL || "deepseek-reasoner";
  const PORT = args.port || Number(process.env.PORT) || 5000;

  consola.info({
    message: "Starting server with configuration",
    apiKey: API_KEY ? "****" + API_KEY.slice(-4) : "Not set",
    baseUrl: BASE_URL,
    defaultModel: DEFAULT_MODEL,
    port: PORT,
    https: args.https ? "Yes" : "No",
  });

  const app = createApp();

  app.use(
    "/v1/chat/completions",
    defineEventHandler(async (event) => {
      const authHeader = event.node.req.headers.authorization;
      const headerApiKey = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;
      const effectiveApiKey =
        headerApiKey || args.apiKey || process.env.API_KEY;

      const formattedAuthToken = effectiveApiKey?.startsWith("Bearer ")
        ? effectiveApiKey
        : `Bearer ${effectiveApiKey}`;

      console.log("format", formattedAuthToken);

      consola.verbose({
        message: "Incoming request",
        authorization: authHeader
          ? "Bearer ****" + headerApiKey?.slice(-4)
          : "Not set",
        effectiveApiKey: effectiveApiKey
          ? "****" + effectiveApiKey.slice(-4)
          : "Not set",
      });

      if (!effectiveApiKey) {
        consola.warn("Authentication failed: No API key provided");
        event.node.res.statusCode = 401;
        return {
          error: {
            message:
              "No API key found. Provide via Bearer token, --key argument, or set API_KEY in your environment.",
            type: "invalid_request_error",
          },
        };
      }

      // 2) Read incoming JSON
      const body = await readBody<any>(event);
      const effectiveModel =
        body.model || args.model || process.env.MODEL || "deepseek-reasoner";
      const messages = body.messages || [];
      const stream = body.stream || false;

      consola.verbose({
        message: "Request details",
        model: effectiveModel,
        messages,
        stream,
        formattedAuthToken,
      });

      // 3) Forward to DeepSeek
      const url = `${BASE_URL.replace(/\/+$/, "")}/v1/chat/completions`;

      console.log(url, formattedAuthToken);
      try {
        const deepseekResponse = await $fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: formattedAuthToken,
          },
          body: { model: effectiveModel, messages, stream },
        });

        // If DeepSeek returns an error
        if (deepseekResponse?.error) {
          event.node.res.statusCode = 400;
          return deepseekResponse;
        }

        // Return raw response if rawResponse flag is true
        if (args.rawResponse) {
          return deepseekResponse;
        }

        // Return structured format
        return {
          id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 15)}`,
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
          system_fingerprint: `fp_${Math.random().toString(36).slice(2, 15)}`,
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

  // Create HTTP or HTTPS server based on args.https
  let server;
  if (args.https) {
    const pems = selfsigned.generate(
      [{ name: "commonName", value: "localhost" }],
      {
        days: 1,
      }
    );
    server = createHttpsServer(
      {
        key: pems.private,
        cert: pems.cert,
      },
      toNodeListener(app)
    );
  } else {
    server = createHttpServer(toNodeListener(app));
  }

  server.listen(PORT, "0.0.0.0", () => {
    const protocol = args.https ? "https" : "http";
    consola.success(`AIBridge server running on ${protocol}://0.0.0.0:${PORT}`);
  });
}
