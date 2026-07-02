type SvgProps = {
	className?: string;
	title?: string;
};

export function JavascriptSvg({ className, title = "JavaScript" }: SvgProps) {
	return (
		<svg
			role="img"
			aria-label={title}
			viewBox="0 0 32 32"
			xmlns="http://www.w3.org/2000/svg"
			className={className}
		>
			<rect width="32" height="32" fill="#F7DF1E" />
			<path
				fill="#000"
				d="M8.44 26.78l2.45-1.48c.47.83.9 1.53 1.94 1.53 1 0 1.63-.39 1.63-1.91V14.6h3.01v10.36c0 3.12-1.83 4.54-4.5 4.54-2.41 0-3.81-1.25-4.53-2.72zm10.66-.32l2.45-1.42c.65 1.06 1.49 1.84 2.98 1.84 1.25 0 2.05-.62 2.05-1.49 0-1.04-.82-1.4-2.2-2l-.76-.32c-2.18-.93-3.63-2.09-3.63-4.55 0-2.26 1.72-3.98 4.41-3.98 1.91 0 3.29.67 4.28 2.41l-2.34 1.5c-.52-.93-1.08-1.29-1.94-1.29-.88 0-1.44.56-1.44 1.29 0 .91.56 1.28 1.86 1.84l.76.32c2.57 1.1 4.02 2.21 4.02 4.72 0 2.71-2.13 4.19-4.98 4.19-2.79 0-4.59-1.33-5.48-3.06z"
			/>
		</svg>
	);
}

export function PythonSvg({ className, title = "Python" }: SvgProps) {
	return (
		<svg
			role="img"
			aria-label={title}
			viewBox="0 0 64 64"
			xmlns="http://www.w3.org/2000/svg"
			className={className}
		>
			<path
				fill="#3776AB"
				d="M31.8 4.1c-14.3 0-13.4 6.2-13.4 6.2l.02 6.4h13.6v1.9H13c0 0-9.1-1-9.1 13.3 0 14.2 7.9 13.7 7.9 13.7h4.7v-6.6s-.25-7.9 7.8-7.9h13.5s7.6.12 7.6-7.4V11.5S46.5 4.1 31.8 4.1zm-7.5 4.3a2.4 2.4 0 110 4.8 2.4 2.4 0 010-4.8z"
			/>
			<path
				fill="#FFD43B"
				d="M32.2 59.9c14.3 0 13.4-6.2 13.4-6.2l-.02-6.4H32v-1.9h19c0 0 9.1 1 9.1-13.3 0-14.2-7.9-13.7-7.9-13.7h-4.7v6.6s.25 7.9-7.8 7.9H26.2s-7.6-.12-7.6 7.4v12.2s-1.1 7.4 13.6 7.4zm7.5-4.3a2.4 2.4 0 110-4.8 2.4 2.4 0 010 4.8z"
			/>
		</svg>
	);
}

export function RuntimeIcon({
	runtime,
	className,
}: {
	runtime: string;
	className?: string;
}) {
	const normalized = runtime.toLowerCase();
	if (
		normalized === "nodejs" ||
		normalized === "node" ||
		normalized === "javascript" ||
		normalized === "typescript"
	) {
		return <JavascriptSvg className={className} title="JavaScript/TypeScript" />;
	}
	if (normalized === "python") {
		return <PythonSvg className={className} />;
	}
	return null;
}
