"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Activity, FileText } from "lucide-react"
import { Agent } from "@/types/opamp"
import YAMLDiagramVisualizer from "./yaml-visualizer"

interface AgentDetailProps {
  agent: Agent,
  fetchAgentInfo: () => void
}

export function AgentDetail({ agent, fetchAgentInfo }: AgentDetailProps) {
  const getAttributeValue = (attributes: any[], key: string) => {
    return attributes.find((attr) => attr.key === key)?.value.Value.StringValue || "N/A"
  }

  return (
    <div className="space-y-6 overflow-auto w-full flex flex-col grow">

      <Tabs defaultValue="overview" className="space-y-4 grow flex flex-col h-full">
        <div className="flex">
          <TabsList className="self-start">
            <TabsTrigger value="overview">
              <Activity className="mr-2 h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="config">
              <FileText className="mr-2 h-4 w-4" />
              Configuration
            </TabsTrigger>
          </TabsList>
          <div className="flex gap-2 grow justify-end items-center">
              <p className="text-muted-foreground">Health Status</p>
              <Badge variant={agent.Status.health.healthy ? "default" : "destructive"}>
                {agent.Status.health.status}
              </Badge>
          </div>
        </div>

        <TabsContent value="overview" className="space-y-4 grow">
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Service Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-muted-foreground">Name</p>
                    <p className="font-medium">
                      {getAttributeValue(agent.Status.agent_description.identifying_attributes, "service.name")}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Version</p>
                    <p className="font-medium">
                      {getAttributeValue(agent.Status.agent_description.identifying_attributes, "service.version")}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Host Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-muted-foreground">Host Name</p>
                    <p className="font-medium">
                      {getAttributeValue(agent.Status.agent_description.non_identifying_attributes, "host.name")}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Architecture</p>
                    <p className="font-medium">
                      {getAttributeValue(agent.Status.agent_description.non_identifying_attributes, "host.arch")}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Runtime Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Started At</p>
                  <p className="font-medium">{new Date(agent.StartedAt).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Health Status</p>
                  <Badge variant={agent.Status.health.healthy ? "default" : "destructive"}>
                    {agent.Status.health.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-muted-foreground">OS</p>
                  <p className="font-medium">
                    {getAttributeValue(agent.Status.agent_description.non_identifying_attributes, "os.description")}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
              <CardHeader>
                <CardTitle className="text-base">Identifying Attributes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {agent.Status.agent_description.identifying_attributes.map((attr, index) => (
                    <div key={index} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{attr.key}</span>
                      <span className="font-medium">{attr.value.Value.StringValue}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Non-Identifying Attributes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {agent.Status.agent_description.non_identifying_attributes.map((attr, index) => (
                    <div key={index} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{attr.key}</span>
                      <span className="font-medium">{attr.value.Value.StringValue}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
            <CardHeader>
              <CardTitle className="text-base">Component Health Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(agent.Status.health.component_health_map || {}).map(([component, health]) => (
                  <div key={component} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-3">
                      <div className={`h-2 w-2 rounded-full ${health.healthy ? "bg-green-500" : "bg-red-500"}`} />
                      <span className="font-medium text-sm">{component}</span>
                    </div>
                    <Badge variant={health.healthy ? "default" : "destructive"}>{health.status}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          </div>
        </TabsContent>

        <TabsContent value="config" className="space-y-4 grow">
          <YAMLDiagramVisualizer
            agent={agent}
            onChange={() => {}}
            instanceId={agent.InstanceIdStr}
            fetchAgentInfo={fetchAgentInfo}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
