import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
	title: "OpenLIT | Open Source Observability for LLMs",
	description:
		"Open-source tool for tracking and analyzing usage patterns of Large Language Models (LLMs).",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const cookieStore = cookies();
	const theme = cookieStore.get("theme");

	return (
		<html lang="en" className={`scroll-smooth ${theme?.value || ""}`}>
			<body className={`${inter.className} bg-white dark:bg-black`}>
				{children}
				<Toaster position="bottom-right" />
			</body>
		</html>
	);
}
