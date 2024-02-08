import { ArrowRightIcon } from "@heroicons/react/24/solid";
import Image from "next/image";

export default function Home() {
	return (
		<>
			<section className="w-full px-8 text-gray-700 bg-white">
				<div className="container flex w-full items-center justify-between py-5">
					<a
						href="/"
						className="flex items-center font-medium text-gray-900 lg:w-auto lg:items-center lg:justify-center md:mb-0 shrink-0"
					>
						<span className="mx-auto text-xl font-black leading-none text-gray-900 select-none">
							Dokulabs
						</span>
					</a>

					<div className="flex grow items-center ml-5 space-x-6 justify-end">
						<a
							href="https://github.com/dokulabs/doku"
							className="text-base font-medium leading-6 text-gray-600 whitespace-no-wrap transition duration-150 ease-in-out hover:text-gray-900"
						>
							<Image
								alt="github"
								src="/github-mark.svg"
								width={30}
								height={30}
							/>
						</a>
					</div>
				</div>
			</section>

			<section className="px-2 py-32 bg-white md:px-0">
				<div className="container items-center max-w-6xl px-8 mx-auto xl:px-5">
					<div className="flex flex-wrap items-center sm:-mx-3">
						<div className="w-full md:w-1/2 md:px-3">
							<div className="w-full pb-6 space-y-6 sm:max-w-md lg:max-w-lg md:space-y-4 lg:space-y-8 xl:space-y-9 sm:pr-5 lg:pr-0 md:pb-0">
								<h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl md:text-4xl lg:text-5xl xl:text-6xl">
									<span className="block xl:inline">Doku - </span>
									<span className="block text-orange-600 xl:inline">
										LLM Observability
									</span>
								</h1>
								<p className="mx-auto text-base text-gray-500 sm:max-w-md lg:text-xl md:max-w-3xl">
									An open source tool designed to collect and understand the
									usage of Large Language Models (LLMs).
								</p>
								<div className="relative flex flex-col sm:flex-row sm:space-x-4">
									<a
										href="https://docs.dokulabs.com/0.0.1/introduction"
										className="flex items-center w-full px-6 py-3 mb-3 text-lg text-white bg-orange-600 rounded-md sm:mb-0 hover:bg-orange-700 sm:w-auto"
									>
										Docs
										<ArrowRightIcon className="w-4" />
									</a>
								</div>
							</div>
						</div>
						<div className="w-full md:w-1/2">
							<div className="w-full h-auto overflow-hidden rounded-md shadow-xl sm:rounded-xl">
								<img src="/banner.gif" />
							</div>
						</div>
					</div>
				</div>
			</section>
		</>
	);
}
