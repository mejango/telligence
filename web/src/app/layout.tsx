import { Footer } from "@/components/layout/Footer";
import { MutableHandleNavigationGuard } from "@/components/MutableHandleNavigationGuard";
import { Toaster } from "@/components/ui/toaster";
import type { Metadata } from "next";
import { twMerge } from "tailwind-merge";
import "./globals.css";
import { Providers } from "./providers";

import localFont from "next/font/local";

const simplonMono = localFont({
  src: [
    { path: "../../public/fonts/SimplonMono-Light.otf", weight: "400" },
    { path: "../../public/fonts/SimplonMono-Regular.otf", weight: "500" },
    { path: "../../public/fonts/SimplonMono-Bold.otf", weight: "700" },
  ],
  preload: false,
  variable: "--font-simplon-mono",
});

export const revalidate = 300;

const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002";
// Preview deployments have no canonical domain, so they fall back to the Railway host
// that actually serves them. Once a custom domain is configured it is the public name and
// the one every card should advertise.
const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
const assetOrigin =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (railwayDomain && /^[a-z0-9.-]+$/iu.test(railwayDomain)
    ? `https://${railwayDomain}`
    : siteOrigin);
const siteTitle = "Telligence";
const siteDescription =
  "Fund the compute behind work you believe in. A purpose, a revnet, and an API key to keep going.";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/assets/img/telligence-mark.svg" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body className={twMerge(simplonMono.variable, "min-h-screen font-sans text-zinc-950")}>
        <Providers>
          <MutableHandleNavigationGuard />
          <main className="min-h-screen">{children}</main>
          <Footer />
        </Providers>

        <Toaster />
      </body>
    </html>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  // For the root layout, our fullPath is '/'
  const fullPath = "/";
  const url = new URL(fullPath, siteOrigin);

  const imgUrl = new URL("/api/telligence-og", assetOrigin).href;
  return {
    metadataBase: new URL(siteOrigin),
    title: siteTitle,
    description: siteDescription,
    openGraph: {
      title: siteTitle,
      description: siteDescription,
      url: url.href,
      images: [
        {
          url: imgUrl,
          width: 1200,
          height: 630,
          alt: "Telligence — throw money at a problem together",
          type: "image/png",
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: siteTitle,
      description: siteDescription,
      images: [imgUrl],
    },
  };
}
