import CodeBlock from "@/components/common/code-block";
import TableData from "@/components/common/table-data";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";

function VaultUsageType() {
	return (
		<Tabs defaultValue="python" className="w-full flex flex-col gap-4">
			<div className="grid grid-cols-4">
				<TabsList className="col-span-2 grid w-auto grid-cols-2">
					<TabsTrigger value="python">Python</TabsTrigger>
					<TabsTrigger value="typescript">Typescript</TabsTrigger>
				</TabsList>
				<div className="col-start-4">
					<Link href="/settings/api-keys">
						<Button variant="outline" className="w-full">
							Get API Key
						</Button>
					</Link>
				</div>
			</div>
			<TabsContent value="python">
				<Card>
					<CardHeader>
						<CardDescription>
							Copy the code and update the options and use Vault.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2">
						<CodeBlock
							className="text-xs"
							code={`
from openlit import Openlit  # Import the Openlit SDK

response = openlit.get_prompt(
	name="prompt_name",         # Fetch the prompt by name
	should_compile=True,               # Compile the prompt with provided variables
	variables={
		"name": "John",           # Pass variables for prompt compilation
	}
)

print(response)               # Print or process the fetched and compiled prompt
							`}
							language="python"
						/>
					</CardContent>
				</Card>
			</TabsContent>
			<TabsContent value="typescript">
				<Card>
					<CardHeader>
						<CardDescription>
							Copy the code and update the options and use Vault.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2">
						<CodeBlock
							className="text-xs"
							code={`
const response = await Openlit.getSecrets({
  shouldSetEnv: true,
}); // This sets all the stored secrets in the process.env object.
              `}
							language="typescript"
						/>
					</CardContent>
				</Card>
			</TabsContent>
		</Tabs>
	);
}

const columns = [
	{
		key: "key",
		className: "col-span-4",
		header: "Key",
	},
	{
		key: "description",
		className: "col-span-8",
		header: "Description",
	},
];

const data = [
	{
		key: "url",
		description:
			"The sdk uses this key to look for openlit url else picks OPENLIT_URL from the environment variable and defaults to http://127.0.0.1:3000. This is optional.",
	},
	{
		key: "apiKey",
		description:
			"Sets the OpenLIT API Key. Can also be provided via the `OPENLIT_API_KEY` environment variable.",
	},
	{
		key: "key",
		description: "This is used to fetch secret by key. This is optional.",
	},
	{
		key: "tags",
		description:
			"This is used to fetch secrets matching the assigned tags. This is optional. ",
	},
	{
		key: "shouldSetEnv",
		description:
			"This key is used to set the secrets as environment variables. This is optional. ",
	},
];

export default function VaultUsage() {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button
					variant="outline"
					className="px-8 h-auto py-1 rounded-sm mr-6 dark:text-stone-300"
				>
					How to use vault ?
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-4xl h-[80%]">
				<DialogHeader>
					<DialogTitle className="dark:text-stone-200 text-stone-800">
						Want to use vault in your application?
					</DialogTitle>
					<DialogDescription>
						Create your secrets in the Openlit UI and use them via our sdks.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col w-full overflow-y-auto py-2 gap-6">
					<VaultUsageType />
					<h2 className="text-stone-700 dark:text-stone-300">Options</h2>
					<TableData
						className="overflow-visible rounded-none"
						columns={columns}
						data={data}
						isFetched
						isLoading={false}
						idKey="key"
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}
