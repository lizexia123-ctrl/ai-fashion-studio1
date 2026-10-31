import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Fashion Studio",
  description: "三图参考的服装创意设计工作室"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}