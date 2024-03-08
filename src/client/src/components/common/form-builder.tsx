import { noop } from "@/utils/noop";
import React, { FormEventHandler, HTMLInputTypeAttribute } from "react";

type FieldProps = {
	label: string;
	type: HTMLInputTypeAttribute;
	name: string;
	placeholder?: string;
	defaultValue?: string;
	inputKey?: string;
};

const FormField = ({
	label,
	type,
	name,
	placeholder,
	defaultValue,
	inputKey,
}: FieldProps) => {
	return (
		<div className="flex flex-col mt-6 w-full">
			<div className="flex flex-1 items-center">
				<label
					htmlFor={name}
					className="text-tertiary/[0.8] text-sm font-normal w-1/5"
				>
					{label}
				</label>
				<div className="flex w-2/3 shadow-sm ring-1 ring-inset ring-gray-300">
					<input
						key={inputKey || `${name}-${defaultValue}`}
						type={type}
						name={name}
						id={name}
						className="flex-1 border border-tertiary/[0.2] py-1.5 px-2 text-tertiary placeholder:text-tertiary/[0.4] outline-none focus:ring-0 text-sm"
						placeholder={placeholder}
						defaultValue={defaultValue}
					/>
				</div>
			</div>
		</div>
	);
};

const FormBuilder = ({
	fields,
	heading,
	isLoading = false,
	onSubmit,
	submitButtonText,
}: {
	fields: FieldProps[];
	heading: string;
	isLoading?: boolean;
	onSubmit: FormEventHandler<HTMLFormElement>;
	submitButtonText: string;
}) => {
	return (
		<form
			className="flex flex-col w-full"
			onSubmit={isLoading ? noop : onSubmit}
		>
			<div className="flex flex-col relative flex-1 overflow-y-auto">
				<h2 className="text-base font-semibold px-5 pt-3 text-tertiary sticky top-0 bg-white">
					{heading}
				</h2>

        <div className="flex flex-col relative flex-1 overflow-y-auto px-5 pb-3">
          {fields.map((field, index) => (
            <FormField key={index} {...field} />
          ))}
        </div>
				<div className="mt-6 flex items-center justify-end border-t border-secondary w-full py-2 gap-3">
					<button
						type="submit"
						className={`rounded-sm bg-primary/[0.9] px-5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-primary focus-visible:outline ${
							isLoading ? "animate-pulse" : ""
						}`}
					>
						{submitButtonText}
					</button>
				</div>
			</div>
		</form>
	);
};

export default FormBuilder;
