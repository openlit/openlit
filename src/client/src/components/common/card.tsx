import { ReactNode } from "react";

type CardProps = {
	children?: ReactNode;
	containerClass?: string;
	heading: string;
	isLoading?: boolean;
	text?: string;
	textClass?: string;
};

export default function Card({
	children = null,
	containerClass = "",
	heading,
	isLoading,
	text,
	textClass = "",
}: CardProps) {
	return (
		<div
			className={`border border-secondary relative text-left text-tertiary p-6 ${containerClass}`}
		>
			<p className="text-sm mb-4">{heading}</p>
			{!!isLoading ? (
				<div className="animate-pulse h-9 w-12 bg-secondary/[0.9] rounded-full" />
			) : (
				text && <p className={`font-semibold text-3xl ${textClass}`}>{text}</p>
			)}
			{children}
		</div>
	);
}
