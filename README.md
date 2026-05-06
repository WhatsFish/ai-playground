# ai-playground

A small personal chat UI that talks to models hosted on **Azure AI Foundry**
(via the Azure AI Inference API), gated by **GitHub OAuth**, deployed on the
same Azure VM that hosts the blog and analytics stack.

> Status: **design**. No code yet — see [docs/DESIGN.md](docs/DESIGN.md).

## Why
- Have a private place to try models (Llama, Mistral, Phi, GPT-OSS, …) without
  juggling each vendor's SDK.
- Keep the keys server-side; never ship a model key to the browser.
- Reuse infra I already pay for (the VM, the Postgres container, the Nginx in
  front).

## Layout (planned)
```
ai-playground/
├── docs/
│   ├── DESIGN.md              architecture, decisions, threat model
│   └── AZURE-SETUP.md         step-by-step Azure resource provisioning
├── apps/
│   └── web/                   Next.js 14 app (App Router, TS)
├── docker-compose.yml         web + reuse external Postgres
├── .env.example
└── README.md
```

## Endpoints (planned)
- `https://<host>/chat`        — UI (after OAuth)
- `POST /chat/api/chat`        — server route, streams from Azure AI
- `GET  /chat/api/auth/*`      — Auth.js (GitHub OAuth)

See the design doc for everything else.
