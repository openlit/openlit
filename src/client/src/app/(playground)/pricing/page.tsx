"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PricingRedirectPage() {
	const router = useRouter();

	useEffect(() => {
		router.replace("/costs?tab=configuration");
	}, [router]);

	return null;
}
