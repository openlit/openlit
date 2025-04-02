import {
	Board,
	DashlitHeirarchy,
	Folder,
	FolderHeirarchy,
} from "@/types/dashlit";
import { getBoards } from "./board";
import { getFolders } from "./folder";

export async function getHeirarchy() {
	return { data: [
    {
      id: "1",
      title: "Analytics",
      type: "folder",
      children: [
        { id: "2", title: "Sales Dashboard", type: "board" },
        { id: "3", title: "User Metrics", type: "board" },
      ],
    },
    {
      id: "4",
      title: "Marketing",
      type: "folder",
      children: [{ id: "5", title: "Campaign Results", type: "board" }],
    },
    { id: "6", title: "Quick Overview", type: "board" },
  ] as DashlitHeirarchy[]}
	const { data: boards = [], err: errBoards } = await getBoards();
	const { data: folders = [], err: errFolders } = await getFolders();

	if (errBoards || errFolders) return { err: errBoards || errFolders };

	return { data: buildHierarchy(boards as Board[], folders as Folder[]) };
}

function buildHierarchy(
	boards: Board[],
	folders: Folder[]
): DashlitHeirarchy[] {
	const folderMap = new Map<string, FolderHeirarchy>();
	const rootNodes: DashlitHeirarchy[] = [];

	// Initialize folders in map with empty children and boards
	folders.forEach((folder) => {
		folderMap.set(folder.id, { ...folder, children: [], boards: [] });
	});

	// Assign boards to their respective folders (or root level)
	boards.forEach((board) => {
		if (board.parentId && folderMap.has(board.parentId)) {
			folderMap.get(board.parentId)!.boards.push(board);
		} else {
			// Root-level boards (not inside any folder)
			rootNodes.push({ ...board, boards: [], children: [] });
		}
	});

	// Attach child folders to their respective parent folders
	folders.forEach((folder) => {
		if (folder.parentId && folderMap.has(folder.parentId)) {
			folderMap.get(folder.parentId)!.children.push(folderMap.get(folder.id)!);
		} else {
			// Root-level folders (not inside any other folder)
			rootNodes.push(folderMap.get(folder.id)!);
		}
	});

	return rootNodes;
}
