import { Button } from "@/components/ui/button";
import { getEvaluatedResponse, resetOpenground } from "@/selectors/openground";
import { useRootStore } from "@/store";
import Link from "next/link";

export default function OpengroundHeader({
	title,
	validateResponse = true,
}: {
	title: string;
	validateResponse: boolean;
}) {
	const evaluatedResponse = useRootStore(getEvaluatedResponse);
	const resetOpengroundData = useRootStore(resetOpenground);

	const showButton =
		(validateResponse && !!evaluatedResponse.data) || !validateResponse;

	return (
		<div className="flex w-full items-center">
			<h1 className="text-lg text-bold text-stone-900 dark:text-stone-200 grow">
				{title}
			</h1>
			{showButton ? (
				<Link href={"/openground/new"} onClick={resetOpengroundData}>
					<Button variant="secondary" className="bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100">+ New</Button>
				</Link>
			) : null}
		</div>
	);
}
