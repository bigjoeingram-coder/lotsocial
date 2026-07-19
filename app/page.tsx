import { requireChatGPTUser } from "./chatgpt-auth";
import { AuthorizationApp } from "./components/AuthorizationApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  return <AuthorizationApp user={{ name: user.displayName, email: user.email }} />;
}
