import { XCircleIcon } from "@heroicons/react/24/outline";

type ConfirmationModalProps = {
	title?: string;
	handleYes: () => void;
	handleNo: () => void;
	isUpdating?: boolean;
};

export default function ConfirmationModal(props: ConfirmationModalProps) {
	return (
		<div className="overflow-y-auto overflow-x-hidden fixed top-0 right-0 left-0 z-50 flex justify-center items-center w-full h-full bg-tertiary/[.6]">
			<div className="relative p-6 w-full max-w-lg h-full md:h-auto">
				<div className="relative p-4 text-center bg-white rounded sm:p-5">
					<button
						type="button"
						className="absolute top-2 right-2 rounded-lg text-sm p-1.5 ml-auto inline-flex items-center text-tertiary/[0.5]"
						onClick={props.handleNo}
					>
						<XCircleIcon className="w-5" />
					</button>
					<p className="mb-4 text-tertiary text-left">
						{props.title || "Are you sure you want to delete this item?"}
					</p>
					<div className="flex items-center space-x-4 w-full">
						<button
							type="button"
							className="py-2 px-3 text-sm text-tertiary bg-secondary rounded outline-none flex-1"
							onClick={props.handleNo}
							disabled={!!props.isUpdating}
						>
							No, cancel
						</button>
						<button
							type="button"
							className="py-2 px-3 text-sm text-center text-white bg-primary rounded outline-none"
							onClick={props.handleYes}
							disabled={!!props.isUpdating}
						>
							Yes, I&apos;m sure
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
