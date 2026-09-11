import type { Metadata } from "next";
import "./globals.css";
import "../components/secondary.css";
export const metadata: Metadata = {
  title: "OpsWeaver · 数据运营工作台",
  description: "有证据的调查，可审查的行动，可验证的结果。",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
