import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { dracula } from "react-syntax-highlighter/dist/esm/styles/prism";
import copyToCB from "copy-to-clipboard";
import { Copy } from "lucide-react";
import getMessage from "@/constants/messages";

export default function CodeBlock({
	className = "",
	code,
	copy = true,
	language,
}: {
	className?: string;
	code: string;
	copy?: boolean;
	language: string;
}) {
	const m = getMessage();
	const onClickCopy = () => copyToCB(code);

	return (
		<section className="relative group">
			<SyntaxHighlighter
				language={language}
				style={dracula}
				className={`overflow-hidden ${className}`}
			>
				{code}
			</SyntaxHighlighter>
			{copy && (
				<button
					type="button"
					aria-label={m.COPY_CODE}
					title={m.COPY_CODE}
					className="absolute right-3 top-4 z-10 rounded text-stone-400 opacity-0 hover:text-primary focus-visible:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary group-hover:opacity-100"
					onClick={onClickCopy}
				>
					<Copy className="w-4 h-4" aria-hidden="true" />
				</button>
			)}
		</section>
	);
}
