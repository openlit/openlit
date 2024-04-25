"use client";
import CodeBlock from "@/components/common/code-block";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function GettingStarted() {
	const code = [
		{
			key: "python",
			text: "Python",
			component: (
				<div className="flex flex-col text-sm rounded-b-lg text-stone-950 dark:text-stone-100">
					<p>
						Install the{" "}
						<a
							className="text-primary italic px-1"
							href="https://platform.openai.com/docs/introduction"
							target="_blank"
							rel="noopener noreferrer"
						>
							OpenLIT Python SDK
						</a>{" "}
						using pip
					</p>
					<CodeBlock
						className="text-xs"
						code={`pip install openlit`}
						language="bash"
					/>
					<p className="mt-2">
						Add the following two lines to your application code:
					</p>
					<CodeBlock
						className="text-xs"
						code={`openlit.init(
	otlp_endpoint="YOUR_OTEL_EXPORTER_OTLP_ENDPOINT"
)`}
						language="python"
					/>
					<p>
						Alternatively, You can also choose to set these values using{" "}
						<span className="text-primary italic px-1">
							OTEL_EXPORTER_OTLP_ENDPOINT
						</span>{" "}
						environment variable
					</p>
					<CodeBlock
						className="text-xs"
						code={`openlit.init()`}
						language="python"
					/>
					<CodeBlock
						className="text-xs"
						code={`export OTEL_EXPORTER_OTLP_ENDPOINT = "YOUR_OTEL_EXPORTER_OTLP_ENDPOINT"`}
						language="python"
					/>

					<p className="mt-2">
						Example Usage for monitoring{" "}
						<a
							className="text-primary italic px-1"
							href="https://platform.openai.com/docs/introduction"
							target="_blank"
							rel="noopener noreferrer"
						>
							OpenAI
						</a>{" "}
						Usage:
					</p>
					<CodeBlock
						className="text-xs"
						code={`from openai import OpenAI
import openlit

openlit.init()

client = OpenAI(
	api_key="YOUR_OPENAI_KEY"
)

chat_completion = client.chat.completions.create(
	messages=[
		{
			"role": "user",
			"content": "What is LLM Observability",
		}
	],
	model="gpt-3.5-turbo",
)`}
						language="python"
					/>
					<p className="mt-2">
						Refer to the{" "}
						<a
							className="text-primary italic px-1"
							href="https://github.com/openlit/openlit/tree/main/sdk/python"
							target="_blank"
							rel="noopener noreferrer"
						>
							OpenLIT Python SDK
						</a>{" "}
						repository for more advanced configurations and use cases.
					</p>
				</div>
			),
		},
	];

	return (
		<div className="flex flex-col w-full flex-1 overflow-auto relative">
			<p className="mb-5 text-sm font-medium border-l-4 border-primary p-3 text-primary bg-red-50 dark:bg-red-950">
				OpenLIT is an OpenTelemetry-native GenAI and LLM Application
				Observability tool. It&apos;s designed to make the integration process
				of observability into GenAI projects as easy as pie – literally, with
				just a single line of code. Whether you&apos;re working with popular LLM
				Libraries such as OpenAI and HuggingFace or leveraging vector databases
				like ChromaDB, OpenLIT ensures your applications are monitored
				seamlessly, providing critical insights to improve performance and
				reliability.
			</p>
			<p className="mb-5 text-stone-950 dark:text-stone-100 text-sm">
				This guide will walk you through setting up{" "}
				<span className="text-primary">OpenTelemetry</span> Auto Instrumentation
				for monitoring your LLM Application. In just a few steps, you’ll be able
				to track and analyze the performance and usage of your{" "}
				<span className="text-primary">GenAI</span> and{" "}
				<span className="text-primary">LLM Applications</span>. In this guide,
				we’ll show how you can send OpenTelemetry traces and metrics from your
				LLM Applications to Grafana Cloud
			</p>
			<Tabs className="w-full" defaultValue={code[0].key}>
				{/* <TabsList>
					{code.map((item) => (
						<TabsTrigger key={item.key} value={item.key}>
							{item.text}
						</TabsTrigger>
					))}
				</TabsList> */}
				{code.map((item) => (
					<TabsContent key={item.key} value={item.key} className="w-full">
						{item.component}
					</TabsContent>
				))}
			</Tabs>
		</div>
	);
}
