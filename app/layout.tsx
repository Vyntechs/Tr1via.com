import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/system/ThemeProvider";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: {
    default: "TR1VIA",
    template: "%s · TR1VIA",
  },
  description: "Live trivia, designed to make the room feel alive.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "TR1VIA",
    description: "Live trivia, designed to make the room feel alive.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximumScale: blocking pinch-zoom is a WCAG 1.4.4 failure and, on the
  // host screens, removes the user's only escape hatch when content is tight.
  // Users may zoom; this changes nothing about the default-scale desktop view.
  themeColor: "#1B130C",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="daylight"
      className={`${geist.variable} ${geistMono.variable} ${bricolage.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider themeKey="daylight">{children}</ThemeProvider>
      </body>
    </html>
  );
}
