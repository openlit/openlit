import { render, screen } from "@testing-library/react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// Focus-visible ring classes applied consistently across form controls and
// interactive primitives so keyboard users can identify focus.
const FOCUS_RING_CLASSES = [
	"focus-visible:outline-none",
	"focus-visible:ring-2",
	"focus-visible:ring-stone-950",
	"focus-visible:ring-offset-2",
	"dark:focus-visible:ring-stone-300",
];

function hasAllClasses(el: HTMLElement, classes: string[]): boolean {
	return classes.every((cls) => el.classList.contains(cls));
}

describe("Input accessibility", () => {
	it("renders a visible focus ring for keyboard navigation", () => {
		render(<Input placeholder="test" />);
		const input = screen.getByPlaceholderText("test");
		expect(hasAllClasses(input, FOCUS_RING_CLASSES)).toBe(true);
	});
});

describe("Textarea accessibility", () => {
	it("renders a visible focus ring for keyboard navigation", () => {
		render(<Textarea placeholder="test" />);
		const textarea = screen.getByPlaceholderText("test");
		expect(hasAllClasses(textarea, FOCUS_RING_CLASSES)).toBe(true);
	});
});

describe("TabsTrigger accessibility", () => {
	it("renders a visible focus ring for keyboard navigation", () => {
		render(
			<Tabs defaultValue="a">
				<TabsList>
					<TabsTrigger value="a">Tab A</TabsTrigger>
				</TabsList>
				<TabsContent value="a">Content A</TabsContent>
			</Tabs>
		);
		const trigger = screen.getByRole("tab", { name: "Tab A" });
		expect(hasAllClasses(trigger, FOCUS_RING_CLASSES)).toBe(true);
	});
});

describe("Alert destructive variant accessibility", () => {
	it("uses a bright red text class visible on dark backgrounds", () => {
		render(
			<Alert variant="destructive">
				<AlertTitle>Error</AlertTitle>
				<AlertDescription>Something went wrong.</AlertDescription>
			</Alert>
		);
		const alert = screen.getByRole("alert");
		// dark:text-red-400 provides sufficient contrast on dark backgrounds;
		// the old dark:text-red-900 was near-invisible.
		expect(alert.className).toContain("dark:text-red-400");
		expect(alert.className).not.toContain("dark:text-red-900");
	});

	it("does not contain the invalid dark:dark: duplicate class", () => {
		render(
			<Alert variant="destructive">
				<AlertDescription>Error details.</AlertDescription>
			</Alert>
		);
		const alert = screen.getByRole("alert");
		expect(alert.className).not.toContain("dark:dark:");
	});
});
