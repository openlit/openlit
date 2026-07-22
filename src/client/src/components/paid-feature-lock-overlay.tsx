import { ReactNode } from "react";

type PaidFeatureLockOverlayProps = {
	children: ReactNode;
	isLocked: boolean;
	featureName: string;
	planLabel: string;
	title: string;
	message: string;
	primaryActionLabel?: string;
	onPrimaryAction?: () => void;
	className?: string;
};

export default function PaidFeatureLockOverlay({
	children,
}: PaidFeatureLockOverlayProps) {
	return <>{children}</>;
}
