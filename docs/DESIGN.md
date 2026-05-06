# ai-playground — Design

> Status: draft v1. Nothing is built yet; this document is the contract.

## 1. Goals & Non-Goals

**Goals**
- A working chat UI talking to Azure-hosted LLMs, end-to-end.
- Vendor-agnostic backend: switching between Llama 3 / Mistral / Phi / GPT-OSS
  should be a config change, not a code change.
- All secrets live on the server. The browser only sees session cookies.
- GitHub login so I can let trusted friends in without inventing a user system.
- Persisted chat history per user.
- Reuse existing infra (VM, Postgres container, Nginx).

**Non-goals (for v1)**
- RAG, tools/function calling, file uploads.
- Multi-tenant billing, quotas per user (a global rate limit is enough).
- Mobile app, native clients.
- Self-hosted models (we lean on Azure for compute).

## 2. High-level Architecture

```
  Browser
     │  HTTPS (later) / HTTP (v1)
     ▼
  Nginx  ──►  /chat/*   ──►  Next.js (Node, :3001)
              /traffic/ ──►  GoAccess HTML
              /        ──►  Hexo static blog
                           Umami :3000 (separate)

  Next.js
     ├── Auth.js (GitHub OAuth)  ─── stores sessions in Postgres
     ├── /api/chat (server route) ── streams ── Azure AI Inference endpoint
     │        │
     │        └─ auth: DefaultAzureCredential ── IMDS ── Entra ID token
     └── Prisma ─► Postgres (`ai_playground` DB) — users, conversations, messages
```

Everything runs as a Docker Compose service on the existing VM. The Postgres
container already used by Umami gets a second database (`ai_playground`); we do
**not** share schemas.

## 3. Azure Resources

Two resources in a fresh resource group `rg-ai-playground` in a region that has
the model you want (e.g. `eastus2` or `swedencentral`).

| Resource                      | SKU / Notes                                              |
| ----------------------------- | -------------------------------------------------------- |
| **Azure AI Foundry hub**      | Standard. The "workspace" container.                     |
| **Azure AI project**          | Inside the hub. Where you deploy models.                 |
| Model deployment (1)          | e.g. `Llama-3.3-70B-Instruct` — pay-as-you-go endpoint.  |
| Model deployment (2, optional)| e.g. `Phi-4` for a cheap fallback.                       |

Each deployment exposes:
- An **endpoint URL** (e.g. `https://<project>.<region>.inference.ai.azure.com`)
- An **API key**

We talk to it through the unified **Azure AI Inference** REST API
(`/chat/completions`), which is OpenAI-shaped — so any OpenAI-compatible client
library works.

> Set up steps in [AZURE-SETUP.md](AZURE-SETUP.md).

## 4. Data Model

Postgres tables (managed by Prisma migrations):

```
User              id, github_id, login, name, avatar_url, created_at
Account           Auth.js OAuth account rows (linked to User)
Session           Auth.js session rows
Conversation      id, user_id, title, model, created_at, updated_at
Message           id, conversation_id, role ('user'|'assistant'|'system'),
                  content, tokens_in, tokens_out, created_at
```

Hard-deleting a user cascades to their conversations and messages.

## 5. Auth Flow

1. User visits `/chat` → Next middleware checks session cookie.
2. If unauthenticated, redirect to `/chat/api/auth/signin/github`.
3. Auth.js handles OAuth round-trip with GitHub.
4. **Allowlist gate**: after OAuth, server checks the GitHub login against
   `ALLOWED_GITHUB_LOGINS` (comma-separated env var). If not in list, sign out
   and show a friendly "request access" page.
5. On success, a `User` row is created/updated; a session cookie is set
   (`HttpOnly`, `Secure` once we have HTTPS, `SameSite=Lax`).

Why allowlist and not "anyone with GitHub"? Token spend goes on my Azure
subscription. Public chat = expensive griefing target.

## 6. Chat Request Flow

```
Browser ──POST /chat/api/chat──► Next.js server route
                                  │
                                  │ 1. validate session
                                  │ 2. load conversation (or create)
                                  │ 3. assemble messages array
                                  │ 4. POST to Azure AI Inference, stream=true
                                  │ 5. pipe SSE chunks back to browser
                                  │ 6. on done, persist user+assistant messages
                                  ▼
                          Postgres (Prisma)
```

