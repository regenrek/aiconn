import { toWebHandler } from "h3";
import { app } from "./app"; // import your H3 app

// Convert the H3 app into a standard fetch handler
const handler = toWebHandler(app);

export default {
  async fetch(request: Request, env: any, ctx: any) {
    // pass event context (env, ctx) for e.g. logging or KV usage
    return handler(request, {
      cloudflare: {
        env,
        ctx,
      },
    });
  },
};
