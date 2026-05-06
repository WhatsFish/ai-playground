# Azure setup — ai-playground

One-time provisioning of Azure AI Foundry resources for this project.
Everything below is portal-clickable; CLI equivalents are noted at the end.

## 0. Prerequisites
- An Azure subscription with a positive credit balance / payment method.
- Owner or Contributor role on the subscription (so you can create resource
  groups and role assignments).
- A GitHub account (for OAuth) — already done: `WhatsFish`.

## 1. Create the resource group
- Portal → **Resource groups** → **+ Create**
- Name: `rg-ai-playground`
- Region: `East US 2` (or any region with the model you want — Foundry's model
  catalog filters by region)

## 2. Create an Azure AI Foundry hub + project
- Portal → search **Azure AI Foundry** → **+ Create** → **Hub**
- Resource group: `rg-ai-playground`
- Hub name: `aifh-playground`
- Region: same as RG
- Storage / Key Vault / Application Insights: **let it create new ones** (defaults)
- After creation, open the hub → **+ New project**
  - Project name: `proj-chat`

This gives you a Foundry workspace where model deployments live.

## 3. Deploy a model
- Inside the project: **Models + endpoints** → **+ Deploy model**
- Pick from the catalog. Recommended starting points:
  - `Llama-3.3-70B-Instruct` (good quality, pay-as-you-go)
  - `Phi-4` (cheap, good for testing)
- Deployment type: **Serverless API** (a.k.a. "pay-as-you-go endpoint")
- Deployment name: keep the default (you'll use it as the `model` field)
- Accept the per-token pricing prompt
- After deployment finishes, click the deployment → copy the **Target URI**
  (looks like `https://<project>-xxx.<region>.inference.ai.azure.com`).
  We do **not** need the API key — see step 3b.

> If the model you want isn't available in your region, either change the hub's
> region or pick another model. The unified Inference API is the same shape
> regardless.

## 3b. Wire up Managed Identity (no API key)

We authenticate from the VM using its system-assigned managed identity instead
of a plaintext key.

1. **VM → Identity → System assigned → Status: On → Save**.
   _Done._
2. **AI Foundry project (or hub) → Access control (IAM) → Add role assignment**
   - Role: **Cognitive Services User** (least-privilege; only inference)
   - Assign access to: **Managed identity** → pick the VM
   - Save.
   _Done._

From now on, any process running as the VM (including our Docker container,
as long as it can reach `169.254.169.254`) can call the inference endpoint
with no secrets in `.env`.

Verify from the VM:
```bash
# Get a token (sanity check; the SDK does this automatically)
curl -sH "Metadata: true" \
  "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://cognitiveservices.azure.com/" \
  | jq -r .access_token | cut -c1-20 ; echo
```
A non-empty token prefix means MI is working.

## 4. Create the GitHub OAuth app
- GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New**
- Application name: `ai-playground (dev)`
- Homepage URL: `http://20.89.176.30/chat`
- Authorization callback URL: `http://20.89.176.30/chat/api/auth/callback/github`
- Click **Register**, then **Generate a new client secret**
- Copy **Client ID** and **Client secret** into `.env`

When you eventually move to a real domain + HTTPS, register a separate OAuth
app for production rather than editing the dev one.

## 5. Plug everything into `.env`

```
AZURE_AI_ENDPOINT=<Target URI from step 3>
AZURE_AI_DEFAULT_MODEL=<deployment name from step 3>
# No AZURE_AI_API_KEY — we use the VM's managed identity (step 3b).

NEXTAUTH_URL=http://20.89.176.30/chat
NEXTAUTH_SECRET=<openssl rand -hex 32>
GITHUB_CLIENT_ID=<from step 4>
GITHUB_CLIENT_SECRET=<from step 4>
ALLOWED_GITHUB_LOGINS=WhatsFish

DATABASE_URL=postgresql://ai_pg:<pw>@db:5432/ai_playground
```

## 6. Create the database role and DB
On the VM:
```bash
cd ~/src/traffic-monitor
PG_PW=$(openssl rand -hex 16)
sudo docker compose exec -T db psql -U umami -d postgres <<SQL
CREATE ROLE ai_pg LOGIN PASSWORD '$PG_PW';
CREATE DATABASE ai_playground OWNER ai_pg;
SQL
echo "ai_pg password: $PG_PW   <-- paste into ai-playground/.env"
```

## 7. Cost guardrails (do this before shipping)
- Subscription → **Cost Management + Billing** → **Budgets** → **+ Add**
  - Scope: `rg-ai-playground`
  - Amount: e.g. $20 / month
  - Alert at 50%, 80%, 100% to your email
- Optional: tag every resource with `project=ai-playground` for easier filtering.

## 8. CLI equivalents (optional)

```bash
# Resource group
az group create -n rg-ai-playground -l eastus2

# Foundry hub + project: easiest in the portal; the CLI surface is verbose.
# See: https://learn.microsoft.com/azure/ai-studio/how-to/create-projects

# List your model deployments later
az ml online-endpoint list --workspace-name aifh-playground -g rg-ai-playground
```

## 9. What to copy back to me
After the portal steps you should have these values; paste them and I'll
wire up the app:

```
AZURE_AI_ENDPOINT=
AZURE_AI_DEFAULT_MODEL=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

(Or just paste them into the `.env` file directly and tell me you're done.
No Azure key needed — managed identity covers that.)
