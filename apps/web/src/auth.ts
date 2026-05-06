import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

const allowedLogins = (process.env.ALLOWED_GITHUB_LOGINS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // Auth.js builds OAuth callback URLs as `${origin}${basePath}/callback/...`
  // so basePath must include `/chat` to match the GitHub OAuth app's callback.
  // Next.js does NOT strip its app-level basePath from req.url for Route
  // Handlers, so the same value works for parsing inbound URLs.
  basePath: "/chat/api/auth",
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    // Gate access by GitHub login allowlist before any DB row is created.
    async signIn({ profile }) {
      const login = (profile as { login?: string } | undefined)?.login?.toLowerCase();
      if (!login) return false;
      if (allowedLogins.length === 0) return true; // open mode (dev only)
      return allowedLogins.includes(login);
    },
    async jwt({ token, profile, user }) {
      if (profile && (profile as { login?: string }).login) {
        token.githubLogin = (profile as { login: string }).login;
      }
      if (user) token.userId = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.userId) (session.user as { id?: string }).id = token.userId as string;
      if (token.githubLogin)
        (session.user as { githubLogin?: string }).githubLogin =
          token.githubLogin as string;
      return session;
    },
  },
  pages: {
    error: "/auth/error",
  },
});
