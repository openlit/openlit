"use client";
import Filter from "../filter";
import ModelsCategories from "./models-categories";
import NumberStats from "./number-stats";
import RequestsPerTime from "./requests-per-time";

export default function PlaygroundPage() {
	return (
		<div className="flex flex-col grow w-full h-full rounded overflow-hidden">
			<Filter />
			<div className="flex flex-col p-2 grow w-full h-full rounded overflow-y-auto">
				<NumberStats />
				<div className="flex flex-col gap-6">
					<RequestsPerTime />
					<ModelsCategories />
				</div>
			</div>
		</div>
	);
}
