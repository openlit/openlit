import { ProviderType, Providers } from "@/store/openground";
import {
	Table,
	TableBody,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useRootStore } from "@/store";
import {
	getEvaluatedResponse,
	getSelectedProviders,
	removeProvider,
	setProviderConfig,
} from "@/selectors/openground";
import { Button } from "@/components/ui/button";
import { Settings2Icon, Trash2Icon } from "lucide-react";
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
import { JsonViewer } from "@textea/json-viewer";
import { omit } from "lodash";

const SettingsForm = ({
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
			<SheetContent className="max-w-none sm:max-w-none w-1/2 bg-stone-100 dark:bg-stone-900 border-transparent">
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
										/>
									) : item.type === "select" ? (
										<Select
											onValueChange={(value) =>
												onSelectChange(value, `[${index}.config.${item.key}]`)
											}
											defaultValue={selectedProvider.config[item.key]}
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

export default function ProviderTable({
	provider,
	index,
}: {
	provider: ProviderType;
	index: number;
}) {
	const removeProviderItem = useRootStore(removeProvider);
	const onClickDelete = () => removeProviderItem(index);
	const selectedProviders = useRootStore(getSelectedProviders);
	const selectedProvider = selectedProviders[index];
	const evaluatedResponse = useRootStore(getEvaluatedResponse);
	return (
		<Table className="h-full relative">
			<TableHeader className="bg-stone-300 dark:bg-stone-700 text-stone-600 dark:text-stone-200 border-none z-10 sticky top-0">
				<TableRow>
					<TableHead colSpan={2}>
						<div className="flex w-full gap-3">
							<span className="grow">
								{provider.title} ({provider.subTitle})
							</span>
							<SettingsForm
								provider={provider}
								index={index}
								selectedProvider={selectedProvider}
								updateAllowed={
									!(evaluatedResponse.data || evaluatedResponse.isLoading)
								}
							>
								<Button
									variant="ghost"
									size="icon"
									className="rounded-full shrink-0 h-auto w-auto"
								>
									<Settings2Icon className="h-4 w-4" />
									<span className="sr-only">Config</span>
								</Button>
							</SettingsForm>
							{!(evaluatedResponse.data || evaluatedResponse.isLoading) && (
								<Button
									variant="ghost"
									size="icon"
									className="rounded-full shrink-0 h-auto w-auto"
									onClick={onClickDelete}
								>
									<Trash2Icon className="h-4 w-4" />
									<span className="sr-only">Delete</span>
								</Button>
							)}
						</div>
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody className="text-stone-900 dark:text-stone-300">
				{evaluatedResponse.data ? (
					evaluatedResponse.data?.[index]?.[1] ? (
						<>
							{Object.keys(
								evaluatedResponse.data?.[index]?.[1].evaluationData || {}
							).map((key) => (
								<TableRow key={key}>
									<div className="flex flex-col w-full h-full relative">
										<p className="font-medium p-4 bg-stone-200 dark:bg-stone-800 sticky top-[48px]">
											<span className={`${index === 0 ? "" : "opacity-0"}`}>
												{key.toUpperCase()}
											</span>
										</p>
										<p
											className={`font-medium p-4 ${
												key === "prompt" || key === "response"
													? "h-[200px] overflow-auto"
													: ""
											}`}
										>
											{evaluatedResponse.data?.[index]?.[1].evaluationData[key]}
										</p>
									</div>
								</TableRow>
							))}
							<TableRow>
								<div className="flex flex-col w-full h-full relative">
									<p className="font-medium p-4 bg-stone-200 dark:bg-stone-800 sticky top-[48px] z-20">
										<span className={`${index === 0 ? "" : "opacity-0"}`}>
											PROVIDER RESPONSE
										</span>
									</p>
									<JsonViewer
										value={omit(evaluatedResponse.data[index]?.[1], [
											"evaluationData",
										])}
										className="overflow-auto p-3 h-[400px] !rounded-none"
										enableClipboard={false}
										displayDataTypes={false}
										displaySize={false}
										theme="dark"
									/>
								</div>
							</TableRow>
						</>
					) : (
						<TableRow>
							<div className="flex flex-col w-full h-full items-center justify-center p-4 text-error">
								{evaluatedResponse.data?.[index]?.[0] ||
									"Evaluated Response will appear here"}
							</div>
						</TableRow>
					)
				) : (
					<TableRow>
						<div className="flex flex-col w-full h-full items-center justify-center p-4">
							{evaluatedResponse.isLoading
								? "Evaluating the response"
								: "Evaluated Response will appear here"}
						</div>
					</TableRow>
				)}
			</TableBody>
		</Table>
	);
}
