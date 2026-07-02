"use client";
import type React from "react";

export default function SettingsLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<div className="flex h-full w-full grow overflow-hidden">
			{children}
		</div>
	);
}
