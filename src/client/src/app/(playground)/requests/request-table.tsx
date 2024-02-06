import {
	BeakerIcon,
	CalendarDaysIcon,
	ClipboardDocumentCheckIcon,
	ClipboardDocumentListIcon,
	ClockIcon,
	CogIcon,
	CurrencyDollarIcon,
	EyeIcon,
} from "@heroicons/react/24/outline";
import { format } from "date-fns";
import { round } from "lodash";
import { DisplayDataRequestMappingKeys, useRequest } from "./request-context";

type RenderRowProps = {
	item: Record<(typeof DisplayDataRequestMappingKeys)[number], any>;
};

const RenderRow = ({ item }: RenderRowProps) => {
	const [, updateRequest] = useRequest();

	return (
		<div className="flex flex-col mb-4">
			<div className="flex items-center border rounded-t border-b-0 py-1 px-3 z-0 self-start bg-gray-200">
				<div className="flex items-center pr-3">
					<CalendarDaysIcon className="w-4" />
					<p className="text-xs leading-none text-gray-600 ml-2">
						{format(item.time, "MMM do, Y")}
					</p>
				</div>
				<div className="flex items-center pl-3 border-l border-gray-500">
					<ClockIcon className="w-4" />
					<p className="text-xs leading-none ml-2">
						{round(item.requestduration, 4)}s
					</p>
				</div>
			</div>
			<div className="flex items-stretch h-16 border relative items-center px-3 rounded-b">
				<div className="flex items-center w-2/12">
					<p className="text-base leading-none">{item.applicationname}</p>
				</div>
				<div className="flex items-center w-3/12 px-2">
					<BeakerIcon className="w-4 mr-3" />
					<p className="text-sm leading-none mb-1">{item.endpoint}</p>
				</div>
				<div className="flex items-center w-2/12 px-2">
					<CogIcon className="w-4" />
					<p className="text-sm leading-none text-gray-600 ml-2">
						{item.model}
					</p>
				</div>
				<div className="flex items-center justify-center w-2/12 relative">
					<CurrencyDollarIcon className="w-4" />
					<p className="text-sm leading-none text-gray-600 ml-2">
						{round(item.usagecost, 6)}
					</p>
					<p className="text-xs absolute bottom-1 left-0 opacity-30 w-full text-center">
						Usage Cost
					</p>
				</div>
				<div className="flex items-center justify-center w-2/12 relative">
					<ClipboardDocumentCheckIcon className="w-4" />
					<p className="text-sm leading-none text-gray-600 ml-2">
						{item.prompttokens}
					</p>
					<p className="text-xs absolute bottom-1 left-0 opacity-30 w-full text-center">
						Prompt Tokens
					</p>
				</div>
				<div className="flex items-center justify-center w-2/12 relative">
					<ClipboardDocumentListIcon className="w-4" />
					<p className="text-sm leading-none text-gray-600 ml-2">
						{item.totaltokens}
					</p>
					<p className="text-xs absolute bottom-1 left-0 opacity-30 w-full text-center">
						Total Tokens
					</p>
				</div>
				<div className="flex items-center pl-3">
					<button type="button" onClick={() => updateRequest(item)}>
						<EyeIcon className="w-4" />
					</button>
				</div>
			</div>
		</div>
	);
};

export default function RequestTable({ data }: { data: any[] }) {
	return (
		<div className="flex flex-col p-2 w-full relative sm:rounded-lg overflow-hidden mt-3">
			<div className="overflow-auto">
				<div className="flex flex-col w-full text-sm text-left relative">
					{data.map((item, index) => (
						<RenderRow key={`item-${index}`} item={item} />
					))}
				</div>
			</div>
		</div>
	);
}
