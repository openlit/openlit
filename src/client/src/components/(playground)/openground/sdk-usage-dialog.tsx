"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CodeBlock from "@/components/common/code-block";
import { Copy } from "lucide-react";
import getMessage from "@/constants/messages";
import copy from "copy-to-clipboard";
import { toast } from "sonner";

interface SdkUsageDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	pricingUrl: string;
}

const LANGUAGES = [
	{ value: "python", label: "Python", lang: "python" },
	{ value: "typescript", label: "TypeScript", lang: "typescript" },
	{ value: "go", label: "Go", lang: "go" },
] as const;

function buildSnippets(pricingUrl: string): Record<string, string> {
	return {
		python: `import openlit

openlit.init(
    otlp_endpoint="http://127.0.0.1:4318",
    pricing_json="${pricingUrl}",
)`,
		typescript: `import openlit from "openlit";

openlit.init({
  otlpEndpoint: "http://127.0.0.1:4318",
  pricingJson: "${pricingUrl}",
});`,
		go: `package main

import openlit "github.com/openlit/openlit/sdk/go"

func main() {
    openlit.Init(openlit.Config{
        OtlpEndpoint: "http://127.0.0.1:4318",
        PricingJson:  "${pricingUrl}",
    })
}`,
	};
}

export default function SdkUsageDialog({
	open,
	onOpenChange,
	pricingUrl,
}: SdkUsageDialogProps) {
	const m = getMessage();
	const snippets = buildSnippets(pricingUrl);

	const handleCopyUrl = () => {
		if (!pricingUrl) return;
		copy(pricingUrl);
		toast.success(m.MANAGE_MODELS_PRICING_URL_COPIED, { id: "url-copy" });
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{m.MANAGE_MODELS_SDK_USAGE_DIALOG_TITLE}</DialogTitle>
					<DialogDescription>
						{m.MANAGE_MODELS_SDK_USAGE_DIALOG_DESCRIPTION}
					</DialogDescription>
				</DialogHeader>

				{/* URL block — uses Input (readonly) + Button for visual consistency */}
				<div className="space-y-2">
					<Label className="text-xs text-stone-500 dark:text-stone-400">
						{m.MANAGE_MODELS_PRICING_URL_LABEL}
					</Label>
					<div className="flex items-center gap-2">
						<Input
							readOnly
							value={pricingUrl}
							onFocus={(e) => e.target.select()}
							className="font-mono text-xs"
						/>
						<Button
							variant="outline"
							size="sm"
							className="gap-1.5 shrink-0"
							onClick={handleCopyUrl}
						>
							<Copy className="h-3.5 w-3.5" />
							{m.COPY}
						</Button>
					</div>
				</div>

				{/* Language tabs — CodeBlock has built-in copy + syntax highlighting */}
				<Tabs defaultValue="python" className="w-full">
					<TabsList className="grid grid-cols-3 w-full">
						{LANGUAGES.map((l) => (
							<TabsTrigger key={l.value} value={l.value}>
								{l.label}
							</TabsTrigger>
						))}
					</TabsList>
					{LANGUAGES.map((l) => (
						<TabsContent key={l.value} value={l.value} className="mt-2">
							<CodeBlock
								className="text-xs rounded-lg"
								code={snippets[l.value]}
								language={l.lang}
							/>
						</TabsContent>
					))}
				</Tabs>

				<p className="text-xs text-stone-500 dark:text-stone-400">
					<strong>{m.MANAGE_MODELS_SDK_USAGE_NOTE_LABEL}</strong>{" "}
					{m.MANAGE_MODELS_SDK_USAGE_NOTE}
				</p>
			</DialogContent>
		</Dialog>
	);
}
