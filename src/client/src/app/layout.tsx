import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import { COLORS } from "../../colors";
import {
	ArrowPathIcon,
	CheckCircleIcon,
	ExclamationCircleIcon,
} from "@heroicons/react/24/outline";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
	title: "Doku | Open Source Observability for LLMs",
	description:
		"Open-source tool for tracking and analyzing usage patterns of Large Language Models (LLMs).",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
			<body className={inter.className}>
				{children}
				<Toaster
					position="bottom-right"
					reverseOrder={false}
					gutter={8}
					toastOptions={{
						duration: 3000,
						style: {
							fontSize: "14px",
							fontWeight: "normal",
							borderRadius: "4px 4px 0px 0px",
						},
						error: {
							icon: <ExclamationCircleIcon className="w-4 h-4 shrink-0" />,
							style: {
								background: COLORS.error,
								color: COLORS.secondary,
							},
						},
						success: {
							icon: <CheckCircleIcon className="w-4 h-4 shrink-0" />,
							style: {
								background: COLORS.primary,
								color: COLORS.secondary,
							},
						},
						loading: {
							icon: <ArrowPathIcon className="w-4 h-4 shrink-0" />,
							style: {
								background: COLORS.secondary,
								color: COLORS.primary,
							},
						},
					}}
				/>
			</body>
		</html>
	);
}
