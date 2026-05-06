import { redirect } from "next/navigation";
import { auth } from "@/auth";
import ChatUI from "./ChatUI";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  return <ChatUI />;
}
