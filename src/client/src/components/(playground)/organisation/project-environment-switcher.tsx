"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import getMessage from "@/constants/messages";

export default function ProjectEnvironmentSwitcher({ value, onChange }: { value: string; onChange: (value: string) => void }) {
	const messages = getMessage();
	const [environments, setEnvironments] = useState<string[]>(["production"]);
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [saving, setSaving] = useState(false);

	const load = async () => {
		const response = await fetch("/api/project/environment");
		if (!response.ok) return;
		const body = await response.json();
		const names = (body.environments || []).map((item: { name: string }) => item.name);
		setEnvironments(Array.from(new Set(["production", ...names])).sort());
	};

	useEffect(() => {
		if (typeof fetch !== "undefined") void load();
	}, []);

	const create = async () => {
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
			const created = body.environment.name;
			await load();
			onChange(created);
			setName("");
			setOpen(false);
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="flex items-center gap-1.5">
			<DropdownMenu>
				<DropdownMenuTrigger asChild><Button type="button" variant="outline" size="sm" className="h-8 min-w-36 justify-between border-stone-300 bg-white text-xs dark:border-stone-700 dark:bg-stone-950">{value}<span className="ml-2 text-muted-foreground">⌄</span></Button></DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-56">
					<DropdownMenuLabel>{messages.CONNECTOR_ENVIRONMENT}</DropdownMenuLabel>
					<DropdownMenuSeparator />
					{environments.map((environment) => <DropdownMenuItem key={environment} onSelect={() => onChange(environment)}>{environment}</DropdownMenuItem>)}
					<DropdownMenuSeparator />
					<DropdownMenuItem onSelect={() => setOpen(true)}><Plus className="mr-2 h-3.5 w-3.5" />Create environment</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent>
					<DialogHeader><DialogTitle>Create environment</DialogTitle><DialogDescription>Environments group ClickHouse databases and observability connectors inside this project.</DialogDescription></DialogHeader>
					<div className="space-y-2"><Label htmlFor="new-project-environment">Environment name</Label><Input id="new-project-environment" value={name} onChange={(event) => setName(event.target.value.toLowerCase())} placeholder="staging" /></div>
					<DialogFooter><Button type="button" onClick={create} disabled={saving || !name.trim()}>{saving ? "Creating…" : "Create environment"}</Button></DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
