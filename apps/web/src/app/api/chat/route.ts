import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAzureAIToken } from "@/lib/azure-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENDPOINT = process.env.AZURE_AI_ENDPOINT!;
const MODEL = process.env.AZURE_AI_DEFAULT_MODEL!;

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type ChatBody = {
  conversationId?: string;
  messages: ChatMessage[];
};

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response("messages required", { status: 400 });
  }
  const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg) {
    return new Response("at least one user message required", { status: 400 });
  }

  // Find or create the conversation.
  let conversation = body.conversationId
    ? await prisma.conversation.findFirst({
        where: { id: body.conversationId, userId },
      })
    : null;
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        userId,
        model: MODEL,
        title: lastUserMsg.content.slice(0, 60),
      },
    });
  }

  // Persist the user message immediately so refresh keeps it.
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "user",
      content: lastUserMsg.content,
    },
  });

  // Call Azure AI with a managed-identity bearer token.
  const token = await getAzureAIToken();
  const upstream = await fetch(
    `${ENDPOINT.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: body.messages,
        stream: true,
      }),
    },
  );

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(`Upstream error: ${upstream.status} ${text}`, {
      status: 502,
    });
  }

  // Tee the SSE stream: forward to the browser, collect assistant text in
  // memory, and persist when the stream ends.
  const conversationId = conversation.id;
  let assistantText = "";

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      const text = new TextDecoder().decode(chunk);
      // Each SSE event is "data: {json}\n\n"; extract delta.content.
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const obj = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const delta = obj.choices?.[0]?.delta?.content;
          if (delta) assistantText += delta;
        } catch {
          // ignore malformed events
        }
      }
    },
    async flush() {
      if (assistantText) {
        await prisma.message.create({
          data: {
            conversationId,
            role: "assistant",
            content: assistantText,
          },
        });
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });
      }
    },
  });

  // Pass conversation id to the client via header so it can update its URL.
  return new Response(upstream.body.pipeThrough(transform), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Conversation-Id": conversationId,
    },
  });
}
