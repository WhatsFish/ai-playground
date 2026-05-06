import { NextRequest } from "next/server";
import { handlers } from "@/auth";

// Next.js strips its app-level basePath ("/chat") from `request.url` before
// calling the route handler, but Auth.js needs the full pathname to match its
// configured basePath ("/chat/api/auth") for both inbound action parsing and
// outbound OAuth callback URL generation. Re-prepend "/chat" so the two ends
// stay consistent. We rebuild a NextRequest because next-auth reads
// `request.nextUrl` internally.
function withBasePath(handler: (req: any) => Promise<Response>) {
  return async (req: NextRequest) => {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/chat")) {
      url.pathname = "/chat" + url.pathname;
    }
    const init: RequestInit & { duplex?: string } = {
      method: req.method,
      headers: req.headers,
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      init.body = req.body;
      init.duplex = "half";
    }
    const proxied = new NextRequest(url, init as any);
    return handler(proxied);
  };
}

export const GET = withBasePath(handlers.GET);
export const POST = withBasePath(handlers.POST);
