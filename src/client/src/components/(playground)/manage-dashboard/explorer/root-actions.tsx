import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Plus, Upload } from "lucide-react";
import { useState } from "react";
import ImportLayoutModal from "./import-layout-modal";

export default function RootActions({
	openAddDialog,
	importBoardLayout,
}: {
	openAddDialog: () => void;
	importBoardLayout?: (data: unknown) => Promise<unknown>;
}) {
	const [isImportModalOpen, setIsImportModalOpen] = useState(false);
	const canImport = Boolean(importBoardLayout);

	return (
		<>
			<div className="inline-flex shrink-0 items-stretch">
				<Button
					type="button"
					size="sm"
					onClick={() => openAddDialog()}
					aria-label="Create new dashboard"
					className="h-8 rounded-r-none bg-primary px-2 text-white hover:bg-primary/90 hover:text-white dark:bg-primary dark:text-white dark:hover:bg-primary/90 dark:hover:text-white"
				>
					<Plus className="size-4" />
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							size="sm"
							aria-label="More dashboard actions"
							className="h-8 rounded-l-none border-l border-white/20 bg-primary px-2 text-white hover:bg-primary/90 hover:text-white dark:bg-primary dark:text-white dark:hover:bg-primary/90 dark:hover:text-white"
						>
							<ChevronDown className="size-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={() => openAddDialog()}>
							<Plus className="mr-2 size-4" />
							Create new dashboard
						</DropdownMenuItem>
						{canImport ? (
							<DropdownMenuItem onClick={() => setIsImportModalOpen(true)}>
								<Upload className="mr-2 size-4" />
								Import layout
							</DropdownMenuItem>
						) : null}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			{canImport ? (
				<ImportLayoutModal
					open={isImportModalOpen}
					onClose={() => setIsImportModalOpen(false)}
					onImport={
						importBoardLayout as unknown as (
							data: unknown
						) => Promise<{ err: string; data: string }>
					}
				/>
			) : null}
		</>
	);
}
