import Image from "next/image";

export default function WhyDoku() {
	return (
		<div className="relative isolate overflow-hidden px-6 py-8 sm:px-16 md:py-24 lg:flex lg:gap-x-20 lg:px-24 lg:py-16" id="features">
			<div className="mx-auto max-w-md text-center lg:mx-0 lg:py-32 lg:text-left shrink-0 mb-6">
				<h2 className="text-3xl font-bold tracking-tight text-tertiary sm:text-4xl">
					Boost your productivity.
				</h2>
				<h2 className="mt-3 text-3xl font-bold tracking-tight text-tertiary sm:text-4xl">
					Start using <span className="text-primary font-bold">Doku</span>{" "}
					today.
				</h2>
				<p className="mt-6 text-lg leading-8 text-tertiary">
					Real-time data on LLM usage, performance, and costs. Seamless
					integrations with OpenAI, Cohere, and Anthropic
				</p>
			</div>
			<div className="relative self-center p-4 bg-tertiary/[0.1]">
				<Image alt="doku" src="/images/banner.gif" width={1200} height={600} />
			</div>
		</div>
	);
}
