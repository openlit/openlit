import { PlusIcon } from "lucide-react";
import { Providers } from "@/types/store/openground";
import { useRootStore } from "@/store";
import {
	addProvider,
	getEvaluatedResponse,
	getSelectedProviders,
} from "@/selectors/openground";
import AddProvider from "./add-provider";
import { MouseEventHandler, useRef } from "react";
import { isNil } from "lodash";
import { providersConfig } from "@/constants/openground";
import ProviderResponse from "./provider-response";

export default function ProvidersUI() {
	const containerRef = useRef<HTMLDivElement>(null);
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
				setTimeout(() => {
					if (containerRef.current) {
						containerRef.current.scrollLeft = containerRef.current.scrollWidth;
					}
				}, 60);
			}
		}
	};

	const AddProviderPlaceholder = () => (
		<div className="flex h-full w-1/2 grow">
			<AddProvider onClick={onClickAdd}>
				<div className="flex grow items-center justify-center cursor-pointer text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-800">
					Select Provider
				</div>
			</AddProvider>
		</div>
	);

	const AddProviderButton = () => (
		<AddProvider onClick={onClickAdd}>
			<div className="flex h-full items-center justify-center cursor-pointer shrink-0 bg-stone-300 hover:bg-stone-400 text-stone-400 hover:text-stone-300 dark:hover:bg-stone-800 dark:text-stone-400 dark:bg-stone-700">
				<PlusIcon />
			</div>
		</AddProvider>
	);

	const children = selectedProviders.map(({ provider }, index) => (
		<div
			key={`selected-provider-${index}`}
			className="flex h-full grow w-full min-w-[40%] max-w-[50%]"
		>
			<ProviderResponse provider={providersConfig[provider]} index={index} />
		</div>
	));

	if (children.length < 2) {
		if (children.length < 1) {
			children.push(<AddProviderPlaceholder key={`addplaceholder-1`} />);
		}
		children.push(<AddProviderPlaceholder key={`addplaceholder-2`} />);
	}

	return (
		<div className="flex w-full h-full gap-4 overflow-auto">
			<div
				className="flex w-full h-full bg-stone-100 grow dark:bg-stone-900 transition-all relative gap-1"
				ref={containerRef}
			>
				{children}
			</div>
			{selectedProviders.length > 1 &&
			selectedProviders.length < 5 &&
			!evaluatedResponse.data &&
			!evaluatedResponse.isLoading ? (
				<AddProviderButton />
			) : null}
		</div>
	);
}
