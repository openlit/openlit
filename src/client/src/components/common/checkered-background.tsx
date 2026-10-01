import { cn } from "@/lib/utils";

const CHECKER_SIZE = 32;

const checkerSparkle = encodeURIComponent(
	`<svg xmlns="http://www.w3.org/2000/svg" width="${CHECKER_SIZE}" height="${CHECKER_SIZE}"><path d="M16 12.5Q16.5 15.5 19.5 16Q16.5 16.5 16 19.5Q15.5 16.5 12.5 16Q15.5 15.5 16 12.5Z" fill="rgba(168,162,158,0.25)"/></svg>`
);

const checkeredBackgroundStyle = {
	backgroundImage: `url("data:image/svg+xml,${checkerSparkle}"), linear-gradient(to right, rgba(168,162,158,0.11) 1px, transparent 1px), linear-gradient(to bottom, rgba(168,162,158,0.05) 1px, transparent 1px)`,
	backgroundSize: `${CHECKER_SIZE}px ${CHECKER_SIZE}px`,
	backgroundPosition: `-${CHECKER_SIZE / 2 - 0.5}px -${CHECKER_SIZE / 2 - 0.5}px, 0 0, 0 0`,
};

const fadeClassNames = {
	white:
		"bg-[radial-gradient(ellipse_at_center,transparent_55%,white_100%)] dark:bg-[radial-gradient(ellipse_at_center,transparent_55%,rgb(12,10,9)_100%)]",
	stone:
		"bg-[radial-gradient(ellipse_at_center,transparent_55%,rgb(250,250,249)_100%)] dark:bg-[radial-gradient(ellipse_at_center,transparent_55%,rgb(12,10,9)_100%)]",
};

export default function CheckeredBackground({
	fade = "white",
}: {
	fade?: keyof typeof fadeClassNames;
}) {
	return (
		<>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0"
				style={checkeredBackgroundStyle}
			/>
			<div
				aria-hidden
				className={cn("pointer-events-none absolute inset-0", fadeClassNames[fade])}
			/>
		</>
	);
}
