import { notFound } from "next/navigation";
import { isControllerProductEnabled } from "@/lib/platform/controller/product";

export default function ControllerInstanceLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	if (!isControllerProductEnabled()) {
		notFound();
	}
	return children;
}
