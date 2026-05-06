import { DefaultAzureCredential, type AccessToken } from "@azure/identity";

// Cognitive Services / Azure AI scope. Works for AI Foundry inference and
// Azure AI Services OpenAI-compatible endpoints.
const SCOPE = "https://cognitiveservices.azure.com/.default";

const credential = new DefaultAzureCredential();

let cached: AccessToken | null = null;

/**
 * Fetch (and cache) an Entra ID access token for the Azure AI endpoint,
 * using the host's managed identity. Refreshes 5 minutes before expiry.
 */
export async function getAzureAIToken(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresOnTimestamp - now > 5 * 60 * 1000) {
    return cached.token;
  }
  const token = await credential.getToken(SCOPE);
  if (!token) throw new Error("Failed to acquire Azure AI access token");
  cached = token;
  return token.token;
}
