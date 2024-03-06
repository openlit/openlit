type LegendProps = {
	categories: string[];
	className?: string;
	colors?: string[];
	itemClassName?: string;
};

const DEFAULT_COLOR = "";

const Legend = ({
	categories,
	className = "",
	colors = [],
	itemClassName = "",
}: LegendProps) => {
	return (
		<ol className={`relative overflow-hidden mt-3 flex flex-wrap ${className}`}>
			{categories.map((category, index) => (
				<li
					key={`category-${index}`}
					className={`flex items-center px-2 py-0.5 transition whitespace-nowrap cursor-default text-xs ${
						colors[index] || DEFAULT_COLOR
					} ${itemClassName}`}
				>
					<svg
						className={`flex-none h-2 w-2 mr-1.5 ${
							colors[index] || DEFAULT_COLOR
						} opacity-100`}
						fill="currentColor"
						viewBox="0 0 8 8"
					>
						<circle cx="4" cy="4" r="4"></circle>
					</svg>
					<p className="whitespace-nowrap truncate opacity-100">{category}</p>
				</li>
			))}
		</ol>
	);
};

export default Legend;
