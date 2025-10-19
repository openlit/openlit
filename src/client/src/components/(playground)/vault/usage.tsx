import { Button } from "@/components/ui/button";
import documentationLinks from "@/constants/documentation-links";
import { BookText } from "lucide-react";
import Link from "next/link";

export default function VaultUsage() {
	return (
		<div className="flex">
			<Link href={documentationLinks.vault} target="_blank" rel="noopener noreferrer">
				<Button variant="outline" className="flex gap-2 px-8 h-9 py-1 rounded-md font-normal text-stone-600">	
					<BookText className="w-4 h-4" />
					Vault documentation
				</Button>
			</Link>
		</div>
	);
}
