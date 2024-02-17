import {
	ChevronDownIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
} from "@heroicons/react/24/outline";
import { MouseEventHandler, useEffect, useRef, useState } from "react";

type PaginationProps = {
	currentPage: number;
	currentSize: number;
	totalPage: number;
	onClickPageAction: (dir: -1 | 1) => void;
	onClickPageLimit: (size: number) => void;
};

const PageSizes = [10, 25, 50];

export default function Pagination(props: PaginationProps) {
	const dropdownRef = useRef<HTMLDivElement>(null);
	const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
	const onClickAction: MouseEventHandler = (ev) => {
		const { action } = (ev.currentTarget as HTMLButtonElement).dataset;
		if (action === "previous") {
			props.onClickPageAction(-1);
		} else {
			props.onClickPageAction(1);
		}
	};

	const onSizeChange: MouseEventHandler = (ev) => {
		const { size = "10" } = (ev.currentTarget as HTMLButtonElement).dataset;
		props.onClickPageLimit(parseInt(size, 10));
		setIsMenuOpen(false);
	};

	const handleClickOutside = (event: MouseEvent) => {
		if (
			dropdownRef.current &&
			!dropdownRef.current.contains(event.target as Node)
		) {
			setIsMenuOpen(false);
		}
	};

	useEffect(() => {
		document.addEventListener("click", handleClickOutside);

		return () => {
			document.removeEventListener("click", handleClickOutside);
		};
	}, []);

	const firstPage = props.currentPage === 1;
	const lastPage = props.currentPage === props.totalPage;

	return (
		<div className="flex items-center">
			<p className="text-xs shrink-0 opacity-50 mr-3">Size : </p>
			<div className="relative flex items-center mr-5" ref={dropdownRef}>
				<button
					type="button"
					className="inline-flex justify-center gap-x-1.5 rounded-md bg-white px-3 py-2 text-xs ring-1 ring-inset ring-tertiary/[.2]"
					onClick={() => setIsMenuOpen((e) => !e)}
				>
					{props.currentSize}
					<ChevronDownIcon className="w-4" />
				</button>
				<div
					className={`absolute right-0 z-10 mt-2 top-full rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none w-full text-center ${
						isMenuOpen ? "flex flex-col" : "hidden"
					}`}
				>
					{PageSizes.map((size: number) => (
						<button
							key={`size-${size}`}
							className={`text-tertiary/[0.7] block px-4 py-2 text-sm hover:bg-secondary/[0.6] ${
								props.currentSize === size ? "bg-secondary/[0.6]" : ""
							}`}
							data-size={size}
							onClick={onSizeChange}
						>
							{size}
						</button>
					))}
				</div>
			</div>
			<div className="flex items-center mr-5 text-sm text-tertiary/[0.5]">
				{props.currentPage} of {props.totalPage}
			</div>
			<div className="flex rounded-md shadow-sm" aria-label="Pagination">
				<button
					className="relative inline-flex items-center rounded-l-md px-2 py-2 text-tertiary ring-1 ring-inset ring-tertiary/[.15] hover:bg-secondary focus:z-20 focus:outline-offset-0 disabled:opacity-40 disabled:cursor-not-allowed"
					data-action="previous"
					disabled={firstPage}
					onClick={onClickAction}
				>
					<ChevronLeftIcon className="w-4" />
				</button>
				<button
					className="relative inline-flex items-center rounded-r-md px-2 py-2 text-tertiary ring-1 ring-inset ring-tertiary/[.15] hover:bg-secondary focus:z-20 focus:outline-offset-0 disabled:opacity-40 disabled:cursor-not-allowed"
					data-action="next"
					disabled={lastPage}
					onClick={onClickAction}
				>
					<ChevronRightIcon className="w-4" />
				</button>
			</div>
		</div>
	);
}
