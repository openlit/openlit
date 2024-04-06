import { Fragment, ReactNode } from "react";
import { Menu, Transition } from "@headlessui/react";

export default function Dropdown({
	triggerComponent,
	itemList,
}: {
	triggerComponent: ReactNode;
	itemList: { label: string; onClick?: any; href?: string; id?: string }[];
}) {
	return (
		<Menu as="div" className="relative flex text-left">
			<Menu.Button className="inline-flex w-full justify-center">
				{triggerComponent}
			</Menu.Button>

			<Transition
				as={Fragment}
				enter="transition ease-out duration-100"
				enterFrom="transform opacity-0 scale-95"
				enterTo="transform opacity-100 scale-100"
				leave="transition ease-in duration-75"
				leaveFrom="transform opacity-100 scale-100"
				leaveTo="transform opacity-0 scale-95"
			>
				<Menu.Items className="absolute right-0 top-full z-30 rounded-sm mt-3 bg-white shadow ring-1 ring-tertiary ring-opacity-5 focus:outline-none text-center cursor-pointer min-w-full">
					{itemList.map(({ label, onClick, href, id }, index) => (
						<Menu.Item key={`item-${index}`}>
							{({ active }) => (
								<a
									className={`block px-5 py-2 text-sm text-tertiary/[0.7] hover:bg-secondary text-ellipsis overflow-hidden ${
										active ? "bg-secondary/[0.6]" : ""
									}`}
									href={href}
									data-id={id}
									onClick={onClick}
								>
									{label}
								</a>
							)}
						</Menu.Item>
					))}
				</Menu.Items>
			</Transition>
		</Menu>
	);
}
