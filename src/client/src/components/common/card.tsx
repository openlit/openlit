import { ReactNode } from "react";

type CardProps = {
	children?: ReactNode;
	containerClass?: string;
	heading: string;
	text?: string;
};

export default function Card({
	children = null,
	containerClass = "",
	heading,
	text,
}: CardProps) {
	return (
		<div className={`border relative text-left p-6 ${containerClass}`}>
			<p className="text-sm mb-4">{heading}</p>
			{text && <p className="font-semibold text-3xl">{text}</p>}
			{children}
		</div>
	);
}
