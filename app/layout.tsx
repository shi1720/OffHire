import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OffHire — Rental closeout desk",
  description:
    "Stop the rental clock. Confirm off-rent dates, capture evidence, and track pickup. Built by Shivam Gupta.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
