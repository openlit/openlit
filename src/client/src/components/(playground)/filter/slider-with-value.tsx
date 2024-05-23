import { FilterConfig } from "@/store/filter";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";

export default function SlideWithValue({
	label,
	value,
	maxValue,
	onChange,
	step,
	type,
}: {
	label: string;
	value: number;
	maxValue: number;
	onChange: (type: keyof FilterConfig, value: any) => void;
	step?: number;
	type: keyof FilterConfig;
}) {
	const onValueChange = (changedValue: number[]) => {
		onChange(type, changedValue[0]);
	};

	return (
		<div className="flex items-center shrink-0 w-80 px-4 ml-4 border border-stone-200 dark:border-0 dark:bg-stone-800 rounded-md text-stone-500">
			<div className="flex items-center justify-between shrink-0">
				<Label htmlFor={type}>{label}</Label>
			</div>
			<Slider
				id={type}
				max={maxValue}
				defaultValue={[value]}
				step={step || 0.0001}
				onValueChange={onValueChange}
				className="[&_[role=slider]]:h-4 [&_[role=slider]]:w-4 w-32 ml-3 shrink-0"
				aria-label={label}
			/>
			<Separator orientation="vertical" className="mx-2 h-4" />
			<span className="rounded-md border border-transparent text-right text-sm text-muted-foreground hover:border-border">
				{value}
			</span>
		</div>
	);
}
