import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";

export default async function Home() {
  const session = await auth();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 gap-6">
      <h1 className="text-3xl font-bold">ai-playground</h1>
      <p className="text-zinc-500 max-w-md text-center">
        A small personal chat UI talking to Azure-hosted models.
      </p>

      {session?.user ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-zinc-600">
            Signed in as{" "}
            <span className="font-mono">
              {(session.user as { githubLogin?: string }).githubLogin ?? session.user.name}
            </span>
          </p>
          <Link
            href="/chat"
            className="px-4 py-2 rounded-md bg-black text-white text-sm hover:opacity-80"
          >
            Open chat →
          </Link>
          <form
            action={async () => {
              "use server";
              await signOut();
            }}
          >
            <button className="text-xs text-zinc-500 underline" type="submit">
              Sign out
            </button>
          </form>
        </div>
      ) : (
        <form
          action={async () => {
            "use server";
            await signIn("github");
          }}
        >
          <button className="px-4 py-2 rounded-md bg-black text-white text-sm hover:opacity-80">
            Sign in with GitHub
          </button>
        </form>
      )}
    </main>
  );
}
