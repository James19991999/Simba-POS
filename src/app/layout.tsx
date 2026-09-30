import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthProvider";

export const metadata: Metadata = {
  title: "SimbaPOS",
  description: "Restaurant management platform for Kenyan & East African hospitality",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-surface text-on-surface font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
