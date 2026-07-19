import { getChatGPTUser } from "./chatgpt-auth";
import { AuthorizationApp } from "./components/AuthorizationApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return <AuthorizationApp user={user ? { name: user.displayName, email: user.email } : null} />;
}
