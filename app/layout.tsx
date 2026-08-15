import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
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
    openGraph: { title, description, images: [{ url: imageUrl, width: 1536, height: 1024, alt: "LotSocial inventory permission workflow" }] },
    twitter: { card: "summary_large_image", title, description, images: [imageUrl] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>
    {children}
    <footer style={{ padding: "24px", textAlign: "center", fontSize: "13px", opacity: 0.72 }}>
      <Link href="/privacy">Privacy Policy</Link><span aria-hidden="true"> · </span><Link href="/terms">Terms of Service</Link>
    </footer>
  </body></html>;
}
