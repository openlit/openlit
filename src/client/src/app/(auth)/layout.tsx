"use client";
import Image from "next/image";

export default function AuthLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<div className="w-full lg:grid lg:grid-cols-2 h-screen">
			<div className="flex items-center justify-center py-12">{children}</div>
			<div className="flex flex-col items-center justify-center w-full h-full bg-stone-900">
				<Image
					src="/images/logo.png"
					alt="Image"
					width="200"
					height="200"
					className="object-cover"
				/>
				<p className="text-stone-100 text-6xl">OpenLIT</p>
			</div>
		</div>
	);
}
