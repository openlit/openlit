import { Button } from "@/components/ui/button";
import { getEvaluatedResponse, resetOpenground } from "@/selectors/openground";
import { useRootStore } from "@/store";
import Link from "next/link";

export default function OpengroundHeader({
	className ="flex w-full items-center justify-end",
	validateResponse = true,
}: {
	className?: string;
	validateResponse: boolean;
}) {
	const evaluatedResponse = useRootStore(getEvaluatedResponse);
	const resetOpengroundData = useRootStore(resetOpenground);

	const showButton =
		(validateResponse && !!evaluatedResponse.data) || !validateResponse;

	return (
		<div className={className}>
			{showButton ? (
				<Link href={"/openground/new"} onClick={resetOpengroundData}>
					<Button variant="secondary" className="bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100 h-9 py-1">Create new</Button>
				</Link>
			) : null}
		</div>
	);
}
