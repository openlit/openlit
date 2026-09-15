"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function EvaluationTypesPage() {
	const router = useRouter();

	useEffect(() => {
		router.replace("/evaluations?tab=evaluators");
	}, [router]);

	return null;
}
