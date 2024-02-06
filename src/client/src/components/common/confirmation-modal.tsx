import { XCircleIcon } from "@heroicons/react/24/outline";

type ConfirmationModalProps = {
	handleYes: () => void;
	handleNo: () => void;
};

export default function ConfirmationModal(props: ConfirmationModalProps) {
	return (
		<div className="overflow-y-auto overflow-x-hidden fixed top-0 right-0 left-0 z-50 flex justify-center items-center w-full h-full bg-gray-900/[.6]">
			<div className="relative p-4 w-full max-w-md h-full md:h-auto">
				<div className="relative p-4 text-center bg-white rounded-lg shadow dark:bg-gray-800 sm:p-5">
					<button
						type="button"
						className="text-gray-400 absolute top-2.5 right-2.5 bg-transparent hover:bg-gray-200 hover:text-gray-900 rounded-lg text-sm p-1.5 ml-auto inline-flex items-center dark:hover:bg-gray-600 dark:hover:text-white"
						onClick={props.handleNo}
					>
						<XCircleIcon className="w-5" />
					</button>
					<p className="mb-4 text-gray-500 dark:text-gray-300">
						Are you sure you want to delete this item?
					</p>
					<div className="flex justify-center items-center space-x-4">
						<button
							type="button"
							className="py-2 px-3 text-sm font-medium text-gray-500 bg-white rounded-lg border border-gray-200 hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-primary-300 hover:text-gray-900 focus:z-10 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-500 dark:hover:text-white dark:hover:bg-gray-600 dark:focus:ring-gray-600"
							onClick={props.handleNo}
						>
							No, cancel
						</button>
						<button
							type="button"
							className="py-2 px-3 text-sm font-medium text-center text-white bg-red-600 rounded-lg hover:bg-red-700 focus:ring-4 focus:outline-none focus:ring-red-300 dark:bg-red-500 dark:hover:bg-red-600 dark:focus:ring-red-900"
							onClick={props.handleYes}
						>
							Yes, I&apos;m sure
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
