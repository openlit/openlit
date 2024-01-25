import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
	title: "Doku | Open Source Observability for LLMs",
	description:
		"Doku: Open-source observability tool for Large Language Models (LLMs). Easily integrate for unparalleled insights into usage, performance, and overhead. Analyze, optimize, and scale your AI applications with precision.",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
			<body className={inter.className}>{children}</body>
		</html>
	);
}
