import { ProviderType } from "@/store/openground";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useRootStore } from "@/store";
import {
	getEvaluatedResponse,
	getSelectedProviders,
	removeProvider,
} from "@/selectors/openground";
import { Button } from "@/components/ui/button";
import { FlaskRoundIcon, Settings2Icon, Trash2Icon } from "lucide-react";
import { JsonViewer } from "@textea/json-viewer";
import { omit } from "lodash";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/components/ui/hover-card";
import { providersConfig } from "@/constants/openground";
import ProviderSettings from "./provider-settings";
import Image from "next/image";

const keyHeadersTransformer = (str: string) => {
	// Step 1: Capitalize the first letter
	str = str.charAt(0).toUpperCase() + str.slice(1);

	// Step 2: Insert a space before any uppercase letter that follows a lowercase letter
	str = str.replace(/([a-z])([A-Z])/g, "$1 $2");

	// Step 3: Convert any uppercase letters after the first character to lowercase
	str = str.charAt(0) + str.slice(1).toLowerCase();

	return str;
};

export default function ProviderTable({
	provider,
	index,
}: {
	provider: ProviderType;
	index: number;
}) {
	const removeProviderItem = useRootStore(removeProvider);
	const onClickDelete = () => removeProviderItem(index);
	const selectedProviders = useRootStore(getSelectedProviders);
	const selectedProvider = selectedProviders[index];
	const evaluatedResponse = useRootStore(getEvaluatedResponse);
	return (
		<Table className="h-full relative">
			<TableHeader className="bg-stone-300 dark:bg-stone-700 text-stone-600 dark:text-stone-200 border-none z-10 sticky top-0">
				<TableRow>
					<TableHead colSpan={2}>
						<div className="flex w-full gap-3">
							<span className="grow">
								{provider.title} ({provider.subTitle})
							</span>
							<ProviderSettings
								provider={provider}
								index={index}
								selectedProvider={selectedProvider}
								updateAllowed={
									!(evaluatedResponse.data || evaluatedResponse.isLoading)
								}
							>
								<Button
									variant="ghost"
									size="icon"
									className="rounded-full shrink-0 h-auto w-auto"
								>
									<Settings2Icon className="h-4 w-4" />
									<span className="sr-only">Config</span>
								</Button>
							</ProviderSettings>
							{!(evaluatedResponse.data || evaluatedResponse.isLoading) && (
								<Button
									variant="ghost"
									size="icon"
									className="rounded-full shrink-0 h-auto w-auto"
									onClick={onClickDelete}
								>
									<Trash2Icon className="h-4 w-4" />
									<span className="sr-only">Delete</span>
								</Button>
							)}
						</div>
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody className="text-stone-900 dark:text-stone-300">
				{evaluatedResponse.data ? (
					evaluatedResponse.data?.[index]?.[1] ? (
						<>
							{Object.keys(
								evaluatedResponse.data?.[index]?.[1].evaluationData || {}
							).map((key) => (
								<TableRow key={key}>
									<div className="flex flex-col w-full h-full relative">
										<p className="font-medium p-4 bg-stone-200 dark:bg-stone-800 text-stone-500 sticky top-[48px]">
											<span className={`${index === 0 ? "" : "opacity-0"}`}>
												{keyHeadersTransformer(key)}
											</span>
										</p>
										<HoverCard>
											<HoverCardTrigger>
												<p
													className={`text-stone-600 dark:text-stone-400 p-4 ${
														key === "prompt" || key === "response"
															? "h-[200px] overflow-auto"
															: ""
													}`}
												>
													{
														evaluatedResponse.data?.[index]?.[1].evaluationData[
															key
														]
													}
												</p>
											</HoverCardTrigger>
											{key === "prompt" || key === "response" ? null : (
												<HoverCardContent className="w-auto px-0">
													<Table>
														<TableHeader>
															<TableRow>
																<TableHead className="h-auto">
																	Provider
																</TableHead>
																<TableHead className="text-right h-auto">
																	{keyHeadersTransformer(key)}
																</TableHead>
															</TableRow>
														</TableHeader>
														<TableBody>
															{evaluatedResponse.data?.map(
																(item, itemIndex) => {
																	const { provider } =
																		selectedProviders[itemIndex];
																	const providerConfig =
																		providersConfig[provider];
																	return itemIndex === index ||
																		!item[1]?.evaluationData?.[key] ? null : (
																		<TableRow className="h-auto">
																			<TableCell className="font-medium h-auto py-2">
																				{providerConfig.title}
																			</TableCell>
																			<TableCell className="text-right h-auto py-2">
																				{item[1].evaluationData[key]}
																			</TableCell>
																		</TableRow>
																	);
																}
															)}
														</TableBody>
													</Table>
												</HoverCardContent>
											)}
										</HoverCard>
									</div>
								</TableRow>
							))}
							<TableRow>
								<div className="flex flex-col w-full h-full relative">
									<p className="font-medium p-4 bg-stone-200 dark:bg-stone-800 sticky top-[48px] z-20">
										<span className={`${index === 0 ? "" : "opacity-0"}`}>
											Provider response
										</span>
									</p>
									<JsonViewer
										value={omit(evaluatedResponse.data[index]?.[1], [
											"evaluationData",
										])}
										className="overflow-auto p-3 h-[400px] !rounded-none"
										enableClipboard={false}
										displayDataTypes={false}
										displaySize={false}
										theme="dark"
									/>
								</div>
							</TableRow>
						</>
					) : (
						<TableRow>
							<div className="flex flex-col w-full h-full items-center justify-center p-4 text-error text-center">
								{evaluatedResponse.data?.[index]?.[0] ||
									"Some error occurred while evaluating the provider"}
							</div>
						</TableRow>
					)
				) : (
					<TableRow>
						<div className="flex flex-col w-full h-full items-center justify-center p-4 group">
							{evaluatedResponse.isLoading ? (
								<FlaskRoundIcon className="w-32 h-32 text-stone-200 dark:text-stone-700" />
							) : (
								<>
									<Image
										src={provider.logoDark}
										width={200}
										height={40}
										alt={provider.title}
										className="dark:hidden opacity-50 group-hover:opacity-100"
									/>
									<Image
										src={provider.logo}
										width={200}
										height={40}
										alt={provider.title}
										className="hidden dark:block opacity-50 group-hover:opacity-100"
									/>
								</>
							)}
						</div>
					</TableRow>
				)}
			</TableBody>
		</Table>
	);
}
