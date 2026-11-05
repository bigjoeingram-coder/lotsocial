import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { InventoryHardeningClient } from "./components/InventoryHardeningClient";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;
  const title = "LotSocial Inventory Authorization";
  const description = "Request, document, and manage dealership inventory permissions before activating a feed.";

  return {
    title,
    description,
    manifest: "/manifest.webmanifest",
    icons: { icon: "/favicon.svg", apple: "/icon-192.png" },
    themeColor: "#0868f5",
    openGraph: { title, description, images: [{ url: imageUrl, width: 1536, height: 1024, alt: "LotSocial inventory permission workflow" }] },
    twitter: { card: "summary_large_image", title, description, images: [imageUrl] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>
    {children}
    <InventoryHardeningClient />
    <footer className="site-footer">
      <p>LotSocial</p>
      <nav aria-label="Site legal links">
        <Link href="/legal">Legal Center</Link>
        <Link href="/legal/terms">Terms of Service</Link>
        <Link href="/legal/privacy">Privacy Policy</Link>
        <Link href="/legal/accuracy">Accuracy</Link>
        <Link href="/legal/fraud-awareness">Fraud Awareness</Link>
        <Link href="/legal/authorization">Authorization</Link>
        <Link href="/legal/report">Report a Listing</Link>
      </nav>
    </footer>
  </body></html>;
}
