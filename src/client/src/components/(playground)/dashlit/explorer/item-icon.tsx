import { DashlitItemType } from "@/types/dashlit";
import { Folder, File } from "lucide-react";

export default function ItemIcon({ type }: { type: DashlitItemType }) {
	return type === "folder" ? (
		<Folder className="h-4 w-4 text-yellow-500" />
	) : (
		<File className="h-4 w-4 text-blue-500" />
	);
}
