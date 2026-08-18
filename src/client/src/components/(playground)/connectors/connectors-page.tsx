"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Cable, Lock, Plug, Search } from "lucide-react";
import FeatureAccess from "@/components/rbac/feature-access";
import DataSourcesPage from "@/components/(playground)/telemetry-source/data-sources-page";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import getMessage from "@/constants/messages";
import { fetchProjectList, changeActiveProject } from "@/helpers/client/project";
import { getCurrentOrganisation } from "@/selectors/organisation";
import { getCurrentProject, getProjectList } from "@/selectors/project";
import { useRootStore } from "@/store";
import { isVisibleConnectorType } from "@/lib/platform/connectors/visible-types";

type ConnectorType = {
	type: string;
	displayName: string;
	description?: string;
	category?: string;
	icon?: string;
	declaredSignals?: string[];
	plan?: "free" | "enterprise";
	locked?: boolean;
};

export default function ConnectorsPage() {
	const messages = getMessage();
	const currentOrg = useRootStore(getCurrentOrganisation);
	const projects = useRootStore(getProjectList) || [];
	const currentProject = useRootStore(getCurrentProject);
	const project = useMemo(
		() =>
			currentProject ||
			projects.find((item) => item.isCurrent) ||
			projects[0],
		[currentProject, projects]
	);
	const [types, setTypes] = useState<ConnectorType[]>([]);
	const [requestedType, setRequestedType] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const connectorGroups = useMemo(() => {
		const groups = new Map<string, ConnectorType[]>();
		for (const connector of types) {
			const key = connector.category || "datasource";
			const group = groups.get(key) || [];
			group.push(connector);
			groups.set(key, group);
		}
		return Array.from(groups, ([key, connectors]) => ({
			key,
			label: key.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
			connectors,
		}));
	}, [types]);
	const filteredConnectorGroups = useMemo(() => {
		const query = search.trim().toLowerCase();
		if (!query) return connectorGroups;
		return connectorGroups
			.map((group) => ({
				...group,
				connectors: group.connectors.filter((connector) =>
					[
						connector.displayName,
						connector.type,
						connector.category,
						connector.description,
						...(connector.declaredSignals || []),
					]
						.filter(Boolean)
						.some((value) => String(value).toLowerCase().includes(query))
				),
			}))
			.filter((group) => group.connectors.length > 0);
	}, [connectorGroups, search]);

	const loadConnectors = () => {
		if (!project?.id) return;
		setLoading(true);
		setLoadError(null);
		setTypes([]);
		fetch("/api/connectors/types")
			.then(async (typeResponse) => {
				if (!typeResponse.ok) throw new Error("Failed to list connector types");
				const typeData = await typeResponse.json();
				setTypes((typeData.types || []).filter((type: ConnectorType) => isVisibleConnectorType(type.type)));
			})
			.catch((error: unknown) => setLoadError(error instanceof Error ? error.message : messages.DATA_SOURCE_LOAD_FAILED))
			.finally(() => setLoading(false));
	};

	useEffect(() => {
		if (currentOrg?.id) void fetchProjectList(currentOrg.id);
	}, [currentOrg?.id]);

	useEffect(() => {
		if (project?.id && currentProject?.id !== project.id) {
			void changeActiveProject(project.id);
		}
	}, [currentProject?.id, project?.id]);

	useEffect(() => { loadConnectors(); }, [project?.id]);

	return (
		<div className="flex h-full w-full flex-col overflow-auto text-stone-700 dark:text-stone-300">
			<FeaturePageHeader
				eyebrow={messages.PROJECT}
				title={messages.GLOBAL_CONNECTORS}
				icon={<Plug className="h-4 w-4" />}
				tone="border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900/70 dark:bg-cyan-950/40 dark:text-cyan-300"
				actions={
					project?.id ? (
						<Button
							size="sm"
							className="gap-1.5"
							disabled={loading || types.length === 0}
							onClick={() => setRequestedType("")}
						>
							<Cable className="h-3.5 w-3.5" />
							{messages.ADD_CONNECTOR}
						</Button>
					) : null
				}
			/>

			<FeatureAccess access="connectors.read" requireProject>
				<main className="flex flex-col gap-4 p-4">
					{loadError && <div className="rounded-lg border border-error/30 bg-error/5 p-4 dark:bg-error/10"><p className="text-sm font-semibold text-error">{messages.DATA_SOURCE_LOAD_FAILED}</p><p className="mt-1 text-xs text-muted-foreground">{loadError}</p><Button size="sm" variant="outline" className="mt-3" onClick={loadConnectors}>{messages.DATA_SOURCE_RETRY}</Button></div>}

					<section className="border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
							<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
							<div>
								<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
									{messages.CONNECTOR_CATALOG}
								</h2>
								<p className="mt-1 text-xs text-muted-foreground">
									{messages.CONNECTOR_CATALOG_DESCRIPTION}
								</p>
							</div>
								<Button asChild variant="outline" size="sm">
								<Link href={`/organisation/project/${project?.id || ""}/connectors`}>
									{messages.MANAGE_CONNECTORS}
									<ArrowRight className="ml-1.5 h-3.5 w-3.5" />
								</Link>
								</Button>
							</div>
							<div className="relative mb-4 max-w-sm">
								<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
								<Input
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									placeholder={messages.CONNECTOR_SEARCH_PLACEHOLDER}
									aria-label={messages.CONNECTOR_SEARCH_PLACEHOLDER}
									className="h-9 pl-9"
								/>
							</div>

						{loading ? (
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
								{Array.from({ length: 8 }).map((_, index) => (
									<div
										key={index}
										className="space-y-3 rounded-md border border-stone-200 p-3 dark:border-stone-800"
									>
										<div className="flex items-center gap-2">
											<Skeleton className="h-8 w-8 rounded" />
											<div className="flex-1 space-y-2">
												<Skeleton className="h-3 w-3/4" />
												<Skeleton className="h-2.5 w-1/2" />
											</div>
										</div>
										<Skeleton className="h-8 w-full" />
										<Skeleton className="h-7 w-20" />
									</div>
								))}
							</div>
						) : (
							<>
							<Accordion
								type="multiple"
								defaultValue={filteredConnectorGroups.map((group) => group.key)}
								className="space-y-1"
							>
								{filteredConnectorGroups.map((group) => (
									<AccordionItem
										key={group.key}
										value={group.key}
										className="border-stone-200 dark:border-stone-800"
									>
										<AccordionTrigger className="py-3 text-sm font-semibold text-stone-950 hover:no-underline dark:text-stone-50">
											<span className="flex items-center gap-2">
												{group.label}
												<Badge variant="outline" className="text-[10px] font-normal">{group.connectors.length}</Badge>
											</span>
										</AccordionTrigger>
										<AccordionContent className="pb-3">
											<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
												{group.connectors.map((type) => (
									<div
										key={`${type.category}:${type.type}`}
										className="flex min-h-[190px] flex-col rounded-md border border-stone-200 p-3 dark:border-stone-800"
									>
										<div className="flex items-center gap-3">
											<Image
												src={type.icon || "/images/connect.svg"}
												alt=""
												width={32}
												height={32}
												className="h-8 w-8 shrink-0 object-contain"
											/>
												<div className="min-w-0">
													<div className="flex items-center gap-1.5">
														<p className="truncate text-sm font-medium text-stone-950 dark:text-stone-50">
															{type.displayName}
														</p>
														{type.plan === "enterprise" ? (
															<Badge className="shrink-0 bg-amber-100 px-1.5 py-0 text-[9px] font-semibold text-amber-800 hover:bg-amber-100 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-950/60">
																{messages.CONNECTOR_PREMIUM}
															</Badge>
														) : null}
														{type.locked ? (
															<span
																className="inline-flex shrink-0 text-amber-700 dark:text-amber-300"
																title={messages.CONNECTOR_LOCKED}
																aria-label={messages.CONNECTOR_LOCKED}
															>
																<Lock className="h-3.5 w-3.5" />
															</span>
														) : null}
													</div>
												<p className="text-[11px] text-muted-foreground">
													{type.type}
												</p>
											</div>
										</div>

										<p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">
											{type.description || type.type}
										</p>

										<div className="mt-auto flex flex-wrap gap-1.5 pt-4">
											<Badge variant="secondary" className="text-[10px]">
												{type.category || "datasource"}
											</Badge>
											{type.declaredSignals?.map((signal) => (
												<Badge key={signal} variant="outline" className="text-[10px]">
													{signal}
												</Badge>
											))}
										</div>

										<Button
											size="sm"
											variant="outline"
											className="mt-3 w-full"
											disabled={type.locked}
											title={type.locked ? messages.CONNECTOR_LOCKED : undefined}
											onClick={() => setRequestedType(type.type)}
										>
											{type.locked ? (
												<>
													<Lock className="mr-1.5 h-3.5 w-3.5" />
													{messages.CONNECTOR_LOCKED_ACTION}
												</>
											) : (
												messages.ADD_CONNECTOR
											)}
										</Button>
									</div>
												))}
											</div>
										</AccordionContent>
									</AccordionItem>
								))}
							</Accordion>
							{!filteredConnectorGroups.length && (
								<p className="py-10 text-center text-sm text-muted-foreground">{messages.CONNECTOR_NO_MATCHES}</p>
							)}
							</>
						)}
					</section>

					{project?.id ? (
						<DataSourcesPage
							projectId={project.id}
							showRouting={false}
							openType={requestedType}
							onOpenTypeHandled={() => setRequestedType(null)}
						/>
					) : null}
				</main>
			</FeatureAccess>
		</div>
	);
}

