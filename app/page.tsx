import { AuthorizationApp } from "./components/AuthorizationApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  return <AuthorizationApp user={null} />;
}
