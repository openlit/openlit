"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function EvaluationSettingsPage() {
	const router = useRouter();

	useEffect(() => {
		router.replace("/evaluations?tab=configuration");
	}, [router]);

	return null;
}
