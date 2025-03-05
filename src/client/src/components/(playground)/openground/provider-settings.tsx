import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { ReactNode } from "react";
import { setProviderConfig } from "@/selectors/openground";
import { ProviderType, Providers } from "@/types/store/openground";
import { useRootStore } from "@/store";

const ProviderSettings = ({
	provider,
	index,
	children,
	selectedProvider,
	updateAllowed = true,
}: {
	provider: ProviderType;
	index: number;
	children: ReactNode;
	selectedProvider: {
		provider: Providers;
		config: Record<string, any>;
	};
	updateAllowed: boolean;
}) => {
	const { config } = provider;

	const updateProviderConfig = useRootStore(setProviderConfig);
	const onSelectChange = (value: any, path: string) => {
		updateProviderConfig(path, value);
	};

	const onSliderChange = (value: any, path: string) => {
		updateProviderConfig(path, value[0]);
	};

	const onTextValueChange: any = (ev: any, path: string) => {
		updateProviderConfig(path, ev.target.value);
	};

	return (
		<Sheet>
			<SheetTrigger asChild>{children}</SheetTrigger>
			<SheetContent className="max-w-none sm:max-w-none w-1/2 bg-stone-100 dark:bg-stone-900 border-transparent text-stone-900 dark:text-stone-300">
				<SheetHeader>
					<SheetTitle>
						{provider.title} ({provider.subTitle})
					</SheetTitle>
				</SheetHeader>
				<div className="grid gap-4 relative">
					{!updateAllowed && (
						<div className="absolute w-full h-full top-0 left-0 z-20" />
					)}

					<div className="space-y-2">
						<p className="text-sm text-muted-foreground">
							Set the config for the comparison.
						</p>
					</div>
					<div className="grid gap-8 mt-8">
						{config.map((item: any) => {
							if (item.type === "hidden") return null;
							return (
								<div
									key={item.key}
									className="grid grid-cols-3 items-center gap-4"
								>
									<Label htmlFor="width">
										{item.label}{" "}
										{item.type === "slider"
											? `(${selectedProvider.config[item.key]})`
											: null}
									</Label>
									{item.type === "input" ? (
										<Input
											defaultValue={selectedProvider.config[item.key]}
											placeholder={item.placeholder}
											name={item.key}
											className="col-span-2 h-8"
											onChange={(ev) =>
												onTextValueChange(ev, `[${index}.config.${item.key}]`)
											}
											disabled={!updateAllowed}
										/>
									) : item.type === "select" ? (
										<Select
											onValueChange={(value) =>
												onSelectChange(value, `[${index}.config.${item.key}]`)
											}
											defaultValue={selectedProvider.config[item.key]}
											disabled={!updateAllowed}
										>
											<SelectTrigger className="col-span-2 h-8">
												<SelectValue placeholder={item.placeholder} />
											</SelectTrigger>
											<SelectContent>
												<SelectGroup>
													{item.options.map((option: any) => (
														<SelectItem key={option.value} value={option.value}>
															{option.label}
														</SelectItem>
													))}
												</SelectGroup>
											</SelectContent>
										</Select>
									) : item.type === "slider" ? (
										<Slider
											defaultValue={[selectedProvider.config[item.key]]}
											max={item.limits.max}
											step={item.limits.step}
											min={item.limits.min}
											className="col-span-2 h-8"
											onValueChange={(value) =>
												onSliderChange(value, `[${index}.config.${item.key}]`)
											}
											disabled={!updateAllowed}
										/>
									) : null}
								</div>
							);
						})}
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
};

export default ProviderSettings;
