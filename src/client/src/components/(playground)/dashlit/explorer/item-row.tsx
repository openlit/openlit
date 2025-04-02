import { DashlitHeirarchy } from "@/types/dashlit";
import { GripVertical } from "lucide-react";
import { useCallback } from "react";
import { Draggable, Droppable } from "react-beautiful-dnd";
import ItemIcon from "./item-icon";
import ItemActions from "./item-actions";

export default function ExplorerItemRow({
	item,
	path,
	index,
	onNavigate,
	onAddClick,
	onEditClick,
	onDeleteClick,
}: {
	item: DashlitHeirarchy;
	path: string[];
	index: number;
	onNavigate: (id: string) => void;
	onAddClick: (path: string[]) => void;
	onEditClick: (item: DashlitHeirarchy, path: string[]) => void;
	onDeleteClick: (id: string, path: string[]) => void;
}) {
	const handleItemClick = useCallback(() => {
		if (item.type === "board") {
			onNavigate(item.id);
		}
	}, [item.id, item.type, onNavigate]);

	return (
		<Draggable draggableId={item.id} index={index}>
			{(provided) => (
				<div
					ref={provided.innerRef}
					{...provided.draggableProps}
					className="my-2"
				>
					<div className="flex items-center justify-between group py-1 px-2 rounded-md hover:bg-accent">
						<div className="flex items-center gap-2 flex-1">
							<div
								{...provided.dragHandleProps}
								className="cursor-grab"
								onClick={(e) => e.stopPropagation()}
							>
								<GripVertical className="h-4 w-4 text-muted-foreground" />
							</div>
							<div
								className="flex items-center gap-2 cursor-pointer flex-1"
								onClick={handleItemClick}
							>
								<ItemIcon type={item.type} />
								<span>{item.title}</span>
							</div>
						</div>

						<ItemActions
							item={item}
							path={path}
							onAddClick={onAddClick}
							onEditClick={onEditClick}
							onDeleteClick={onDeleteClick}
						/>
					</div>

					{item.type === "folder" &&
						item.children &&
						item.children.length > 0 && (
							<Droppable droppableId={`folder-${item.id}`} type="explorer-item">
								{(droppableProvided) => (
									<div
										ref={droppableProvided.innerRef}
										{...droppableProvided.droppableProps}
										className="pl-4"
									>
										{(item.children || []).map((child, childIndex) => (
											<ExplorerItemRow
												key={child.id}
												item={child}
												path={[...path, item.id]}
												index={childIndex}
												onNavigate={onNavigate}
												onAddClick={onAddClick}
												onEditClick={onEditClick}
												onDeleteClick={onDeleteClick}
											/>
										))}
										{droppableProvided.placeholder}
									</div>
								)}
							</Droppable>
						)}
				</div>
			)}
		</Draggable>
	);
}
