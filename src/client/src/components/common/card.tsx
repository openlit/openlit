import { ReactNode, forwardRef } from "react";

export type CardProps = {
	children?: ReactNode;
	containerClass?: string;
	heading?: string;
	isLoading?: boolean;
	loadingClass?: string;
	text?: string;
	textClass?: string;
};

export default forwardRef(function Card(
	{
		children = null,
		containerClass = "",
		heading,
		isLoading,
		loadingClass = "h-9 w-12",
		text,
		textClass = "",
	}: CardProps,
	ref: any
) {
	return (
		<div
			className={`border border-secondary relative text-left text-tertiary p-6 text-sm ${containerClass}`}
			ref={ref}
		>
			{heading && <h3 className="mb-2 font-medium">{heading}</h3>}
			{!!isLoading ? (
				<div
					className={`animate-pulse bg-secondary/[0.9] rounded-full ${loadingClass}`}
				/>
			) : (
				text && (
					<p
						className={`font-semibold ${
							textClass.match(/text-(xs|sm|base|lg|xl|[2-9]xl)/)
								? ""
								: "text-3xl"
						} ${textClass}`}
					>
						{text}
					</p>
				)
			)}
			{children}
		</div>
	);
});
