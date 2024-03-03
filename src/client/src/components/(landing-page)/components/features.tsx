import {
	ClockIcon,
	LightBulbIcon,
	LinkIcon,
	PresentationChartBarIcon,
} from "@heroicons/react/24/outline";

const features = [
	{
		name: "Granular Usage Insights",
		description:
			"Assess your LLM's performance, costs, filter by environment, application etc.",
		icon: LightBulbIcon,
	},
	{
		name: "Real-Time Data Streaming",
		description:
			"Streams data to visualize your data and enables quick decision-making and adjustments.",
		icon: PresentationChartBarIcon,
	},
	{
		name: "Zero Added Latency",
		description:
			"Ensures rapid data processing without impacting your application's performance.",
		icon: ClockIcon,
	},
	{
		name: "Observability Platforms",
		description:
			"Seamlessly exports data to observability platforms like Grafana Cloud, Datadog etc.",
		icon: LinkIcon,
	},
];

function FeatureList(props: any) {
	return (
		<ul
			className="flex items-center justify-center md:justify-start [&_li]:mx-8 [&_img]:max-w-none animate-infinite-scroll"
			{...props}
		>
			{features.map((feature) => (
				<li
					key={feature.name}
					className="w-80 h-full p-6 border border-tertiary/[0.05] rounded-lg shadow text-center"
				>
					<div className="flex items-center justify-center">
						<feature.icon
							className="h-5 w-5 mr-2 text-primary"
							aria-hidden="true"
						/>
						<h5 className="text-xl font-semibold tracking-tight text-primary">
							{feature.name}
						</h5>
					</div>
					<p className="mt-3 font-normal text-tertiary">
						{feature.description}
					</p>
				</li>
			))}
		</ul>
	);
}

export default function Features() {
	return (
		<div className="relative py-8" id="features">
			<div className="mx-auto px-6 lg:px-8">
				<div className=" max-w-7xl mx-auto max-w-2xl text-center">
					<p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
						Everything you need to know
					</p>
					<p className="mt-3 text-lg leading-8 text-gray-600">
						Get advanced monitoring and evaluation for your LLM applications
						with these key benefits:
					</p>
				</div>
				<div className="w-full inline-flex flex-nowrap mt-8 overflow-hidden py-3 [mask-image:_linear-gradient(to_right,transparent_0,_black_128px,_black_calc(100%-128px),transparent_100%)]">
					<FeatureList />
					<FeatureList aria-hidden="true" />
				</div>
			</div>
			<div
				className="absolute inset-x-0 top-[calc(100%-13rem)] -z-10 transform-gpu overflow-hidden blur-3xl sm:top-[calc(100%-30rem)]"
				aria-hidden="true"
			>
				<div
					className="relative left-[calc(50%+3rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 bg-gradient-to-tr from-[#ff80b5] to-[#9089fc] opacity-30 sm:left-[calc(50%+36rem)] sm:w-[72.1875rem]"
					style={{
						clipPath:
							"polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)",
					}}
				/>
			</div>
		</div>
	);
}
