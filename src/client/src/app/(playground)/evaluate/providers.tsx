import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlusIcon } from "lucide-react";
import ProviderCard from "./provider-card";
import { Providers, providersConfig } from "./evaluate-config";
import { useRootStore } from "@/store";
import { addProvider, getSelectedProviders } from "@/selectors/evaluate";

export default function ProvidersUI() {
	const selectedProviders = useRootStore(getSelectedProviders);
	const addProviderItem = useRootStore(addProvider);
	const onClickAdd = () => {
		addProviderItem("openai-chat");
	};
	return (
		<main className="container my-8 grid gap-8">
			<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
				{selectedProviders.map((item, index) => (
					<ProviderCard
						provider={providersConfig[item.provider as Providers]}
						index={index}
					/>
				))}
				<Card className="relative">
					<CardHeader>
						<CardTitle>Add Provider</CardTitle>
					</CardHeader>
					<CardContent className="flex items-center justify-center">
						<p className="text-gray-500 dark:text-gray-400">
							Click + to add another AI provider
						</p>
					</CardContent>
					<div className="w-auto absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2">
						<Button size="icon" className="rounded-full" onClick={onClickAdd}>
							<PlusIcon className="h-4 w-4" />
							<span className="sr-only">Add Provider</span>
						</Button>
					</div>
				</Card>
			</div>
		</main>
	);
}
