import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CLIENT_EVENTS } from "@/constants/events";
import {
	getEvaluatedResponse,
	getPrompt,
	getSelectedProviders,
	setEvaluatedData,
	setEvaluatedLoading,
	setPrompt,
} from "@/selectors/openground";
import { useRootStore } from "@/store";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { usePostHog } from "posthog-js/react";
import { toast } from "sonner";

export default function PromptInput() {
	const posthog = usePostHog();
	const { fireRequest } = useFetchWrapper();
	const prompt = useRootStore(getPrompt);
	const selectedProviders = useRootStore(getSelectedProviders);
	const updatePrompt = useRootStore(setPrompt);
	const setEvaluatedDataFunction = useRootStore(setEvaluatedData);
	const setEvaluatedLoadingFunction = useRootStore(setEvaluatedLoading);
	const onTextValueChange: any = (ev: any) => {
		updatePrompt(ev.target.value);
	};
	const evaluatedResponse = useRootStore(getEvaluatedResponse);

	const onSubmit = () => {
		const payload: any = {
			prompt,
			selectedProviders,
		};

		if (selectedProviders.length < 2) {
			toast.warning("Requires atleast two providers to compare!", {
				id: "evaluation",
			});
			return;
		}

		setEvaluatedLoadingFunction(true);

		fireRequest({
			body: JSON.stringify(payload),
			requestType: "POST",
			url: "/api/openground",
			responseDataKey: "data",
			successCb: (data) => {
				toast.success("Evaluation finished!", {
					id: "evaluation",
				});
				setEvaluatedDataFunction(data);
				posthog?.capture(CLIENT_EVENTS.OPENGROUND_EVALUATION_SUCCESS, {
					providers: selectedProviders.map(({ provider }) => provider),
					prompt,
				});
			},
			failureCb: (err?: string) => {
				toast.error(err || "Evaluation failed!", {
					id: "evaluation",
				});
				posthog?.capture(CLIENT_EVENTS.OPENGROUND_EVALUATION_FAILURE);
			},
		});
	};

	if (evaluatedResponse.data) return null;

	return (
		<div className="fixed bottom-4 left-1/2 z-10 w-full max-w-2xl -translate-x-1/2">
			<div className="flex items-center gap-2 rounded-md bg-stone-300 shadow-sm dark:bg-stone-700 overflow-hidden p-2">
				<Input
					className="flex-1 outline-none bg-transparent border-none text-stone-600 dark:bg-transparent dark:text-stone-300"
					placeholder="Enter your prompt..."
					type="text"
					onChange={onTextValueChange}
					value={prompt}
				/>
				<Button
					className={`bg-primary dark:bg-primary hover:bg-primary dark:hover:bg-primary text-stone-50 dark:text-stone-50 rounded-md`}
					disabled={
						selectedProviders.length < 2 ||
						prompt.length < 1 ||
						evaluatedResponse.isLoading
					}
					onClick={onSubmit}
				>
					Compare Responses
				</Button>
			</div>
		</div>
	);
}
