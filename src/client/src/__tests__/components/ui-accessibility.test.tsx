import { render, screen } from "@testing-library/react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Select, SelectTrigger, SelectValue } from "@/components/ui/select";
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

describe("SelectTrigger accessibility", () => {
	it("renders a visible focus ring for keyboard navigation", () => {
		render(
			<Select>
				<SelectTrigger aria-label="Choose">
					<SelectValue placeholder="Choose" />
				</SelectTrigger>
			</Select>
		);
		const trigger = screen.getByRole("combobox", { name: "Choose" });
		expect(hasAllClasses(trigger, FOCUS_RING_CLASSES)).toBe(true);
		expect(
			hasAllClasses(trigger, [
				"focus-visible:ring-offset-white",
				"dark:focus-visible:ring-offset-stone-950",
			])
		).toBe(true);
		expect(trigger.className).not.toContain("focus:outline-none");
	});
});

describe("Alert destructive variant accessibility", () => {
	it("owns a fill so 14px error text clears WCAG AA on any parent", () => {
		render(
			<Alert variant="destructive">
				<AlertTitle>Error</AlertTitle>
				<AlertDescription>Something went wrong.</AlertDescription>
			</Alert>
		);
		const alert = screen.getByRole("alert");
		// The query debugger sits on stone-100. Transparent red-600 text there
		// is 4.43:1. White + red-700 is 6.47:1; stone-950 + red-400 is 7.14:1.
		expect(
			hasAllClasses(alert, [
				"bg-white",
				"text-red-700",
				"[&>svg]:text-red-700",
				"dark:bg-stone-950",
				"dark:text-red-400",
				"dark:[&>svg]:text-red-400",
			])
		).toBe(true);
		expect(alert.className).not.toContain("dark:text-red-900");
		expect(alert.className).not.toContain("text-red-600");
		expect(alert.className).not.toContain("text-red-500");
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
