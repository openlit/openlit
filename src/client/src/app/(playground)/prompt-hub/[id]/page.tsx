"use client";
import PromptForm from "@/components/(playground)/prompt-hub/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { getPingStatus } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { jsonParse } from "@/utils/json";
import { objectEntries } from "@/utils/object";
import { unescapeString } from "@/utils/string";
import { format, formatDistance } from "date-fns";
import { CalendarDays, CloudDownload, Rocket } from "lucide-react";
import Link from "next/link";
import {
	useParams,
	useSearchParams,
	useRouter,
	usePathname,
} from "next/navigation";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";

export default function PromptHub() {
	const pingStatus = useRootStore(getPingStatus);
	const pathName = usePathname();
	const params = useParams();
	const router = useRouter();
	const searchParams = useSearchParams();
	const version = searchParams.get("version") || undefined;
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();
	const fetchData = useCallback(async () => {
		fireRequest({
			requestType: "GET",
			url: `/api/prompt/get/${params.id}${
				version ? "?version=" + version : ""
			}`,
			failureCb: (err?: string) => {
				toast.error(err || `Cannot connect to server!`, {
					id: "prompt-hub",
				});
			},
		});
	}, [version]);

	const successCallback = useCallback(async () => {
		if (version) {
			router.replace(pathName);
		} else {
			fetchData();
		}
	}, [version, pathName]);

	useEffect(() => {
		if (pingStatus === "success") fetchData();
	}, [version, pingStatus]);

	const updatedData = (data as any)?.data?.[0];

	if (!isFetched || (!updatedData?.promptId && isLoading)) {
		return (
			<div className="flex flex-col w-full h-full overflow-hidden gap-6 items-center justify-center">
				<div className="h-4 w-1/5 bg-secondary/[0.9] rounded" />
				<div className="h-4 w-3/5 bg-secondary/[0.9] rounded" />
				<div className="h-4 w-2/3 bg-secondary/[0.9] rounded" />
				<div className="h-4 w-1/3 bg-secondary/[0.9] rounded" />
			</div>
		);
	}

	if (!updatedData || !updatedData?.promptId) {
		return (
			<div className="flex w-full h-full overflow-hidden items-center justify-center text-stone-600">
				No such prompt exists!
			</div>
		);
	}

	if (
		updatedData?.promptId &&
		version &&
		updatedData.version !== version &&
		!isLoading
	) {
		return (
			<div className="flex w-full h-full overflow-hidden items-center justify-center text-stone-600">
				No such version of the prompt{" "}
				<span className="bg-secondary text-primary px-2 text-sm mx-3">
					{" "}
					{updatedData.name}{" "}
				</span>{" "}
				exists!
			</div>
		);
	}

	// const prompt = updatedData.versions[0].prompt;
	const tags = jsonParse(updatedData.versions[0].tags) || [];
	const metaProperties =
		jsonParse(updatedData.versions[0].metaProperties) || {};
	const metaPropertiesMap = objectEntries(metaProperties);

	const latestVersion = updatedData.versions.find(
		(version: any) => version.status !== "DRAFT"
	);
	const draftVersion = updatedData.versions.find(
		(version: any) => version.status === "DRAFT"
	);

	return (
		<div className="grid grid-cols-3 w-full h-full overflow-hidden gap-6">
			<div className="flex flex-col space-y-1 col-span-2 gap-6 overflow-auto">
				<div className="flex w-full">
					<div className="flex flex-col grow">
						<div className="flex items-center text-2xl font-semibold text-stone-800 dark:text-stone-200 gap-4">
							<h1>{updatedData.name}</h1>
							{updatedData.status === "DRAFT" && (
								<Badge
									variant="outline"
									className="transition-none text-stone-500 dark:bg-stone-800 dark:text-stone-400"
								>
									Draft
								</Badge>
							)}
						</div>
						<div className="flex items-center text-stone-800 dark:text-stone-200 opacity-60 gap-8">
							<div className="flex items-center">
								<Rocket className="mr-2 h-4 w-4" />
								<span className="text-xs text-muted-foreground">
									{updatedData.version}
								</span>
							</div>
							<div className="flex items-center">
								<CalendarDays className="mr-2 h-4 w-4" />
								<span className="text-xs text-muted-foreground">
									Published on {format(updatedData.updatedAt, "MMM do, y")}
								</span>
							</div>
						</div>
					</div>
					<div className="flex items-center">
						{updatedData.versionId === draftVersion?.versionId ? (
							<PromptForm
								versionData={draftVersion}
								successCallback={successCallback}
							>
								<Button
									variant="secondary"
									className="bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100 px-8 py-2 h-auto py-1 rounded-sm"
								>
									Publish Version
								</Button>
							</PromptForm>
						) : null}
						{updatedData.version === latestVersion?.version &&
						!draftVersion?.version ? (
							<PromptForm
								versionData={latestVersion}
								successCallback={successCallback}
							>
								<Button
									variant="secondary"
									className="bg-primary hover:bg-primary dark:bg-primary dark:hover:bg-primary text-stone-100 dark:text-stone-100 px-8 py-2 h-auto py-1 rounded-sm"
								>
									Create New Version
								</Button>
							</PromptForm>
						) : null}
					</div>
				</div>
				{tags.length > 0 ? (
					<div className="flex gap-2">
						{tags.map((tag: string) => (
							<Badge
								key={tag}
								className="rounded-pill bg-stone-500 transition-none"
							>
								{tag}
							</Badge>
						))}
					</div>
				) : null}
				<div className="flex flex-col w-full">
					<h3 className="text-sm text-stone-500 mb-2 dark:text-stone-400">
						Prompt
					</h3>
					<div className="flex bg-stone-100 dark:bg-stone-900 text-stone-500 dark:text-stone-300 p-4 gap-8 whitespace-pre-wrap">
						{unescapeString(updatedData.prompt)}
					</div>
				</div>
				{metaPropertiesMap.length > 0 ? (
					<div className="flex flex-col gap-2">
						<h3 className="text-sm text-stone-500 dark:text-stone-400">
							Meta Properties
						</h3>
						<div className="rounded-sm border border-stone-200 dark:border-stone-700">
							<Table>
								<TableHeader className="bg-stone-100 dark:bg-stone-800">
									<TableRow>
										<TableHead className="h-8 text-stone-400">Key</TableHead>
										<TableHead className="h-8 text-stone-400">Value</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{metaPropertiesMap.map(([itemKey, value]: string[]) => (
										<TableRow
											key={itemKey}
											className="bg-stone-50 dark:bg-stone-900 data-[state=selected]:bg-stone-50 dark:data-[state=selected]:bg-stone-900 text-stone-600 dark:text-stone-300"
										>
											<TableCell className="p-0 px-4 align-middle font-medium h-10">
												{itemKey}
											</TableCell>
											<TableCell className="p-0 px-4 align-middle h-10">
												{value}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					</div>
				) : null}
			</div>
			<div className="flex flex-col w-full space-y-1 p-4 bg-stone-100 dark:bg-stone-900 gap-4 overflow-hidden">
				<h2 className="text-stone-700 dark:text-stone-300">Version</h2>
				<div className="flex flex-col w-full gap-4 overflow-auto">
					{updatedData.versions.map((versionItem: any) => (
						<Link
							href={`/prompt-hub/${params.id}${
								versionItem.status === "DRAFT"
									? ""
									: `?version=${versionItem.version}`
							}`}
							key={versionItem.versionId}
							className="flex w-full items-center text-sm gap-2 text-stone-500"
						>
							<div className="flex w-min gap-2">
								{versionItem.version}

								{versionItem.versionId === latestVersion?.versionId ? (
									<Badge
										variant="outline"
										className="rounded-pill text-xs text-stone-500 dark:text-stone-400 dark:border-stone-600 font-light transition-none"
									>
										latest
									</Badge>
								) : null}
								{versionItem.versionId === draftVersion?.versionId ? (
									<Badge
										variant="outline"
										className="rounded-pill text-xs text-stone-500 dark:text-stone-400 dark:border-stone-600 font-light transition-none"
									>
										Draft
									</Badge>
								) : null}
							</div>
							<hr className="flex-1 border-stone-200 dark:border-stone-700 " />
							<div className="flex gap-1 text-xs items-center shrink-0">
								<CloudDownload className="w-4" />
								{versionItem.totalDownloads}
							</div>
							...
							<div className="w-max">
								{formatDistance(
									new Date(versionItem.updatedAt),
									new Date().toISOString().slice(0, -1),
									{
										addSuffix: true,
									}
								)}
							</div>
						</Link>
					))}
				</div>
			</div>
		</div>
	);
}
