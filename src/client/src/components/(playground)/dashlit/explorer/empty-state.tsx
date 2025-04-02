import getMessage from "@/constants/messages";

export default function EmptyState() {
	return (
		<div className="text-center py-8 text-muted-foreground">
			{getMessage().DASHLIT_EXPLORER_EMPTY_STATE}
		</div>
	);
}
