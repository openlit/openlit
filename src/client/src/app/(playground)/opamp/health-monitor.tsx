"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Activity, AlertTriangle, CheckCircle, Clock, Cpu, LucideIcon, Server, XCircle } from "lucide-react"
import { Agent, OpampFilters, OpampFilterType } from "@/types/opamp";
import { MouseEventHandler, useMemo, useState } from "react";
import Link from "next/link";

const AnimateMetrics = () => <div className="h-2 w-2 my-2 rounded-full dark:bg-stone-700 bg-stone-200 rounded animate-pulse" />;

const FilterCard = ({ title, icon, data, isLoading, onClick, isSelected, selectionAllowed = true }: { title: string, icon: LucideIcon, data: string | number, isLoading: boolean, onClick?: MouseEventHandler<HTMLDivElement>, isSelected: boolean, selectionAllowed?: boolean }) => {
  const Icon = icon;

  return (
    <div className={`flex flex-row items-center justify-center gap-4 text-stone-900 dark:text-stone-100 border-r last:border-r-0 border-gray-200 dark:border-gray-800 p-4 shrink-0 ${isSelected ? "bg-primary/20" : ""} ${selectionAllowed ? "cursor-pointer  hover:bg-primary/20" : "cursor-default"}`} onClick={selectionAllowed ? onClick : undefined}>
      <Icon className="h-4 w-4 text-muted-foreground" />
      <p className="text-sm font-medium">{title} </p>
      {
        isLoading ? (
          <AnimateMetrics />
        ) : (
          <p className="text-md font-bold text-primary">{data}</p>
        )
      }
    </div>
  )
};

type HealthMonitorProps = {
  agents: Agent[];
  isLoading: boolean;
}

export function HealthMonitor({ agents, isLoading }: HealthMonitorProps) {
  const [filters, setFilters] = useState<OpampFilters>({ type: OpampFilterType.ALL });
  const healthyAgents = agents.filter((agent) => agent.Status.health.healthy)
  const unhealthyAgents = agents.filter((agent) => !agent.Status.health.healthy)

  const totalComponents = agents.reduce((total, agent) => {
    return total + Object.keys(agent.Status.health.component_health_map || {}).length
  }, 0)

  const healthyComponents = agents.reduce((total, agent) => {
    return total + Object.values(agent.Status.health.component_health_map || {}).filter((comp) => comp.healthy).length
  }, 0)

  const getServiceName = (agent: Agent) => {
    return (
      agent.Status.agent_description.identifying_attributes.find((attr) => attr.key === "service.name")?.value.Value
        .StringValue || "Unknown"
    )
  }

  const updateFilter = (f: OpampFilterType) => {
    setFilters(filt => ({
      ...filt,
      type: f,
    }))
  }

  const getAttributeValue = (attributes: any[], key: string) => {
    return attributes.find((attr) => attr.key === key)?.value.Value.StringValue || "N/A"
  }

  const formatUptime = (startTime: string) => {
    const start = new Date(startTime)
    const now = new Date()
    const diff = now.getTime() - start.getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    return `${hours}h ${minutes}m`
  }

  const filteredAgents = useMemo(() => {
    if (filters.type === OpampFilterType.ALL) {
      return agents;
    }

    return agents.filter((agent) => !!agent.Status.health.healthy === (filters.type === OpampFilterType.HEALTHY));
  }, [agents, filters]);

  return (
    <div className="flex grow flex-col w-full border border-gray-200">
      <div className="grid grid-cols-4 border-b border-gray-200 dark:border-gray-800 w-full">
        <FilterCard
          title="Total Agents"
          icon={Activity}
          data={agents.length}
          isLoading={isLoading}
          onClick={() => updateFilter(OpampFilterType.ALL)}
          isSelected={filters.type === OpampFilterType.ALL}
        />
        <FilterCard
          title="Healthy Agents"
          icon={CheckCircle}
          data={healthyAgents.length}
          isLoading={isLoading}
          onClick={() => updateFilter(OpampFilterType.HEALTHY)}
          isSelected={filters.type === OpampFilterType.HEALTHY}
        />
        <FilterCard
          title="Unhealthy Agents"
          icon={XCircle}
          data={unhealthyAgents.length}
          isLoading={isLoading}
          onClick={() => updateFilter(OpampFilterType.UNHEALTHY)}
          isSelected={filters.type === OpampFilterType.UNHEALTHY}
        />
        <FilterCard
          title="Component Health"
          icon={AlertTriangle}
          data={`${healthyComponents}/${totalComponents}`}
          isLoading={isLoading}
          isSelected={false}
          selectionAllowed={false}
        />
      </div>
      <div className="grid grid-cols-3 p-4 gap-4">
        {filteredAgents.map((agent) => {
          const serviceName = getAttributeValue(agent.Status.agent_description.identifying_attributes, "service.name")
          const serviceVersion = getAttributeValue(
            agent.Status.agent_description.identifying_attributes,
            "service.version",
          )
          const hostName = getAttributeValue(agent.Status.agent_description.non_identifying_attributes, "host.name")
          const hostArch = getAttributeValue(agent.Status.agent_description.non_identifying_attributes, "host.arch")
          const osDescription = getAttributeValue(
            agent.Status.agent_description.non_identifying_attributes,
            "os.description",
          )

          return (
            <Link key={agent.InstanceIdStr} href={`/opamp/${agent.InstanceIdStr}`}>
              <Card className={`shadow-sm hover:shadow-lg transition-shadow ${agent.Status.health.healthy ? "shadow-green-500 hover:shadow-green-500" : "shadow-red-500 hover:shadow-red-500"}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-base">{serviceName}</CardTitle>
                    </div>
                    <Badge variant={agent.Status.health.healthy ? "default" : "destructive"} className={`${agent.Status.health.healthy ? "bg-green-500 text-white" : "bg-red-500 text-white"}`}>
                      {agent.Status.health.status || "StatusError"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">{agent.InstanceIdStr}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Version</p>
                      <p className="font-medium">{serviceVersion}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Architecture</p>
                      <p className="font-medium">{hostArch}</p>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs">
                      <Cpu className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Host:</span>
                      <span className="font-medium">{hostName}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Uptime:</span>
                      <span className="font-medium">{formatUptime(agent.StartedAt)}</span>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    <p className="truncate">{osDescription}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  );
}
