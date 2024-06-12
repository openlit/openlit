import { Button } from "@/components/ui/button";
import { getEvaluatedResponse } from "@/selectors/openground";
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

	const showButton =
		(validateResponse && !!evaluatedResponse.data) || !validateResponse;

	return (
		<div className="flex w-full items-center">
			<h1 className="text-lg text-bold text-stone-900 dark:text-stone-200 grow">
				{title}
			</h1>
			{showButton ? (
				<Link href={"/openground/new"}>
					<Button variant="secondary">+ New</Button>
				</Link>
			) : null}
		</div>
	);
}
