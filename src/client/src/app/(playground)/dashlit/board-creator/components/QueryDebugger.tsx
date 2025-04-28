"use client";

import React from "react";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, CheckCircle2, Terminal } from "lucide-react";

interface QueryDebuggerProps {
	data?: any;
	error?: string;
	isLoading?: boolean;
}

const QueryDebugger: React.FC<QueryDebuggerProps> = ({
	data,
	error,
	isLoading,
}) => {
	return (
		<div className="border-t bg-muted/50">
			<Accordion type="single" collapsible className="w-full">
				<AccordionItem value="debug" className="border-0">
					<AccordionTrigger className="flex gap-2 px-4 py-2 hover:no-underline hover:bg-muted/80">
						{error ? (
							<AlertCircle className="h-4 w-4 text-destructive" />
						) : data ? (
							<CheckCircle2 className="h-4 w-4 text-success" />
						) : (
							<Terminal className="h-4 w-4 text-muted-foreground" />
						)}
						<span className="text-sm font-medium">Query Debug Console</span>
						{isLoading && (
							<span className="text-xs text-muted-foreground ml-2 animate-pulse">
								Running...
							</span>
						)}
					</AccordionTrigger>
					<AccordionContent>
						<ScrollArea className="h-[200px] w-full border-t bg-background p-4">
							{isLoading ? (
								<div className="flex items-center justify-center h-full">
									<span className="text-sm text-muted-foreground">
										Running query...
									</span>
								</div>
							) : error ? (
								<Alert variant="destructive">
									<AlertDescription>{error}</AlertDescription>
								</Alert>
							) : data ? (
								<pre className="text-sm whitespace-pre-wrap">
									{JSON.stringify(data, null, 2)}
								</pre>
							) : (
								<div className="flex items-center justify-center h-full">
									<span className="text-sm text-muted-foreground">
										No query results to display
									</span>
								</div>
							)}
						</ScrollArea>
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		</div>
	);
};

export default QueryDebugger;
