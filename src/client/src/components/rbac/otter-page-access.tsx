"use client";

import type { ReactNode } from "react";

type OtterPageAccessProps = {
	children: ReactNode;
};

export default function OtterPageAccess({ children }: OtterPageAccessProps) {
	return <>{children}</>;
}
