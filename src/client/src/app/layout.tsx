import type { Metadata } from "next";
import { cookies } from "next/headers";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import Providers from "@/components/common/providers";

const inter = localFont({
	src: "../../public/fonts/Inter.ttf",
	variable: "--font-inter",
	weight: "100 900",
	display: "swap",
});

export const metadata: Metadata = {
	title: "OpenLIT | Open source Agent Harness Engineering",
	description:
		"Open-source Agent Harness Engineering platform for LLM tracing, evaluations, prompt management, and cost tracking.",
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
			{/* bg-[linear-gradient(360deg,rgba(243,108,6,0.7)_0%,white_25%)] dark:bg-[linear-gradient(360deg,rgba(243,108,6,0.8)_0%,black_25%)] */}
			<body className={`${inter.className} bg-stone-50 dark:bg-stone-950`}>
				<Providers>
					{children}
					<Toaster position="bottom-right" />
				</Providers>
			</body>
		</html>
	);
}
