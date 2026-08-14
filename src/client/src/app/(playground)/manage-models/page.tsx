"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ManageModelsRedirectPage() {
	const router = useRouter();

	useEffect(() => {
		router.replace("/costs?tab=models");
	}, [router]);

	return null;
}
