import { ProviderType } from "@/types/store/openground";
import { useRootStore } from "@/store";
import {
	getEvaluatedResponse,
	getSelectedProviders,
} from "@/selectors/openground";
import ProviderTable from "@/components/(playground)/openground/provider-table";

export default function ProviderResponse({
	provider,
	index,
}: {
	provider: ProviderType;
	index: number;
}) {
	const selectedProviders = useRootStore(getSelectedProviders);
	const evaluatedResponse = useRootStore(getEvaluatedResponse);
	return (
		<ProviderTable
			provider={provider}
			index={index}
			selectedProviders={selectedProviders}
			evaluatedResponse={evaluatedResponse}
		/>
	);
}
