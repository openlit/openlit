"use client";
import { Disclosure } from "@headlessui/react";
import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";
import Image from "next/image";

const navigation = [
	{ name: "Why doku ?", href: "#whydoku", current: false },
	{ name: "Features", href: "#features", current: false },
];

export default function Navbar() {
	return (
		<Disclosure
			as="nav"
			className="bg-secondary border-b border-secondary z-10 sticky top-0"
		>
			{({ open }) => (
				<>
					<div className="mx-auto max-w-7xl px-2 sm:px-6 lg:px-8">
						<div className="relative flex h-16 items-center justify-between">
							<div className="absolute inset-y-0 left-0 flex items-center sm:hidden">
								{/* Mobile menu button*/}
								<Disclosure.Button className="relative inline-flex items-center justify-center rounded-md p-2 text-gray-400 hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white">
									<span className="absolute -inset-0.5" />
									<span className="sr-only">Open main menu</span>
									{open ? (
										<XMarkIcon className="block h-6 w-6" aria-hidden="true" />
									) : (
										<Bars3Icon className="block h-6 w-6" aria-hidden="true" />
									)}
								</Disclosure.Button>
							</div>
							<div className="flex flex-1 items-center justify-center sm:items-stretch sm:justify-start">
								<div className="flex flex-shrink-0 items-center">
									<Image
										className="flex-shrink-0 w-10 h-10 transition duration-75"
										src="https://avatars.githubusercontent.com/u/149867240?s=48&v=4"
										alt="Doku's Logo"
										priority
										width={24}
										height={24}
									/>
								</div>
								<div className="flex items-center justify-center flex-1 hidden sm:ml-6 sm:block">
									<div className="flex items-center justify-center space-x-4">
										{navigation.map((item) => (
											<a
												key={item.name}
												href={item.href}
												className={`flex items-center rounded-full px-6 py-2 text-sm font-medium bg-tertiary/[0.7] hover:bg-tertiary text-white`}
												aria-current={item.current ? "page" : undefined}
											>
												{item.name}
											</a>
										))}
									</div>
								</div>
							</div>
							<div className="absolute inset-y-0 right-0 flex items-center pr-2 sm:static sm:inset-auto sm:ml-6 sm:pr-0">
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

					<Disclosure.Panel className="sm:hidden">
						<div className="space-y-1 px-2 pb-3 pt-2">
							{navigation.map((item) => (
								<Disclosure.Button
									key={item.name}
									as="a"
									href={item.href}
									className={`block rounded-md px-3 py-2 text-base font-medium ${
										item.current
											? "bg-gray-900 text-white"
											: "text-gray-300 hover:bg-gray-700 hover:text-white"
									}`}
									aria-current={item.current ? "page" : undefined}
								>
									{item.name}
								</Disclosure.Button>
							))}
						</div>
					</Disclosure.Panel>
				</>
			)}
		</Disclosure>
	);
}
