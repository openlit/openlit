"use client";

import type { ReactNode } from "react";

export type FeatureAccessKey = string;

type FeatureAccessProps = {
	access: FeatureAccessKey;
	children: ReactNode;
	requireProject?: boolean;
	hideWhenDenied?: boolean;
};

export default function FeatureAccess({ children }: FeatureAccessProps) {
	return <>{children}</>;
}
