import { fireEvent, render, screen } from "@testing-library/react";
import DataTable from "@/components/data-table/table";
import type { Columns } from "@/components/data-table/columns";

type Row = { id: string; name: string };

const columns: Columns<string, Row> = {
	name: { header: () => "Name", cell: ({ row }) => row.name },
};
const visibility = { name: true };
const rows: Row[] = [{ id: "a", name: "Alpha" }];

describe("DataTable", () => {
	it("does not show the empty state before the first fetch completes", () => {
		render(
			<DataTable
				columns={columns}
				data={[]}
				isFetched={false}
				isLoading={false}
				visibilityColumns={visibility}
				emptyState={<p>Nothing here</p>}
			/>
		);
		expect(screen.queryByText("Nothing here")).not.toBeInTheDocument();
	});

	it("shows the empty state once a fetch returns no rows", () => {
		render(
			<DataTable
				columns={columns}
				data={[]}
				isFetched
				isLoading={false}
				visibilityColumns={visibility}
				emptyState={<p>Nothing here</p>}
			/>
		);
		expect(screen.getByText("Nothing here")).toBeInTheDocument();
	});

	it("makes clickable rows keyboard operable", () => {
		const onClick = jest.fn();
		render(
			<DataTable
				columns={columns}
				data={rows}
				isFetched
				isLoading={false}
				visibilityColumns={visibility}
				onClick={onClick}
			/>
		);
		const row = screen.getByRole("button");
		expect(row).toHaveAttribute("tabindex", "0");
		fireEvent.keyDown(row, { key: "Enter" });
		fireEvent.keyDown(row, { key: " " });
		expect(onClick).toHaveBeenCalledTimes(2);
		expect(onClick).toHaveBeenCalledWith(rows[0]);
	});

	it("ignores key presses from controls inside a row", () => {
		const onClick = jest.fn();
		const withButton: Columns<string, Row> = {
			name: {
				header: () => "Name",
				cell: ({ row }) => <button type="button">{row.name}</button>,
			},
		};
		render(
			<DataTable
				columns={withButton}
				data={rows}
				isFetched
				isLoading={false}
				visibilityColumns={visibility}
				onClick={onClick}
			/>
		);
		fireEvent.keyDown(screen.getByText("Alpha"), { key: "Enter" });
		expect(onClick).not.toHaveBeenCalled();
	});

	it("leaves rows without onClick non-interactive", () => {
		render(
			<DataTable
				columns={columns}
				data={rows}
				isFetched
				isLoading={false}
				visibilityColumns={visibility}
			/>
		);
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("reports expanded state and renders expanded content", () => {
		render(
			<DataTable
				columns={columns}
				data={rows}
				isFetched
				isLoading={false}
				visibilityColumns={visibility}
				onClick={jest.fn()}
				renderExpandedRow={() => <p>Details</p>}
			/>
		);
		expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByText("Details")).toBeInTheDocument();
	});
});
