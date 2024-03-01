export default function Hero() {
	return (
		<div className="flex flex-col w-full relative isolate px-6 pt-14 lg:px-8">
			<div className="mx-auto w-full py-10 sm:py-32 lg:py-20">
				<div className="text-center">
					<h1 className="flex flex-col font-extrabold tracking-tight">
						<span className="block xl:inline text-primary text-6xl">
							Doku
						</span>
						<span className="block text-tertiary xl:inline text-3xl">
							Observability for LLMs
						</span>
					</h1>
					<p className="mx-auto text-base text-tertiary/[0.8] sm:max-w-md lg:text-xl md:max-w-3xl mt-3">
						An open source tool designed to collect and understand the usage of
						Large Language Models (LLMs).
					</p>
					<div className="mt-10 flex items-center justify-center gap-x-6">
						<a
							href="https://docs.dokulabs.com/"
							className="rounded-md bg-primary/[0.9] px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
						>
							Documentation
						</a>
						<a
							href="https://github.com/dokulabs/doku"
							className="text-sm font-semibold leading-6 text-tertiary hover:text-primary"
						>
							Learn more <span aria-hidden="true">→</span>
						</a>
					</div>
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
