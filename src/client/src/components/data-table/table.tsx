import IntermediateState from "@/components/(playground)/intermediate-state";
import { ReactNode } from "react";
import { fill } from "lodash";
import { objectEntries } from "@/utils/object";
import { Columns } from "./columns";
import { noop } from "@/utils/noop";

const RowWrapper = ({
	children,
	className = "",
	onClick,
}: {
	children: ReactNode;
	className?: string;
	onClick?: (item: any) => void;
}) => (
	<div className={`flex w-full ${className}`} onClick={onClick}>
		{children}
	</div>
);

const ColumnRowItem = ({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) => {
	return (
		<div
			className={` flex-shrink-0 border-b dark:border-stone-800 py-2 px-3 overflow-hidden ${className}`}
		>
			{children}
		</div>
	);
};

const RenderLoader = ({ columns }: { columns: string[] }) =>
	fill(new Array(5), 1).map((_, index) => (
		<RowWrapper key={`loader-row-${index}`} className="animate-pulse">
			{columns.map((_, index) => (
				<ColumnRowItem
					key={`loader-column-${index}`}
					className="group-last-of-type:border-b-0 cursor-pointer py-4"
				>
					<div className="h-2 w-2/3 bg-stone-200 rounded" />
				</ColumnRowItem>
			))}
		</RowWrapper>
	));

export default function Table({
	columns,
	data,
	isFetched,
	isLoading,
	visibilityColumns,
	onClick,
}: {
	columns: Columns<any, any>;
	data: any[];
	isFetched: boolean;
	isLoading: boolean;
	visibilityColumns: Record<string, boolean>;
	onClick?: (item: any) => void;
}) {
	const visibleColumns = objectEntries(visibilityColumns)
		.filter(([, value]) => value)
		.map(([keys]) => keys);
	const noData = !data?.length && !isLoading;

	const width = `basis-1/${visibleColumns.length}`;

	const onClickHandler = (rowItem: any) =>
		typeof onClick === "function" ? onClick(rowItem) : noop();
	return (
		<div className="flex flex-col w-full overflow-auto border dark:border-stone-800 rounded-md">
			<RowWrapper className="sticky top-0">
				{visibleColumns.map((column) => (
					<ColumnRowItem
						key={column}
						className={`group-last-of-type:border-b-0 bg-stone-100 text-stone-500 dark:bg-stone-900 dark:text-stone-500 text-sm ${width}`}
					>
						{columns[column]?.header()}
					</ColumnRowItem>
				))}
			</RowWrapper>
			<div
				className={`flex flex-col w-full ${
					isFetched && isLoading ? "animate-pulse" : ""
				}`}
			>
				{(!isFetched || (isLoading && !data?.length)) && (
					<RenderLoader columns={visibleColumns} />
				)}
				{data?.map((rowItem) => {
					return (
						<RowWrapper
							key={rowItem.id}
							className="group text-sm text-stone-700 dark:text-stone-300"
							onClick={() => onClickHandler(rowItem)}
						>
							{visibleColumns.map((column) => (
								<ColumnRowItem
									className={`group-last-of-type:border-b-0 group-hover:bg-stone-100  dark:group-hover:bg-stone-800 cursor-pointer ${width}`}
								>
									{columns[column]?.cell({
										row: rowItem,
									})}
								</ColumnRowItem>
							))}
						</RowWrapper>
					);
				})}
				{noData && <IntermediateState type="nodata" />}
			</div>
		</div>
	);
}
