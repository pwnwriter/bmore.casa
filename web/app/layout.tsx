import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk", display: "swap" });

const title = "bmore.casa";
const description =
  "Explore the changing landscape of Baltimore, one building at a time - vacant building notices, rehab permits, demolitions and building permits from Baltimore City open data.";

// Icons and the share card come from app/icon.svg, app/apple-icon.tsx and app/opengraph-image.tsx.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || "https://bmore.casa"),
  title,
  description,
  applicationName: title,
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: title, title, description, url: "/", locale: "en_US" },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = { themeColor: "#060a14", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${grotesk.variable}`}>
      <body>{children}</body>
    </html>
  );
}
