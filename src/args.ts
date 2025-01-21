import mri from "mri";

export interface ParsedArgs {
  apiKey?: string
  baseUrl?: string
  model?: string
  port?: number
  https: boolean
  rawResponse: boolean
}

export function parseArgs(args: string[]): ParsedArgs {
  const argv = mri(args, {
    alias: {
      k: "apiKey",
      u: "baseUrl",
      m: "model",
      p: "port",
      s: "https",
      r: "rawResponse"
    },
    string: ["apiKey", "baseUrl", "model"],
    boolean: ["https", "rawResponse"],
    default: {
      https: false,
      rawResponse: false
    }
  });

  return {
    apiKey: argv.apiKey,
    baseUrl: argv.baseUrl,
    model: argv.model,
    port: argv.port ? Number(argv.port) : undefined,
    https: argv.https,
    rawResponse: argv.rawResponse
  };
}
