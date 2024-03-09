import Image from "next/image";

export default function Navbar() {
	return (
		<div className="bg-secondary sticky top-0 z-10">
			<div className="mx-auto max-w-7xl px-2 sm:px-6 lg:px-8">
				<div className="flex h-16 items-center justify-between">
					<Image
						alt="doku"
						className="w-24"
						src="/images/doku-logo-with-name.png"
						width={836}
						height={298}
					/>
					<div className="flex h-16 items-center justify-between space-x-4">
						<a
							href={"/dashboard"}
							className={`flex items-center rounded-md px-3 py-2 text-sm font-medium bg-primary/[0.1] text-primary text-center`}
						>
							<span className="block">Go to dashboard</span>
						</a>
						<a
							href={"https://github.com/dokulabs/doku"}
							className={`flex items-center rounded-md px-3 py-2 text-sm font-medium bg-tertiary text-white`}
						>
							<Image
								alt="github"
								className="invert"
								src="/images/github-mark.svg"
								width={20}
								height={20}
							/>
							<span className="hidden sm:ml-3 sm:block">Github</span>
						</a>
					</div>
				</div>
			</div>
		</div>
	);
}
