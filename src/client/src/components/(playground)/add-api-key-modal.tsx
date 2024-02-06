import { XCircleIcon } from "@heroicons/react/24/outline";
import { useRef } from "react";

type AddAPIKeyModalProps = {
	handleYes: (name: string) => void;
	handleNo: () => void;
};

export default function AddAPIKeyModal(props: AddAPIKeyModalProps) {
	const nameRef = useRef<HTMLInputElement>(null);

	const handleYes = () => {
		if (!nameRef.current?.value) return;
		props.handleYes(nameRef.current.value);
	};

	return (
		<div className="overflow-y-auto overflow-x-hidden fixed top-0 right-0 left-0 z-50 flex justify-center items-center w-full h-full bg-gray-900/[.6]">
			<form>
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
							Create an API Key
						</p>
						<div className="flex items-center my-3">
							<label
								htmlFor="name"
								className="block text-sm font-medium leading-6 text-gray-900 mr-3"
							>
								Name :
							</label>
              <div className="flex rounded-md shadow-sm ring-1 ring-inset ring-gray-300 focus-within:ring-2 focus-within:ring-inset focus-within:ring-indigo-600 sm:max-w-md">
                <input
                  type="text"
                  name="name"
                  className="block flex-1 border-0 bg-transparent py-1.5 pl-1 text-gray-900 placeholder:text-gray-400 focus:ring-0 sm:text-sm sm:leading-6 w-48"
                  placeholder="testing"
                  ref={nameRef}
                  required
                />
              </div>
						</div>
						<div className="flex justify-end">
							<button
								type="button"
								className="py-2 px-3 text-sm font-medium text-center text-white bg-red-600 rounded-lg hover:bg-red-700 focus:ring-4 focus:outline-none focus:ring-red-300 dark:bg-red-500 dark:hover:bg-red-600 dark:focus:ring-red-900"
								onClick={handleYes}
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
