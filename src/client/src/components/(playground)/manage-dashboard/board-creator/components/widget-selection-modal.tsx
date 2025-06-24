import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
	DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Widget } from "../types";

export default function WidgetSelectionModal({
	open,
	onClose,
	widgets,
	onSelect,
	onCreateNew,
}: {
	open: boolean;
	onClose: () => void;
	widgets: Widget[];
	onSelect: (widget: Widget) => void;
	onCreateNew: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={(v) => !v && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Select a Widget</DialogTitle>
					<DialogDescription>
						Choose an existing widget to add, or create a new one.
					</DialogDescription>
				</DialogHeader>
				<div className="max-h-64 overflow-y-auto my-4">
					{widgets.length === 0 ? (
						<div className="text-center text-stone-500">No widgets found.</div>
					) : (
						<ul className="space-y-2">
							{widgets.map((w) => (
								<li key={w.id}>
									<Button
										variant="outline"
										className="w-full justify-start"
										onClick={() => onSelect(w)}
									>
										<span className="font-semibold mr-2">{w.title}</span>
										<span className="text-xs text-stone-500">({w.type})</span>
									</Button>
								</li>
							))}
						</ul>
					)}
				</div>
				<DialogFooter>
					<Button onClick={onCreateNew} variant="default">
						+ Create New Widget
					</Button>
					<DialogClose asChild>
						<Button variant="ghost">Cancel</Button>
					</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
