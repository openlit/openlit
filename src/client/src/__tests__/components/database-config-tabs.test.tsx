import { fireEvent, render, screen } from "@testing-library/react";
import DatabaseConfigTabs from "@/components/(playground)/database-config/database-config-tabs";
import { TooltipProvider } from "@/components/ui/tooltip";

describe("DatabaseConfigTabs", () => {
	it("renders localized actions and database config items", () => {
		const onClickTab = jest.fn();
		const onClickItemChangeActive = jest.fn();

		render(
			<TooltipProvider>
				<DatabaseConfigTabs
					addButton
					items={[
						{
							id: "db-1",
							name: "Default DB",
							badge: "production",
							isCurrent: true,
						},
					]}
					onClickItemChangeActive={onClickItemChangeActive}
					onClickTab={onClickTab}
					selectedTabId="db-1"
				/>
			</TooltipProvider>
		);

		expect(screen.getByText("Add New Config")).toBeInTheDocument();
		expect(screen.getByText("Default DB")).toBeInTheDocument();
		expect(screen.getByText("production")).toBeInTheDocument();
		expect(screen.getByRole("checkbox")).toBeChecked();

		fireEvent.click(screen.getByText("Add New Config"));
		expect(onClickTab).toHaveBeenCalledTimes(1);
	});
});
