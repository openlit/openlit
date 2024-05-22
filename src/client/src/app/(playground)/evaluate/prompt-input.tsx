import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	getPrompt,
	getSelectedProviders,
	setPrompt,
} from "@/selectors/evaluate";
import { useRootStore } from "@/store";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";

export default function PromptInput() {
	const { fireRequest } = useFetchWrapper();
	const prompt = useRootStore(getPrompt);
	const selectedProviders = useRootStore(getSelectedProviders);
	const updatePrompt = useRootStore(setPrompt);
	const onTextValueChange: any = (ev: any) => {
		updatePrompt(ev.target.value);
	};

	const onSubmit = () => {
		const payload: any = {
			prompt,
			selectedProviders,
		};

		fireRequest({
			body: JSON.stringify(payload),
			requestType: "POST",
			url: "/api/evaluate",
			responseDataKey: "data",
			successCb: () => {
				toast.success("evaluation finished!", {
					id: "evaluation",
				});
			},
			failureCb: (err?: string) => {
				toast.error(err || "evaluation failed!", {
					id: "evaluation",
				});
			},
		});
	};

	return (
		<div className="fixed bottom-4 left-1/2 z-10 w-full max-w-2xl -translate-x-1/2">
			<div className="flex items-center gap-2 rounded-full bg-stone-900 shadow-sm dark:bg-stone-100 overflow-hidden">
				<Input
					className="flex-1 outline-none bg-transparent border-none text-stone-50 dark:bg-transparent dark:text-stone-900"
					placeholder="Enter your prompt..."
					type="text"
					onChange={onTextValueChange}
					value={prompt}
				/>
				<Button
					className="bg-primary dark:bg-primary hover:bg-primary dark:hover:bg-primary text-stone-50 dark:text-stone-50 rounded-full"
					onClick={onSubmit}
				>
					Compare Responses
				</Button>
			</div>
		</div>
	);
}
