import { noop } from "@/utils/noop";
import React, { FormEventHandler, HTMLInputTypeAttribute } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type FieldProps = {
	label: string;
	type: HTMLInputTypeAttribute;
	name: string;
	placeholder?: string;
	defaultValue?: string;
	inputKey?: string;
	disabled?: boolean;
};

const FormField = ({
	label,
	type,
	name,
	placeholder,
	defaultValue,
	inputKey,
	disabled,
}: FieldProps) => {
	return (
		<div className="grid grid-cols-3 flex-1 items-center">
			<Label htmlFor={name} className="col-span-1">
				{label}
			</Label>
			<Input
				autoComplete="off"
				className="col-span-2"
				key={inputKey || `${name}-${defaultValue}`}
				type={type}
				name={name}
				id={name}
				placeholder={placeholder}
				defaultValue={defaultValue}
				disabled={disabled}
			/>
		</div>
	);
};

const FormBuilder = ({
	fields,
	heading,
	subHeading,
	subHeadingClass,
	isLoading = false,
	onSubmit,
	submitButtonText,
	isAllowedToSubmit = true,
}: {
	fields: FieldProps[];
	heading?: string;
	subHeading?: string;
	subHeadingClass?: string;
	isLoading?: boolean;
	onSubmit: FormEventHandler<HTMLFormElement>;
	submitButtonText: string;
	isAllowedToSubmit?: boolean;
}) => {
	return (
		<form
			className="flex flex-col w-full"
			onSubmit={isLoading || !isAllowedToSubmit ? noop : onSubmit}
		>
			<Card className="w-full border-0 flex flex-col h-full">
				<CardHeader className="shrink-0">
					<CardTitle className="text-2xl">{heading}</CardTitle>
					{subHeading && (
						<CardTitle className={`text-sm ${subHeadingClass}`}>
							{subHeading}
						</CardTitle>
					)}
				</CardHeader>
				<CardContent className="flex gap-4 flex-col overflow-hidden">
					<div className="grid gap-5 relative flex-1 overflow-y-auto ">
						{fields.map((field, index) => (
							<FormField key={index} {...field} />
						))}
					</div>
					<div className="flex items-center justify-end w-full gap-3">
						{isAllowedToSubmit && (
							<Button
								type="submit"
								className={`${isLoading ? "animate-pulse" : ""}`}
							>
								{submitButtonText}
							</Button>
						)}
					</div>
				</CardContent>
			</Card>
		</form>
	);
};

export default FormBuilder;
