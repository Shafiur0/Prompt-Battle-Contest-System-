import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Prompt Battle · The competition arena", description: "A fair arena for better prompts. Compete, improve your approach, and submit your best AI-generated solution." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
