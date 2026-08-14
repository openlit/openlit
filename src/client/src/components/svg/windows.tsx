export default function WindowsSvg({ className = "" }: { className?: string }) {
	return (
		<svg
			role="img"
			viewBox="0 0 48 48"
			xmlns="http://www.w3.org/2000/svg"
			height="24"
			width="24"
			className={`${className} external-icon-svg`}
		>
			<path
				d="M20 25.026L5.011 25 5.012 37.744 20 39.818zM22 25.03L22 40.095 42.995 43 43 25.066zM20 8.256L5 10.38 5.014 23 20 23zM22 7.973L22 23 42.995 23 42.995 5z"
				fill="currentColor"
			/>
		</svg>
	);
}
