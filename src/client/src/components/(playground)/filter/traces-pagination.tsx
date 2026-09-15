import { MouseEventHandler } from "react";
import {
	Pagination,
	PaginationContent,
	PaginationItem,
	PaginationNext,
	PaginationPrevious,
} from "@/components/ui/pagination";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

type PaginationProps = {
	currentPage: number;
	currentSize: number;
	totalPage: number;
	onClickPageAction: (dir: -1 | 1) => void;
	onClickPageLimit: (size: number) => void;
};

const PageSizes = [10, 25, 50];

export default function TracesPagination(props: PaginationProps) {
	const onClickAction: MouseEventHandler = (ev) => {
		const { action } = (ev.currentTarget as HTMLButtonElement).dataset;
		if (action === "previous") {
			props.onClickPageAction(-1);
		} else {
			props.onClickPageAction(1);
		}
	};

	const onSizeChange = (size: string) => {
		props.onClickPageLimit(parseInt(size, 10));
	};

	const firstPage = props.currentPage === 1;
	const lastPage =
		props.totalPage === 0 || props.currentPage === props.totalPage;

	return (
		<div className="flex shrink-0 items-center gap-2 self-center">
			<div className="flex items-center gap-1.5">
				<p className="text-xs shrink-0 text-stone-950 dark:text-stone-100">
					Size
				</p>
				<Select
					onValueChange={onSizeChange}
					defaultValue={`${props.currentSize}`}
				>
					<SelectTrigger
						id="page-size"
						aria-label="Page size"
						className="h-[30px] w-[4.5rem] shrink-0 gap-1 px-2 py-1 text-xs text-stone-500 hover:text-stone-600 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-300 [&>span]:line-clamp-none [&>svg]:ml-0 [&>svg]:h-3 [&>svg]:w-3"
					>
						<SelectValue placeholder={`${props.currentSize}`} />
					</SelectTrigger>
					<SelectContent>
						{PageSizes.map((size: number) => (
							<SelectItem
								key={size}
								value={`${size}`}
								className="outline-none"
							>
								{size}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<Pagination className="m-0 w-auto shrink-0">
				<PaginationContent className="gap-0.5">
					<PaginationItem>
						<PaginationPrevious
							className={`h-[30px] px-2 py-1 ${
								firstPage
									? "pointer-events-none cursor-not-allowed text-stone-400"
									: "text-stone-950 dark:text-stone-100"
							}`}
							data-action={"previous"}
							onClick={onClickAction}
							aria-disabled={firstPage}
						/>
					</PaginationItem>
					<PaginationItem>
						<div className="flex items-center whitespace-nowrap px-1 text-xs text-stone-950 dark:text-stone-100">
							{props.currentPage} of {props.totalPage || 1}
						</div>
					</PaginationItem>
					<PaginationItem>
						<PaginationNext
							className={`h-[30px] px-2 py-1 ${
								lastPage
									? "pointer-events-none cursor-not-allowed text-stone-400"
									: "text-stone-950 dark:text-stone-100"
							}`}
							data-action={"next"}
							onClick={onClickAction}
							aria-disabled={lastPage}
						/>
					</PaginationItem>
				</PaginationContent>
			</Pagination>
		</div>
	);
}
