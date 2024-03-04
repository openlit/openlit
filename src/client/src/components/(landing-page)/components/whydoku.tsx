import Image from "next/image";

export default function WhyDoku() {
	return (
		<div
			className="relative isolate px-6 py-8 sm:px-16 md:py-24 lg:flex lg:gap-x-20 lg:px-24 lg:py-16"
			id="whydoku"
		>
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
