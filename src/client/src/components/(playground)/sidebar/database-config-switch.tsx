"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Cable, ChevronDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { fetchDatabaseConfigList, changeActiveDatabaseConfig } from "@/helpers/client/database-config";
import { getDatabaseConfigList } from "@/selectors/database-config";
import { getCurrentProject, getCurrentProjectEnvironment } from "@/selectors/project";
import { useRootStore } from "@/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { headerScopeTriggerClassName } from "../header-scope-pill";
import getMessage from "@/constants/messages";

type Environment = { name: string };

export default function DatabaseConfigSwitch({
  className,
  contentAlign = "start",
  contentSide = "right",
}: {
  className?: string;
  contentAlign?: "center" | "end" | "start";
  contentSide?: "bottom" | "left" | "right" | "top";
}) {
  const messages = getMessage();
  const router = useRouter();
  const posthog = usePostHog();
  const project = useRootStore(getCurrentProject);
  const currentEnvironment = useRootStore(getCurrentProjectEnvironment);
  const databases = useRootStore(getDatabaseConfigList) || [];
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [persistedEnvironment, setPersistedEnvironment] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const activeDatabase = databases.find((item) => !!item.isCurrent);
  const environmentStorageKey = project?.id ? `openlit:environment:${project.id}` : "";
  const selectedEnvironment = currentEnvironment || persistedEnvironment || activeDatabase?.environment || "production";

  useEffect(() => {
    if (!environmentStorageKey) return;
    const stored = window.localStorage.getItem(environmentStorageKey);
    const environment = stored || activeDatabase?.environment || "production";
    setPersistedEnvironment(environment);
    useRootStore.getState().project.setCurrentEnvironment(environment);
  }, [activeDatabase?.environment, environmentStorageKey]);

  const loadEnvironments = async () => {
    const response = await fetch("/api/project/environment");
    if (!response.ok) return;
    const body = await response.json();
    setEnvironments(
      Array.from(
        new Set<string>([
          "production",
          ...(body.environments || []).map((item: Environment) => item.name),
          ...databases.map((item) => item.environment || "production"),
        ])
      )
        .sort()
        .map((environment) => ({ name: environment }))
    );
  };

  useEffect(() => {
    void fetchDatabaseConfigList(() => {});
    void loadEnvironments();
  }, [project?.id]);

  const databasesByEnvironment = useMemo(
    () =>
      databases.reduce<Record<string, typeof databases>>((acc, database) => {
        const environment = database.environment || "production";
        (acc[environment] ||= []).push(database);
        return acc;
      }, {}),
    [databases]
  );

  const selectEnvironment = async (environment: string) => {
    if (environmentStorageKey) {
      window.localStorage.setItem(environmentStorageKey, environment);
      setPersistedEnvironment(environment);
    }
    useRootStore.getState().project.setCurrentEnvironment(environment);
    const target = databasesByEnvironment[environment]?.[0];
    if (target && target.id !== activeDatabase?.id) {
		await changeActiveDatabaseConfig(target.id, () => {
			posthog?.capture("environment_default_database_selected", {
				environment,
				database_config_id: target.id,
			});
		}, { silent: true });
    }

		window.dispatchEvent(new CustomEvent("openlit:environment-changed", { detail: { environment } }));
		router.refresh();
	};

  const createEnvironment = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/project/environment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) return;
      const body = await response.json();
      await loadEnvironments();
      await selectEnvironment(body.environment.name);
      setName("");
      setCreateOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className={cn("flex items-center gap-1", className)}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={headerScopeTriggerClassName}>
              <span className="min-w-0 truncate">{selectedEnvironment}</span>
              <ChevronDown className="size-3 shrink-0 opacity-50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64" side={contentSide} align={contentAlign}>
            <DropdownMenuLabel>Environments</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {environments.map((environment) => {
              return (
                <DropdownMenuItem
                  key={environment.name}
                  onSelect={() => void selectEnvironment(environment.name)}
                >
                  <span className="font-medium">{environment.name}</span>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuItem asChild>
              <Link href={project?.id ? `/organisation/project/${project.id}/environments` : "/organisation"}>
                <Cable className="mr-2 size-3.5" />{messages.PROJECT_ENVIRONMENTS}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
              <Plus className="mr-2 size-3.5" />
              Create environment
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create environment</DialogTitle>
            <DialogDescription>
              Environments group the ClickHouse database and telemetry connectors used by this project.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="global-new-environment">Environment name</Label>
            <Input
              id="global-new-environment"
              value={name}
              onChange={(event) => setName(event.target.value.toLowerCase())}
              placeholder="staging"
            />
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => void createEnvironment()} disabled={saving || !name.trim()}>
              {saving ? "Creating…" : "Create environment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
