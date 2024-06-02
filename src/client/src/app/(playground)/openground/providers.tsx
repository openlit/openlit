import { PlusIcon } from "lucide-react";
import { Providers } from "@/store/openground";
import { useRootStore } from "@/store";
import {
	addProvider,
	getEvaluatedResponse,
	getSelectedProviders,
} from "@/selectors/openground";
import AddProvider from "./add-provider";
import { MouseEventHandler } from "react";
import { isNil } from "lodash";
import ProviderTable from "./provider-table";
import { providersConfig } from "../../../constants/openground";

export default function ProvidersUI() {
	const selectedProviders = useRootStore(getSelectedProviders);
	const addProviderItem = useRootStore(addProvider);
	const evaluatedResponse = useRootStore(getEvaluatedResponse);
	const onClickAdd: MouseEventHandler = (event) => {
		const { key } = (event.currentTarget as HTMLElement).dataset;
		if (key) {
			const providerConfig = providersConfig[key as Providers];
			if (providerConfig) {
				const defaultConfig = providerConfig.config.reduce(
					(acc: Record<string, any>, config: Record<string, any>) => {
						if (!isNil(config.defaultValue)) {
							acc[config.key] = config.defaultValue;
						}

						return acc;
					},
					{}
				);
				addProviderItem(key as Providers, defaultConfig);
			}
		}
	};

	const AddProviderPlaceholder = () => (
		<AddProvider onClick={onClickAdd}>
			<div className="flex grow items-center justify-center cursor-pointer text-stone-800 dark:text-stone-300 hover:bg-stone-200/50 dark:hover:bg-stone-800/50">
				Select Provider
			</div>
		</AddProvider>
	);

	const AddProviderButton = () => (
		<AddProvider onClick={onClickAdd}>
			<div className="flex h-full items-center justify-center cursor-pointer shrink-0 bg-stone-200 hover:bg-stone-300/70 text-stone-400 hover:text-stone-600">
				<PlusIcon />
			</div>
		</AddProvider>
	);

	const children = selectedProviders.map(({ provider }, index) => (
		<ProviderTable
			key={`selected-provider-${index}`}
			provider={providersConfig[provider]}
			index={index}
		/>
	));

	if (children.length < 2) {
		if (children.length < 1) {
			children.push(<AddProviderPlaceholder />);
		}
		children.push(<AddProviderPlaceholder />);
	}

	return (
		<div className="flex w-full h-full bg-stone-100 dark:bg-stone-900 overflow-auto">
			{children.map((child, index) => (
				<div key={index} className="flex w-full h-full">
					{child}
				</div>
			))}
			{selectedProviders.length > 1 &&
			selectedProviders.length < 5 &&
			!evaluatedResponse.data &&
			!evaluatedResponse.isLoading ? (
				<AddProviderButton />
			) : null}
		</div>
	);
}
