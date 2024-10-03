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

function PromptUsageType() {
	return (
		<Tabs defaultValue="python" className="w-full flex flex-col gap-4">
			<div className="grid grid-cols-4">
				<TabsList className="col-span-2 grid w-auto grid-cols-2">
					<TabsTrigger value="python">Python</TabsTrigger>
					<TabsTrigger value="typescript">Typescript</TabsTrigger>
				</TabsList>
				<div className="col-start-4">
					<Link href="/api-keys">
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
							Copy the code and update the options and go prompting.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2">
						<CodeBlock
							className="text-xs"
							code={`pip install openlit`}
							language="bash"
						/>
					</CardContent>
				</Card>
			</TabsContent>
			<TabsContent value="typescript">
				<Card>
					<CardHeader>
						<CardDescription>
							Copy the code and update the options and go prompting.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2">
						<CodeBlock
							className="text-xs"
							code={`
const response = await Openlit.getPrompts({
  name: "prompt_name",
  compile: true,
  variables: {
    name: "John",
  }
});
              `}
							language="bash"
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
		key: "openlitUrl",
		description:
			"The sdk uses this key to look for openlit url else picks OPENLIT_URL from the environment variable and defaults to http://127.0.0.1:3000. This is optional.",
	},
	{
		key: "name",
		description:
			"This key is used to fetch unique prompt by name. This is optional. You can use either id or name.",
	},
	{
		key: "promptId",
		description:
			"This key is used to fetch unique prompt by id. This is optional. You can use either id or name.",
	},
	{
		key: "version",
		description:
			"This key is used to fetch specific version. This is optional.",
	},
	{
		key: "compile",
		description:
			"This key is used to fetch prompt compiled with passed variables. This is optional. ",
	},
	{
		key: "variables",
		description:
			"This key is used to pass variables to compile prompt. This is optional. ",
	},
	{
		key: "metaProperties",
		description:
			"This key is used to pass meta properties to store in meta data of prompt access history. This is optional. ",
	},
];

export default function PromptUsage() {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button
					variant="outline"
					className="px-8 h-auto py-1 rounded-sm mr-6 dark:text-stone-300"
				>
					How to use prompts ?
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-4xl h-[80%]">
				<DialogHeader>
					<DialogTitle className="dark:text-stone-200 text-stone-800">
						Want to use prompts in your application?
					</DialogTitle>
					<DialogDescription>
						Create your prompts in the Openlit UI and use them via our sdks.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col w-full overflow-y-auto py-2 gap-6">
					<PromptUsageType />
					<h2 className="text-stone-700 dark:text-stone-300">Options</h2>
					<TableData
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
