import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import copy from "copy-to-clipboard";
import { toast } from "sonner";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { jsonStringify } from "@/utils/json";
import { FormEvent, useEffect, useState } from "react";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import getMessage from "@/constants/messages";
import {
	ApiKeyAccessSelector,
	ApiKeyAccessValue,
} from "@/components/(playground)/api-keys/access";

export default function Generate({ refresh }: { refresh: () => void }) {
	const posthog = usePostHog();
	const messages = getMessage();
	const [isOpen, setIsOpen] = useState(false);
	const [name, setName] = useState("default");
	const [scopes, setScopes] = useState<ApiKeyAccessValue>(null);
	const { fireRequest: fireCreateRequest, isLoading: isCreating } =
		useFetchWrapper();

	useEffect(() => {
		if (isOpen) {
			setName("default");
			setScopes(null);
		}
	}, [isOpen]);

	const handleCreation = async (event: FormEvent) => {
		event.preventDefault();
		if (isCreating) return;
		if (name.trim().length < 3) {
			toast.error("Name length should be greater than 2...", {
				id: "api-key",
			});
			return;
		}
		if (Array.isArray(scopes) && scopes.length === 0) {
			toast.error(messages.API_KEY_ACCESS_SELECT_FEATURE, {
				id: "api-key",
			});
			return;
		}
		toast.loading("Generating api key...", {
			id: "api-key",
		});
		fireCreateRequest({
			requestType: "POST",
			url: `/api/api-key`,
			body: jsonStringify({
				name: name.trim(),
				// Omitted (full access) unless the edition supports restricting it.
				...(Array.isArray(scopes) ? { scopes } : {}),
			}),
			successCb: (data: any) => {
				copy(data.apiKey);
				toast.success("Generated and copied. This key is shown only once.", {
					id: "api-key",
				});
				setIsOpen(false);
				refresh();
				posthog?.capture(CLIENT_EVENTS.API_KEY_ADD_SUCCESS);
			},
			failureCb: (err?: string) => {
				toast.error(err || `Cannot connect to server!`, {
					id: "api-key",
				});
				posthog?.capture(CLIENT_EVENTS.API_KEY_ADD_FAILURE);
			},
		});
	};

	return (
		<Dialog onOpenChange={setIsOpen} open={isOpen}>
			<DialogTrigger asChild>
				<Button
					variant="secondary"
					size={"sm"}
					className="bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100 px-8 h-8 self-end"
				>
					{messages.GENERATE_NEW_API_KEY}
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle className="dark:text-stone-200 text-stone-800">
						{messages.CREATE_NEW_KEY}
					</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={handleCreation}
					className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto"
				>
					<div className="flex flex-col gap-1.5">
						<Label
							htmlFor="api-key-name"
							className="text-sm font-medium text-stone-900 dark:text-stone-200"
						>
							Name
						</Label>
						<Input
							id="api-key-name"
							name="name"
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
						<span className="text-xs text-stone-500 dark:text-stone-400">
							Assign a name to api key for better references in future
						</span>
					</div>
					<ApiKeyAccessSelector value={scopes} onChange={setScopes} />
					<Button
						type="submit"
						size="sm"
						disabled={isCreating}
						className="bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100 px-8 h-8 self-end"
					>
						{messages.CREATE}
					</Button>
				</form>
			</DialogContent>
		</Dialog>
	);
}
