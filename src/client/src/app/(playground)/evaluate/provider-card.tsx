import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { SettingsIcon } from "lucide-react";
import { ProviderType } from "./evaluate-config";
import { useRootStore } from "@/store";
import { setProviderConfig } from "@/selectors/evaluate";
import { ChangeEventHandler } from "react";

const SettingsForm = ({
	provider,
	index,
}: {
	provider: ProviderType;
	index: number;
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
	if (!config) return null;

	return (
		<div className="grid gap-4">
			<div className="space-y-2">
				<h4 className="font-medium leading-none">{provider.title} config</h4>
				<p className="text-sm text-muted-foreground">
					Set the config for the comparison.
				</p>
			</div>
			<div className="grid gap-2">
				{config.map((item: any) => {
					return (
						<div key={item.key} className="grid grid-cols-3 items-center gap-4">
							<Label htmlFor="width">{item.label}</Label>
							{item.type === "input" ? (
								<Input
									defaultValue={item.defaultValue}
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
								>
									<SelectTrigger className="col-span-2 h-8">
										<SelectValue placeholder={item.placeholder} />
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											{item.options.map((option: any) => (
												<SelectItem value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
							) : item.type === "slider" ? (
								<Slider
									defaultValue={[item.defaultValue]}
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
	);
};

export default function ProviderCard({
	provider,
	index,
}: {
	provider: ProviderType;
	index: number;
}) {
	return (
		<Card className="relative">
			<CardHeader>
				<CardTitle>{provider.title}</CardTitle>
			</CardHeader>
			<CardContent>
				<p>{provider.subTitle}</p>
			</CardContent>
			{/* <div> */}
			<Popover>
				<PopoverTrigger asChild>
					<div className="w-auto absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2">
						<Button size="icon" className="rounded-full">
							<SettingsIcon className="h-5 w-5" />
							<span className="sr-only">Settings</span>
						</Button>
					</div>
				</PopoverTrigger>
				<PopoverContent className="w-full">
					<SettingsForm provider={provider} index={index} />
				</PopoverContent>
			</Popover>
			{/* </div> */}
		</Card>
	);
}
