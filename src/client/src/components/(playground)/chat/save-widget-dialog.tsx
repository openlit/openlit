"use client";

import { useState, useEffect } from "react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import getMessage from "@/constants/messages";

interface SaveWidgetDialogProps {
	open: boolean;
	onClose: () => void;
	query: string;
	suggestedType: string;
	data: any[];
}

const WIDGET_TYPES = [
	{ value: "STAT_CARD", label: "Stat Card" },
	{ value: "BAR_CHART", label: "Bar Chart" },
	{ value: "LINE_CHART", label: "Line Chart" },
	{ value: "PIE_CHART", label: "Pie Chart" },
	{ value: "AREA_CHART", label: "Area Chart" },
	{ value: "TABLE", label: "Table" },
];

export default function SaveWidgetDialog({
	open,
	onClose,
	query,
	suggestedType,
	data,
}: SaveWidgetDialogProps) {
	const m = getMessage();
	const [title, setTitle] = useState("");
	const [widgetType, setWidgetType] = useState(suggestedType);
	const [boards, setBoards] = useState<any[]>([]);
	const [selectedBoard, setSelectedBoard] = useState<string>("");
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (open) {
			fetch("/api/manage-dashboard/board?home=false")
				.then((res) => res.json())
				.then((res) => {
					if (res.data) setBoards(res.data);
				})
				.catch(() => {});
		}
	}, [open]);

	const handleSave = async () => {
		if (!title.trim()) {
			toast.error(m.CHAT_WIDGET_ENTER_TITLE);
			return;
		}

		setSaving(true);
		try {
			const columns = data.length > 0 ? Object.keys(data[0]) : [];
			const numericCol = columns.find((col) => {
				const val = data[0]?.[col];
				return typeof val === "number" || (!isNaN(Number(val)) && val !== "");
			});
			const labelCol = columns.find((col) => col !== numericCol);

			const properties: Record<string, any> = {
				color: "#F36C06",
			};

			if (widgetType === "STAT_CARD" && numericCol) {
				properties.value = `0.${numericCol}`;
			} else if (
				["BAR_CHART", "LINE_CHART", "AREA_CHART"].includes(widgetType)
			) {
				if (labelCol) properties.xAxis = labelCol;
				if (numericCol) properties.yAxis = numericCol;
			} else if (widgetType === "PIE_CHART") {
				if (labelCol) properties.labelPath = labelCol;
				if (numericCol) properties.valuePath = numericCol;
			}

			const res = await fetch("/api/chat/message/save-widget", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: title.trim(),
					description: "",
					type: widgetType,
					query,
					properties,
					boardId: selectedBoard && selectedBoard !== "none" ? selectedBoard : undefined,
				}),
			});

			const result = await res.json();

			if (!res.ok || result.err) {
				throw new Error(result.err || m.CHAT_WIDGET_SAVE_FAILED);
			}

			toast.success(m.CHAT_WIDGET_SAVED);
			onClose();
		} catch (e: any) {
			toast.error(e.message || m.CHAT_WIDGET_SAVE_FAILED);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{m.CHAT_SAVE_WIDGET_TITLE}</DialogTitle>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<label className="text-sm font-medium text-stone-700 dark:text-stone-300">
							{m.CHAT_WIDGET_TITLE_LABEL}
						</label>
						<Input
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder={m.CHAT_WIDGET_TITLE_PLACEHOLDER}
							className="bg-white dark:bg-stone-900"
						/>
					</div>

					<div className="space-y-2">
						<label className="text-sm font-medium text-stone-700 dark:text-stone-300">
							{m.CHAT_WIDGET_TYPE_LABEL}
						</label>
						<Select value={widgetType} onValueChange={setWidgetType}>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{WIDGET_TYPES.map((wt) => (
									<SelectItem key={wt.value} value={wt.value}>
										{wt.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<label className="text-sm font-medium text-stone-700 dark:text-stone-300">
							{m.CHAT_WIDGET_DASHBOARD_LABEL}
						</label>
						<Select value={selectedBoard} onValueChange={setSelectedBoard}>
							<SelectTrigger>
								<SelectValue placeholder={m.CHAT_WIDGET_DASHBOARD_PLACEHOLDER} />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="none">-</SelectItem>
								{boards.map((board: any) => (
									<SelectItem key={board.id} value={board.id}>
										{board.title}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						{m.CANCEL}
					</Button>
					<Button onClick={handleSave} disabled={saving}>
						{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
						{m.CHAT_SAVE_AS_WIDGET}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
