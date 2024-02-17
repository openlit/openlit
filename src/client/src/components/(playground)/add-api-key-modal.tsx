import { XCircleIcon } from "@heroicons/react/24/outline";
import { useRef } from "react";

type AddAPIKeyModalProps = {
	handleYes: (name: string) => void;
	handleNo: () => void;
	isCreating?: boolean;
};

export default function AddAPIKeyModal(props: AddAPIKeyModalProps) {
	const nameRef = useRef<HTMLInputElement>(null);

	const handleYes = () => {
		if (!nameRef.current?.value) return;
		props.handleYes(nameRef.current.value);
	};

	return (
		<div className="overflow-y-auto overflow-x-hidden fixed top-0 right-0 left-0 z-50 flex justify-center items-center w-full h-full bg-tertiary/[.6]">
			<form>
				<div className="relative p-4 w-full max-w-md h-full md:h-auto">
					<div className="relative p-4 text-center bg-white rounded sm:p-5">
						<button
							type="button"
							className="absolute top-2 right-2 rounded-lg text-sm p-1.5 ml-auto inline-flex items-center text-tertiary/[0.5]"
							onClick={props.handleNo}
						>
							<XCircleIcon className="w-5" />
						</button>
						<p className="mb-4 text-tertiary text-left">Create an API Key</p>
						<div className="flex items-center my-3 outine-none border-b w-64">
							<input
								type="text"
								name="name"
								className="block flex-1 border-0 bg-transparent py-1.5 px-3 text-primary placeholder:text-primary/[0.3] sm:text-sm outine-none focus:outine-none"
								placeholder="Name: testing"
								ref={nameRef}
								required
							/>
						</div>
						<div className="flex justify-end">
							<button
								type="button"
								className={`py-2 px-3 text-sm text-center text-white bg-primary/[0.9] rounded hover:bg-primary outline-none ${
									props.isCreating ? "animate-pulse" : ""
								}`}
								onClick={handleYes}
								disabled={!!props.isCreating}
							>
								Create
							</button>
						</div>
					</div>
				</div>
			</form>
		</div>
	);
}
