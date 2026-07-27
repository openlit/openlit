"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Cable, CheckCircle2, Plug } from "lucide-react";
import FeatureAccess from "@/components/rbac/feature-access";
import DataSourcesPage from "@/components/(playground)/telemetry-source/data-sources-page";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import getMessage from "@/constants/messages";
import { fetchProjectList, changeActiveProject } from "@/helpers/client/project";
import { getCurrentOrganisation } from "@/selectors/organisation";
import { getCurrentProject, getProjectList } from "@/selectors/project";
import { useRootStore } from "@/store";

type ConnectorSummary = {
	id: string;
	name: string;
	type: string;
	environment?: string;
	category?: string;
	icon?: string;
};

type ConnectorType = {
	type: string;
	displayName: string;
	description?: string;
	category?: string;
	icon?: string;
	declaredSignals?: string[];
	plan?: "free" | "enterprise";
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
	const [connected, setConnected] = useState<ConnectorSummary[]>([]);
	const [types, setTypes] = useState<ConnectorType[]>([]);
	const [requestedType, setRequestedType] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (currentOrg?.id) void fetchProjectList(currentOrg.id);
	}, [currentOrg?.id]);

	useEffect(() => {
		if (project?.id && currentProject?.id !== project.id) {
			void changeActiveProject(project.id);
		}
	}, [currentProject?.id, project?.id]);

	useEffect(() => {
		let active = true;
		if (!project?.id) {
			setLoading(false);
			return () => {
				active = false;
			};
		}

		setLoading(true);
		setConnected([]);
		setTypes([]);

		Promise.all([
			fetch("/api/connectors"),
			fetch("/api/connectors/types"),
			fetch("/api/db-config"),
		])
			.then(async ([connectorResponse, typeResponse, databaseResponse]) => {
				if (!active) return;

				const connectorData = connectorResponse.ok
					? await connectorResponse.json()
					: {};
				const typeData = typeResponse.ok ? await typeResponse.json() : {};
				const databases = databaseResponse.ok
					? await databaseResponse.json()
					: [];

				setConnected([
					...(connectorData.connectors || []),
					...(Array.isArray(databases) ? databases : []).map(
						(database: {
							id: string;
							name: string;
							environment?: string;
						}) => ({
							id: `database:${database.id}`,
							name: database.name,
							type: "clickhouse",
							environment: database.environment,
							icon: "/images/connectors/clickhouse.svg",
						})
					),
				]);
				setTypes(typeData.types || []);
			})
			.catch(() => undefined)
			.finally(() => {
				if (active) setLoading(false);
			});

		return () => {
			active = false;
		};
	}, [project?.id]);

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
							onClick={() => setRequestedType(types[0]?.type || null)}
						>
							<Cable className="h-3.5 w-3.5" />
							{messages.ADD_CONNECTOR}
						</Button>
					) : null
				}
			/>

			<FeatureAccess access="connectors.read" requireProject>
				<main className="flex flex-col gap-4 p-4">
					<ConnectedConnectorsSection
						connected={connected}
						loading={loading}
						projectName={project?.name || messages.NO_PROJECT}
						messages={messages}
					/>

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
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
								{types.map((type) => (
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
																Premium
															</Badge>
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
											onClick={() => setRequestedType(type.type)}
										>
											{messages.ADD_CONNECTOR}
										</Button>
									</div>
								))}
							</div>
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

function ConnectedConnectorsSection({
	connected,
	loading,
	projectName,
	messages,
}: {
	connected: ConnectorSummary[];
	loading: boolean;
	projectName: string;
	messages: ReturnType<typeof getMessage>;
}) {
	return (
		<section className="border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
			<div className="mb-4 flex items-center justify-between gap-3">
				<div>
					<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
						{messages.CONNECTED_CONNECTORS}
					</h2>
					<p className="mt-1 text-xs text-muted-foreground">{projectName}</p>
				</div>
				{loading ? (
					<Skeleton className="h-5 w-8 rounded-full" />
				) : (
					<Badge variant="outline">{connected.length}</Badge>
				)}
			</div>

			{loading ? (
				<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
					{Array.from({ length: 3 }).map((_, index) => (
						<div
							key={index}
							className="flex items-center gap-3 rounded-md border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/60"
						>
							<Skeleton className="h-7 w-7 rounded" />
							<div className="flex-1 space-y-2">
								<Skeleton className="h-3 w-3/5" />
								<Skeleton className="h-2.5 w-2/5" />
							</div>
						</div>
					))}
				</div>
			) : connected.length ? (
				<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
					{connected.map((connector) => (
						<div
							key={connector.id}
							className="flex items-center justify-between gap-2 rounded-md border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/60"
						>
							<Image
								src={connector.icon || "/images/connect.svg"}
								alt=""
								width={28}
								height={28}
								className="h-7 w-7 shrink-0 object-contain"
							/>
							<div className="min-w-0">
								<p className="truncate text-sm font-medium text-stone-950 dark:text-stone-50">
									{connector.name}
								</p>
								<p className="text-xs text-muted-foreground">
									{connector.type} · {connector.environment || "production"}
								</p>
							</div>
							<CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-emerald-600" />
						</div>
					))}
				</div>
			) : (
				<p className="text-sm text-muted-foreground">
					{messages.NO_CONNECTED_CONNECTORS}
				</p>
			)}
		</section>
	);
}
