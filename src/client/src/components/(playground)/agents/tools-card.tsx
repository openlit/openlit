"use client";

import dynamic from "next/dynamic";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import getMessage from "@/constants/messages";
import type { AgentTool } from "@/types/agents";

const JSONViewer = dynamic(() => import("@/components/common/json-viewer"), {
	ssr: false,
	loading: () => (
		<div className="text-[10px] text-stone-400 dark:text-stone-500">…</div>
	),
});

interface ToolsCardProps {
	tools: AgentTool[];
}

function hasSchema(schema: unknown): schema is Record<string, unknown> {
	if (!schema || typeof schema !== "object") return false;
	return Object.keys(schema as Record<string, unknown>).length > 0;
}

export default function ToolsCard({ tools }: ToolsCardProps) {
	return (
		<div className="border dark:border-stone-800 rounded-lg">
			<div className="flex items-center justify-between px-4 py-3 border-b dark:border-stone-800">
				<h3 className="text-sm font-medium text-stone-900 dark:text-stone-100">
					{getMessage().AGENTS_DEFINITION_TOOLS}{" "}
					<span className="text-xs text-stone-500 dark:text-stone-400 font-normal">
						({tools.length})
					</span>
				</h3>
			</div>
			<div className="px-2 py-2">
				{tools.length === 0 ? (
					<div className="px-3 py-3 text-sm text-stone-500 dark:text-stone-400">
						{getMessage().AGENTS_DEFINITION_NO_TOOLS}
					</div>
				) : (
					<Accordion type="multiple" className="w-full">
						{tools.map((tool, idx) => (
							<AccordionItem
								key={`${tool.name}-${idx}`}
								value={`${tool.name}-${idx}`}
								className="px-2"
							>
								<AccordionTrigger className="text-left py-3">
									<div className="flex items-center gap-2 min-w-0 flex-1">
										<span className="font-mono text-sm text-stone-900 dark:text-stone-100 truncate">
											{tool.name}
										</span>
										{tool.description && (
											<span className="text-xs text-stone-500 dark:text-stone-400 truncate">
												{tool.description}
											</span>
										)}
									</div>
								</AccordionTrigger>
								<AccordionContent>
									<div className="space-y-3 px-2 pb-3">
										{tool.description && (
											<p className="text-xs text-stone-600 dark:text-stone-300 whitespace-pre-wrap">
												{tool.description}
											</p>
										)}
										<div>
											<div className="text-[10px] font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wide mb-1">
												{getMessage().AGENTS_DEFINITION_SCHEMA}
											</div>
											{hasSchema(tool.schema) ? (
												<div className="rounded-md bg-stone-100 dark:bg-stone-900 p-3 text-xs overflow-x-auto">
													<JSONViewer value={tool.schema} />
												</div>
											) : (
												<div className="rounded-md border border-dashed border-stone-200 dark:border-stone-800 p-3 text-xs text-stone-500 dark:text-stone-400">
													{getMessage().AGENTS_DEFINITION_SCHEMA_NOT_CAPTURED}
												</div>
											)}
										</div>
									</div>
								</AccordionContent>
							</AccordionItem>
						))}
					</Accordion>
				)}
			</div>
		</div>
	);
}
