import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const canonicalUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const title = "Verdean — Quote-to-contract validation agent";
const description = "A local-folder-first agent for reviewing quote-to-contract evidence and discrepancies with humans in control.";

export const metadata: Metadata = {
  metadataBase: new URL(canonicalUrl),
  title,
  description,
  alternates: { canonical: "/" },
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any", type: "image/x-icon" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/verdean-mark-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/verdean-mark-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    url: canonicalUrl,
    siteName: "Verdean",
    title,
    description,
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "Verdean quote-to-contract validation workspace" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body></html>;
}
