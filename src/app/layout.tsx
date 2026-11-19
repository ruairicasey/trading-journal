import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { privacyBootScript } from "@/components/shell/privacy-toggle";
import "./globals.css";

const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex", display: "swap" });
// only for dates and small notes in dense rows
const plexCondensed = IBM_Plex_Sans_Condensed({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-condensed",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Trading Journal",
  description: "Personal Hyperliquid trading journal",
  // Private app: never index, even if a URL leaks.
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: privacyBootScript }} />
      </head>
      <body className={`${plex.variable} ${plexCondensed.variable} font-sans antialiased`}>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
