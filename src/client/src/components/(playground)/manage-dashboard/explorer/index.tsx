import { Droppable } from "react-beautiful-dnd";
import { Button } from "@/components/ui/button";
import { DashboardItemType } from "@/types/manage-dashboard";
import { DashboardHeirarchy } from "@/types/manage-dashboard";
import { DropResult } from "react-beautiful-dnd";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState, useRef } from "react";
import { DragDropContext } from "react-beautiful-dnd";
import { toast } from "sonner";
import EmptyState from "./empty-state";
import ExplorerItemRow from "./item-row";
import AddEditDialog from "./add-edit-dialog";

export default function DashboardExplorer() {
	const [items, setItems] = useState<DashboardHeirarchy[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [dialogState, setDialogState] = useState({
		isOpen: false,
		mode: "add" as "add" | "edit",
		itemTitle: "",
		itemDescription: "",
		itemType: "board" as DashboardItemType,
		currentPath: [] as string[],
		editingItemId: null as string | null,
	});

	const { fireRequest: fetchHierarchy } = useFetchWrapper();
	const { fireRequest: createFolderRequest } = useFetchWrapper();
	const { fireRequest: createBoardRequest } = useFetchWrapper();
	const { fireRequest: updateFolderRequest } = useFetchWrapper();
	const { fireRequest: updateBoardRequest } = useFetchWrapper();
	const { fireRequest: deleteFolderRequest } = useFetchWrapper();
	const { fireRequest: deleteBoardRequest } = useFetchWrapper();
	const { fireRequest: setMainDashboardRequest } = useFetchWrapper();
	const { fireRequest: importBoardLayoutRequest } = useFetchWrapper();

	const fileInputRef = useRef<HTMLInputElement | null>(null);

	// Fetch hierarchy data on component mount
	useEffect(() => {
		loadHierarchy();
	}, []);

	// Load hierarchy data from API
	const loadHierarchy = useCallback(() => {
		setIsLoading(true);
		fetchHierarchy({
			url: "/api/manage-dashboard/folder/get-heirarchy",
			requestType: "GET",
			successCb: (response) => {
				if (response?.data) {
					setItems(response.data);
				}
				setIsLoading(false);
			},
			failureCb: (error) => {
				toast.error("Failed to load dashboard hierarchy");
				console.error("Error loading hierarchy:", error);
				setIsLoading(false);
			},
		});
	}, [fetchHierarchy]);

	// Add a new item
	const addItem = useCallback(
		(
			title: string,
			description: string,
			type: DashboardItemType,
			parentPath: string[] = []
		) => {
			// Determine parent ID from path
			const parentId =
				parentPath.length > 0 ? parentPath[parentPath.length - 1] : null;

			// Create payload
			const payload = {
				title,
				description,
				parentId,
			};

			// Toast loading state
			toast.loading(`Creating ${type}...`, { id: "manage-dashboard-explorer" });

			if (type === "folder") {
				createFolderRequest({
					url: "/api/manage-dashboard/folder",
					requestType: "POST",
					body: JSON.stringify(payload),
					successCb: (response) => {
						toast.success("Folder created successfully", {
							id: "manage-dashboard-explorer",
						});
						loadHierarchy(); // Reload hierarchy after successful creation
					},
					failureCb: (error) => {
						toast.error(
							`Failed to create folder: ${error || "Unknown error"}`,
							{ id: "manage-dashboard-explorer" }
						);
					},
				});
			} else {
				createBoardRequest({
					url: "/api/manage-dashboard/board",
					requestType: "POST",
					body: JSON.stringify(payload),
					successCb: (response) => {
						toast.success("Board created successfully", {
							id: "manage-dashboard-explorer",
						});
						loadHierarchy(); // Reload hierarchy after successful creation
					},
					failureCb: (error) => {
						toast.error(`Failed to create board: ${error || "Unknown error"}`, {
							id: "manage-dashboard-explorer",
						});
					},
				});
			}

			// Close dialog
			setDialogState((prev) => ({
				...prev,
				isOpen: false,
			}));
		},
		[createFolderRequest, createBoardRequest, loadHierarchy]
	);

	// Edit an item
	const editItem = useCallback(
		(
			itemId: string,
			newTitle: string,
			newDescription: string,
			parentPath: string[] = []
		) => {
			// Find the item to determine its type
			const findItem = (
				items: DashboardHeirarchy[],
				id: string
			): DashboardHeirarchy | null => {
				for (const item of items) {
					if (item.id === id) return item;
					if (item.children) {
						const found = findItem(item.children, id);
						if (found) return found;
					}
				}
				return null;
			};

			const item = findItem(items, itemId);
			if (!item) {
				toast.error("Item not found", { id: "manage-dashboard-explorer" });
				return;
			}

			// Toast loading state
			toast.loading(`Updating ${item.type}...`, {
				id: "manage-dashboard-explorer",
			});

			// Create payload
			const payload = {
				id: itemId,
				title: newTitle,
				description: newDescription,
				parentId:
					parentPath.length > 0 ? parentPath[parentPath.length - 1] : null,
			};

			if (item.type === "folder") {
				updateFolderRequest({
					url: "/api/manage-dashboard/folder",
					requestType: "PUT",
					body: JSON.stringify(payload),
					successCb: (response) => {
						toast.success("Folder updated successfully", {
							id: "manage-dashboard-explorer",
						});
						loadHierarchy(); // Reload hierarchy after successful update
					},
					failureCb: (error) => {
						toast.error(
							`Failed to update folder: ${error || "Unknown error"}`,
							{ id: "manage-dashboard-explorer" }
						);
					},
				});
			} else {
				updateBoardRequest({
					url: "/api/manage-dashboard/board",
					requestType: "PUT",
					body: JSON.stringify(payload),
					successCb: (response) => {
						toast.success("Board updated successfully", {
							id: "manage-dashboard-explorer",
						});
						loadHierarchy(); // Reload hierarchy after successful update
					},
					failureCb: (error) => {
						toast.error(`Failed to update board: ${error || "Unknown error"}`, {
							id: "manage-dashboard-explorer",
						});
					},
				});
			}

			// Close dialog
			setDialogState((prev) => ({
				...prev,
				isOpen: false,
				editingItemId: null,
			}));
		},
		[items, updateFolderRequest, updateBoardRequest, loadHierarchy]
	);

	// Delete an item
	const deleteItem = useCallback(
		(itemId: string) => {
			// Find the item to determine its type
			const findItem = (
				items: DashboardHeirarchy[],
				id: string
			): DashboardHeirarchy | null => {
				for (const item of items) {
					if (item.id === id) return item;
					if (item.children) {
						const found = findItem(item.children, id);
						if (found) return found;
					}
				}
				return null;
			};

			const item = findItem(items, itemId);
			if (!item) {
				toast.error("Item not found", { id: "manage-dashboard-explorer" });
				return;
			}

			// Confirm deletion
			if (
				!window.confirm(
					`Are you sure you want to delete this ${item.type}? This action cannot be undone.`
				)
			) {
				return;
			}

			// Toast loading state
			toast.loading(`Deleting ${item.type}...`, {
				id: "manage-dashboard-explorer",
			});

			if (item.type === "folder") {
				deleteFolderRequest({
					url: `/api/manage-dashboard/folder/${itemId}`,
					requestType: "DELETE",
					successCb: (response) => {
						toast.success("Folder deleted successfully", {
							id: "manage-dashboard-explorer",
						});
						loadHierarchy(); // Reload hierarchy after successful deletion
					},
					failureCb: (error) => {
						toast.error(
							`Failed to delete folder: ${error || "Unknown error"}`,
							{ id: "manage-dashboard-explorer" }
						);
					},
				});
			} else {
				deleteBoardRequest({
					url: `/api/manage-dashboard/board/${itemId}`,
					requestType: "DELETE",
					successCb: (response) => {
						toast.success("Board deleted successfully", {
							id: "manage-dashboard-explorer",
						});
						loadHierarchy(); // Reload hierarchy after successful deletion
					},
					failureCb: (error) => {
						toast.error(`Failed to delete board: ${error || "Unknown error"}`, {
							id: "manage-dashboard-explorer",
						});
					},
				});
			}
		},
		[items, deleteFolderRequest, deleteBoardRequest, loadHierarchy]
	);

	const handleSetMainDashboard = useCallback(
		(boardId: string) => {
			setMainDashboardRequest({
				requestType: "PATCH",
				url: `/api/manage-dashboard/board/${boardId}`,
				body: JSON.stringify({ setMain: true }),
				successCb: () => {
					loadHierarchy();
				},
				failureCb: (error) => {
					console.error("Failed to set as main dashboard:", error);
				},
			});
		},
		[loadHierarchy, setMainDashboardRequest]
	);

	const exportBoardLayout = useCallback((id: string) => {
		window.location.href = `/api/manage-dashboard/board/${id}/layout/export`;
	}, []);

	const importBoardLayout = useCallback((data: any) => {
		return importBoardLayoutRequest({
			requestType: "POST",
			url: `/api/manage-dashboard/board/layout/import`,
			body: JSON.stringify(data),
			successCb: () => {
				loadHierarchy();
			},
			failureCb: (error) => {
				console.error("Failed to import board layout:", error);
			},
		});
	}, [importBoardLayoutRequest, loadHierarchy]);

	// Open dialog for adding a new item
	const openAddDialog = useCallback((path: string[] = []) => {
		setDialogState({
			isOpen: true,
			mode: "add",
			itemTitle: "",
			itemDescription: "",
			itemType: "board",
			currentPath: path,
			editingItemId: null,
		});
	}, []);

	// Open dialog for editing an item
	const openEditDialog = useCallback(
		(item: DashboardHeirarchy, path: string[] = []) => {
			setDialogState({
				isOpen: true,
				mode: "edit",
				itemTitle: item.title,
				itemDescription: item.description,
				itemType: item.type,
				currentPath: path,
				editingItemId: item.id,
			});
		},
		[]
	);

	// Navigate to a board
	const navigateToBoard = useCallback((boardId: string) => {
		window.location.href = `/manage-dashboard/board/${boardId}`;
	}, []);

	// Handle dialog save
	const handleDialogSave = useCallback(
		(title: string, description: string, type: DashboardItemType) => {
			const { mode, currentPath, editingItemId } = dialogState;

			if (mode === "add") {
				addItem(title, description, type, currentPath);
			} else if (editingItemId) {
				editItem(editingItemId, title, description, currentPath);
			}
		},
		[addItem, dialogState, editItem]
	);

	// Handle dialog cancel
	const handleDialogCancel = useCallback(() => {
		setDialogState((prev) => ({
			...prev,
			isOpen: false,
		}));
	}, []);

	// Handle drag end
	const handleDragEnd = useCallback(
		(result: DropResult) => {
			const { source, destination, draggableId } = result;

			// Dropped outside the list
			if (!destination) return;

			// Dropped in the same position
			if (
				source.droppableId === destination.droppableId &&
				source.index === destination.index
			) {
				return;
			}

			// Update UI immediately for better UX
			setItems((prevItems) => {
				const clonedItems = JSON.parse(JSON.stringify(prevItems));

				// Helper function to find an item and its parent array by ID
				const findItemAndParent = (
					items: DashboardHeirarchy[],
					itemId: string,
					path: string[] = []
				): {
					item: DashboardHeirarchy | null;
					parent: DashboardHeirarchy[] | null;
					itemPath: string[];
				} => {
					for (let i = 0; i < items.length; i++) {
						if (items[i].id === itemId) {
							return { item: items[i], parent: items, itemPath: path };
						}

						if (items[i].type === "folder" && items[i].children) {
							const result = findItemAndParent(
								items[i].children || [],
								itemId,
								[...path, items[i].id]
							);
							if (result.item) {
								return result;
							}
						}
					}

					return { item: null, parent: null, itemPath: [] };
				};

				// Helper function to find a parent folder by droppable ID
				const findParentByDroppableId = (
					items: DashboardHeirarchy[],
					droppableId: string
				): { parent: DashboardHeirarchy[] | null; parentId: string | null } => {
					if (droppableId === "root") {
						return { parent: clonedItems, parentId: null };
					}

					// Extract folder ID from droppable ID (format: "folder-id")
					const folderId = droppableId.replace("folder-", "");

					const { item } = findItemAndParent(items, folderId);
					return {
						parent: item && item.children ? item.children : null,
						parentId: folderId,
					};
				};

				// Find the item being dragged and its parent array
				const { item: draggedItem, parent: sourceParent } = findItemAndParent(
					clonedItems,
					draggableId
				);

				if (!draggedItem || !sourceParent) return clonedItems;

				// Remove the item from its source
				sourceParent.splice(sourceParent.indexOf(draggedItem), 1);

				// Find the destination parent array
				const { parent: destinationParent, parentId: newParentId } =
					findParentByDroppableId(clonedItems, destination.droppableId);

				if (!destinationParent) return clonedItems;

				// Update the parentId of the dragged item
				draggedItem.parentId = newParentId;

				// Insert the item at the destination
				destinationParent.splice(destination.index, 0, draggedItem);

				return clonedItems;
			});

			// Send update to backend
			const getNewParentId = (droppableId: string) => {
				if (droppableId === "root") return null;
				return droppableId.replace("folder-", "");
			};

			// Find the item to determine its type
			const findItem = (
				items: DashboardHeirarchy[],
				id: string
			): DashboardHeirarchy | null => {
				for (const item of items) {
					if (item.id === id) return item;
					if (item.children) {
						const found = findItem(item.children, id);
						if (found) return found;
					}
				}
				return null;
			};

			const item = findItem(items, draggableId);
			if (!item) return;

			const newParentId = getNewParentId(destination.droppableId);

			// Create payload
			const payload = {
				id: draggableId,
				title: item.title,
				description: item.description,
				parentId: newParentId,
			};

			// Toast loading state
			toast.loading(`Updating ${item.type}...`, {
				id: "manage-dashboard-explorer",
			});

			if (item.type === "folder") {
				updateFolderRequest({
					url: "/api/manage-dashboard/folder",
					requestType: "PUT",
					body: JSON.stringify(payload),
					successCb: (response) => {
						toast.success("Folder moved successfully", {
							id: "manage-dashboard-explorer",
						});
						loadHierarchy(); // Reload hierarchy to ensure consistency
					},
					failureCb: (error) => {
						toast.error(`Failed to move folder: ${error || "Unknown error"}`, {
							id: "manage-dashboard-explorer",
						});
						loadHierarchy(); // Reload hierarchy to reset UI
					},
				});
			} else {
				updateBoardRequest({
					url: "/api/manage-dashboard/board",
					requestType: "PUT",
					body: JSON.stringify(payload),
					successCb: (response) => {
						toast.success("Board moved successfully", {
							id: "manage-dashboard-explorer",
						});
						loadHierarchy(); // Reload hierarchy to ensure consistency
					},
					failureCb: (error) => {
						toast.error(`Failed to move board: ${error || "Unknown error"}`, {
							id: "manage-dashboard-explorer",
						});
						loadHierarchy(); // Reload hierarchy to reset UI
					},
				});
			}
		},
		[items, updateFolderRequest, updateBoardRequest, loadHierarchy]
	);

	// const handleImportClick = () => {
	// 	if (fileInputRef.current) {
	// 		fileInputRef.current.value = "";
	// 		fileInputRef.current.click();
	// 	}
	// };

	// const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
	// 	const file = e.target.files?.[0];
	// 	if (!file) return;
	// 	try {
	// 		const text = await file.text();
	// 		const json = JSON.parse(text);
	// 		// Expecting json to have an id or boardId
	// 		const boardId = json.id || json.boardId;
	// 		if (!boardId) {
	// 			toast.error("Invalid layout file: missing board id");
	// 			return;
	// 		}
	// 		const res = await fetch(`/api/manage-dashboard/board/${boardId}/layout`, {
	// 			method: "PUT",
	// 			headers: { "Content-Type": "application/json" },
	// 			body: JSON.stringify(json),
	// 		});
	// 		if (res.ok) {
	// 			toast.success("Board layout imported successfully");
	// 			loadHierarchy();
	// 		} else {
	// 			toast.error("Failed to import board layout");
	// 		}
	// 	} catch (err) {
	// 		toast.error("Invalid layout file");
	// 	}
	// };

	return (
		<div className="flex flex-col gap-2 grow overflow-y-hidden">
			<div className="flex justify-between items-center text-stone-700 dark:text-stone-300">
				<h3 className="font-medium">Explorer</h3>
				<Button variant="outline" onClick={() => openAddDialog()}>
					<Plus className="h-4 w-4 mr-2" />
					Add
				</Button>
			</div>

			<div className="grow bg-stone-100 dark:bg-stone-900 rounded-sm p-2 overflow-y-auto">
				{isLoading ? (
					<div className="flex justify-center items-center py-8 h-full">
						<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
					</div>
				) : items.length === 0 ? (
					<EmptyState />
				) : (
					<DragDropContext onDragEnd={handleDragEnd}>
						<Droppable droppableId="root" type="explorer-item">
							{(provided, snapshot) => (
								<div
									ref={provided.innerRef}
									{...provided.droppableProps}
									className={`${snapshot.isDraggingOver
											? "bg-stone-200 dark:bg-stone-800 border-2 border-dashed border-stone-300 dark:border-stone-600 rounded-md"
											: ""
										}`}
								>
									{items.map((item, index) => (
										<ExplorerItemRow
											key={item.id}
											item={item}
											path={[]}
											index={index}
											onNavigate={navigateToBoard}
											onAddClick={openAddDialog}
											onEditClick={openEditDialog}
											onDeleteClick={deleteItem}
											exportBoardLayout={exportBoardLayout}
											setMainDashboard={handleSetMainDashboard}
											importBoardLayout={importBoardLayout}
										/>
									))}
									{provided.placeholder}
								</div>
							)}
						</Droppable>
					</DragDropContext>
				)}
			</div>

			<AddEditDialog
				isOpen={dialogState.isOpen}
				onOpenChange={(open) =>
					setDialogState((prev) => ({ ...prev, isOpen: open }))
				}
				mode={dialogState.mode}
				initialItemTitle={dialogState.itemTitle}
				initialItemDescription={dialogState.itemDescription}
				initialItemType={dialogState.itemType}
				onSave={handleDialogSave}
				onCancel={handleDialogCancel}
			/>
		</div>
	);
}