Streaming protocol: **SSE** (text/event-stream). The Vercel AI SDK
(`ai` + `@ai-sdk/azure`) handles both sides; on the server we just call
`streamText({ model, messages })` and return its `toDataStreamResponse()`.

## 7. Configuration

`.env` (server-only):

```
# Azure AI — NO key. The VM's system-assigned managed identity holds the
# `Cognitive Services User` role on the AI Foundry project, and
# DefaultAzureCredential picks it up at runtime via IMDS.
AZURE_AI_ENDPOINT=https://<project>.<region>.inference.ai.azure.com
AZURE_AI_DEFAULT_MODEL=Llama-3.3-70B-Instruct

# Auth
NEXTAUTH_URL=http://20.89.176.30/chat
NEXTAUTH_SECRET=...                      # openssl rand -hex 32
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
ALLOWED_GITHUB_LOGINS=WhatsFish

# Database (reuse existing Postgres, separate DB)
DATABASE_URL=postgresql://ai_pg:<pw>@db:5432/ai_playground
```

The only real "secret" left in `.env` is the GitHub OAuth client secret +
NextAuth signing secret + Postgres password. All Azure AI auth is identity-based.

## 8. Deployment

- New service in a new compose file under `~/src/ai-playground/`. The Postgres
  container lives in `~/src/traffic-monitor/`; we attach to it via an external
  Docker network instead of copying it.
- The Next.js container binds `127.0.0.1:3001` only.
- A new Nginx location block `/chat/` reverse-proxies to `http://127.0.0.1:3001/`
  with WebSocket / SSE headers (`proxy_buffering off;`).
- For Managed Identity to work inside the container, IMDS
  (`169.254.169.254`) must be reachable. The default Docker bridge network on
  Linux already allows this; if a future setup blocks it, fall back to
  `network_mode: host`.
- Compose file:

```yaml
services:
  web:
    build: ./apps/web
    env_file: .env
    ports: ["127.0.0.1:3001:3000"]
    restart: unless-stopped
networks:
  default:
    name: traffic-monitor_default
    external: true
```

(Reusing the network gives the web container DNS access to the existing `db`
service.)

## 9. Security Notes

- **Azure AI auth**: zero-secret. The VM's system-assigned managed identity
  has the `Cognitive Services User` role on the AI Foundry project; tokens
  are fetched on-demand via IMDS. Revoke the role assignment to instantly
  cut off access.
- **Other secrets**: GitHub client secret, NextAuth secret, Postgres password
  live only in `.env`, gitignored, owner-readable.
- **CORS**: API routes are same-origin only.
- **CSRF**: Auth.js handles OAuth CSRF; chat POST requires the session cookie
  (which is `SameSite=Lax`).
- **Rate limit**: a global token bucket in memory for v1 (per-IP + per-user),
  e.g. 30 messages / minute. Move to Redis if more than one process runs.
- **Prompt logging**: every request and response goes into Postgres in plain
  text. Don't put real secrets in the chat box.
- **HTTPS**: still pending domain + Let's Encrypt. Until then, OAuth callback
  uses HTTP — fine for dev with one user, must be fixed before sharing.

## 10. Cost Model

Pay-as-you-go on Azure AI Foundry. Rough order of magnitude (subject to change):

- Llama-3.3-70B-Instruct ≈ $0.7 / 1M input tokens, $1 / 1M output.
- Phi-4 ≈ $0.13 / 1M tokens.

A typical 3-turn conversation is ~3K tokens → fractions of a cent. The risk is
runaway loops, hence the allowlist + rate limit.

## 11. Roadmap

- **v1 (this design)**: GitHub OAuth + single-model chat with history.
- **v1.1**: model picker in the UI, "regenerate" button.
- **v1.2**: prompt presets (system messages saved per user).
- **v2**: tool calling (calculator, web fetch), streaming token usage display.
- **v3**: RAG over my blog posts, then over arbitrary uploaded files.

## 12. Open Questions

- Should the conversation list be soft-deletable or hard-deletable? (Lean: hard.)
- Do I want server-side prompt rewriting / safety filter, or trust the model?
- When (not if) I add HTTPS and a domain, does anything in this design change?
  (Mostly env vars and OAuth callback URL.)
