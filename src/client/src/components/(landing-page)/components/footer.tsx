import Image from "next/image";

export default function Footer() {
	return (
		<footer className="mt-12">
			<div className="mx-auto w-full max-w-screen-xl p-4 py-6 lg:py-8">
				<div className="md:flex md:justify-between">
					<div className="flex mb-6 md:mb-0 justify-center md:justify-start">
						<a href="https://flowbite.com/" className="flex items-center">
							<Image
								alt="doku"
								className="w-40"
								src="/images/doku-logo-with-name.png"
								width={836}
								height={298}
							/>
						</a>
					</div>
					<div className="flex flex-1 justify-center md:justify-end space-x-20">
						<div>
							<h2 className="mb-6 text-sm font-semibold text-tertiary dark:text-white">
								Resources
							</h2>
							<ul className="text-sm">
								<li className="mb-3">
									<a
										href="https://docs.dokulabs.com/"
										className="hover:text-primary text-tertiary"
									>
										Docs
									</a>
								</li>
								<li>
									<a
										href="https://github.com/dokulabs/doku"
										className="hover:text-primary text-tertiary"
									>
										Github
									</a>
								</li>
							</ul>
						</div>
						<div>
							<h2 className="mb-6 text-sm font-semibold text-tertiary dark:text-white">
								Follow us
							</h2>
							<ul className="text-sm">
								<li className="mb-3">
									<a
										href="https://join.slack.com/t/doku-0tq5728/shared_invite/zt-2a9aql9xx-FN5EIZ2DtZ~XtJoYdxUDtA"
										className="hover:text-primary text-tertiary"
									>
										Slack
									</a>
								</li>
								<li>
									<a
										href="https://twitter.com/doku_labs"
										className="hover:text-primary text-tertiary"
									>
										X
									</a>
								</li>
							</ul>
						</div>
					</div>
				</div>
				<hr className="my-6 border-primary/[0.2] sm:mx-auto lg:my-8" />
				<div className="sm:flex sm:items-center sm:justify-between text-center md:text-left">
					<span className="text-sm text-tertiary/[0.6] sm:text-center">
						© 2023{" "}
						<a href="https://docs.dokulabs.com/" className="hover:underline">
							Dokulabs™
						</a>
						. All Rights Reserved.
					</span>
					<div className="flex mt-4 sm:justify-center sm:mt-0 justify-center md:justify-end">
						<a
							href="https://twitter.com/doku_labs"
							className="text-tertiary hover:text-tertiary dark:hover:text-white ms-5"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								x="0px"
								y="0px"
								width="100"
								height="100"
								viewBox="0 0 50 50"
								className="w-4 h-4"
							>
								<path d="M 5.9199219 6 L 20.582031 27.375 L 6.2304688 44 L 9.4101562 44 L 21.986328 29.421875 L 31.986328 44 L 44 44 L 28.681641 21.669922 L 42.199219 6 L 39.029297 6 L 27.275391 19.617188 L 17.933594 6 L 5.9199219 6 z M 9.7167969 8 L 16.880859 8 L 40.203125 42 L 33.039062 42 L 9.7167969 8 z"></path>
							</svg>
							<span className="sr-only">Twitter page</span>
						</a>
						<a
							href="https://github.com/dokulabs"
							className="text-tertiary hover:text-tertiary dark:hover:text-white ms-5"
						>
							<svg
								className="w-4 h-4"
								aria-hidden="true"
								xmlns="http://www.w3.org/2000/svg"
								fill="currentColor"
								viewBox="0 0 20 20"
							>
								<path
									fillRule="evenodd"
									d="M10 .333A9.911 9.911 0 0 0 6.866 19.65c.5.092.678-.215.678-.477 0-.237-.01-1.017-.014-1.845-2.757.6-3.338-1.169-3.338-1.169a2.627 2.627 0 0 0-1.1-1.451c-.9-.615.07-.6.07-.6a2.084 2.084 0 0 1 1.518 1.021 2.11 2.11 0 0 0 2.884.823c.044-.503.268-.973.63-1.325-2.2-.25-4.516-1.1-4.516-4.9A3.832 3.832 0 0 1 4.7 7.068a3.56 3.56 0 0 1 .095-2.623s.832-.266 2.726 1.016a9.409 9.409 0 0 1 4.962 0c1.89-1.282 2.717-1.016 2.717-1.016.366.83.402 1.768.1 2.623a3.827 3.827 0 0 1 1.02 2.659c0 3.807-2.319 4.644-4.525 4.889a2.366 2.366 0 0 1 .673 1.834c0 1.326-.012 2.394-.012 2.72 0 .263.18.572.681.475A9.911 9.911 0 0 0 10 .333Z"
									clipRule="evenodd"
								/>
							</svg>
							<span className="sr-only">GitHub account</span>
						</a>
					</div>
				</div>
			</div>
		</footer>
	);
}
