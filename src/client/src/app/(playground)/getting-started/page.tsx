"use client";
import CodeBlock from "@/components/common/code-block";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function GettingStarted() {
	const code = [
		{
			key: "python",
			text: "Python",
			component: (
				<div className="flex flex-col text-sm rounded-b-lg p-3 text-stone-950 dark:text-stone-100">
					<p>
						Install the{" "}
						<a
							href="https://pypi.org/project/dokumetry/"
							className="text-primary/[0.7] hover:text-primary italic px-1"
						>
							dokumetry
						</a>{" "}
						python sdk using pip:
					</p>
					<CodeBlock
						className="text-xs"
						code={`pip install dokumetry`}
						language="bash"
					/>
					<p className="mt-2">
						Add the following two lines to your application code:
					</p>
					<CodeBlock
						className="text-xs"
						code={`import dokumetry
dokumetry.init(llm=client, doku_url="YOUR_DOKU_INGESTER_URL", api_key="YOUR_DOKU_TOKEN")`}
						language="python"
					/>
					<p className="mt-2">
						Example Usage for monitoring{" "}
						<a
							className="text-primary/[0.7] hover:text-primary italic px-1"
							href="https://platform.openai.com/docs/introduction"
						>
							OpenAI
						</a>{" "}
						Usage:
					</p>
					<CodeBlock
						className="text-xs"
						code={`from openai import OpenAI
import dokumetry

client = OpenAI(
    api_key="YOUR_OPENAI_KEY"
)

# Pass the above \`client\` object along with your Doku Ingester URL and API key and this will make sure that all OpenAI calls are automatically tracked.
dokumetry.init(llm=client, doku_url="YOUR_DOKU_INGESTER_URL", api_key="YOUR_DOKU_TOKEN")

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
							className="text-primary/[0.7] hover:text-primary italic px-1"
							href="https://github.com/dokulabs/dokumetry-python"
						>
							dokumetry python sdk
						</a>{" "}
						repository for more advanced configurations and use cases.
					</p>
				</div>
			),
		},
		{
			key: "node",
			text: "NodeJs",
			component: (
				<div className="flex flex-col text-sm rounded-b-lg p-3 text-stone-950 dark:text-stone-100">
					<p>
						Install the{" "}
						<a
							href="https://www.npmjs.com/package/dokumetry"
							className="text-primary/[0.7] hover:text-primary italic px-1"
						>
							dokumetry
						</a>{" "}
						nodejs sdk using npm:
					</p>
					<CodeBlock
						className="text-xs"
						code={`npm install dokumetry`}
						language="bash"
					/>
					<p className="mt-2">
						Add the following two lines to your application code:
					</p>
					<CodeBlock
						className="text-xs"
						code={`import DokuMetry from "dokumetry";
DokuMetry.init({llm: openai, dokuUrl: "YOUR_DOKU_INGESTER_URL", apiKey: "YOUR_DOKU_TOKEN"});`}
						language="javascript"
					/>
					<p className="mt-2">
						Example Usage for monitoring{" "}
						<a
							className="text-primary/[0.7] hover:text-primary italic px-1"
							href="https://platform.openai.com/docs/introduction"
						>
							OpenAI
						</a>{" "}
						Usage:
					</p>
					<CodeBlock
						className="text-xs"
						code={`import OpenAI from "openai";
import DokuMetry from "dokumetry";

const openai = new OpenAI({
  apiKey: "My API Key", // defaults to process.env["OPENAI_API_KEY"]
});

// Pass the above \`openai\` object along with your Doku Ingester URL and API key and this will make sure that all OpenAI calls are automatically tracked.
DokuMetry.init({llm: openai, dokuUrl: "YOUR_DOKU_INGESTER_URL", apiKey: "YOUR_DOKU_TOKEN"})

async function main() {
  const chatCompletion = await openai.chat.completions.create({
    messages: [{ role: "user", content: "What are the key to effective observability?" }],
    model: "gpt-3.5-turbo",
  });
}

main();`}
						language="javascript"
					/>
					<p className="mt-2">
						Refer to the{" "}
						<a
							className="text-primary/[0.7] hover:text-primary italic px-1"
							href="https://github.com/dokulabs/dokumetry-node"
						>
							dokumetry nodejs sdk
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
				Doku is an open-source observability tool engineered for Large Language
				Models (LLMs). Designed for ease of integration into existing LLM
				applications, Doku offers unparalleled insights into usage, performance,
				and overhead—allowing you to analyze, optimize, and scale your AI
				applications and LLM usage effectively.
			</p>
			<p className="mb-5 text-stone-950 dark:text-stone-100 text-sm">
				With the <span className="text-primary">dokumetry</span> SDKs for
				<a
					href="https://pypi.org/project/dokumetry/"
					className="text-primary/[0.7] hover:text-primary italic px-1"
				>
					Python
				</a>{" "}
				and{" "}
				<a
					href="https://www.npmjs.com/package/dokumetry"
					className="text-primary/[0.7] hover:text-primary italic px-1"
				>
					NodeJS
				</a>{" "}
				, sending observability data to Doku is just two lines of code in your
				application. Once integrated, the SDKs take care of capturing and
				conveying LLM usage data directly to your Doku instance, requiring
				minimal effort on your part.
			</p>
			<Tabs className="w-full" defaultValue={code[0].key}>
				<TabsList>
					{code.map((item) => (
						<TabsTrigger key={item.key} value={item.key}>
							{item.text}
						</TabsTrigger>
					))}
				</TabsList>
				{code.map((item) => (
					<TabsContent key={item.key} value={item.key} className="w-full">
						{item.component}
					</TabsContent>
				))}
			</Tabs>
		</div>
	);
}
