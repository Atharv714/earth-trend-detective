import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// On Apple devices the system font (SF Pro) wins; Inter covers everyone else.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Earth Trend Detective",
  description: "Explore how temperature, rainfall and vegetation are changing around the world, using NASA Earth observation data.",
};

export const viewport: Viewport = {
  themeColor: "#010208",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
