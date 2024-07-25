import Image from "next/image";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { MouseEventHandler, ReactNode } from "react";
import { providersConfig } from "@/constants/openground";

export default function AddProvider({
	children,
	onClick,
}: {
	children: ReactNode;
	onClick: MouseEventHandler;
}) {
	return (
		<Sheet>
			<SheetTrigger asChild>{children}</SheetTrigger>
			<SheetContent className="max-w-none sm:max-w-none w-1/2 bg-stone-100 dark:bg-stone-900 border-transparent">
				<SheetHeader>
					<SheetTitle>Select Provider</SheetTitle>
				</SheetHeader>
				<div className="h-full w-full flex grow pb-8">
					<div className="flex h-full w-full flex-col">
						<div className="relative py-6 flex-1 flex flex-wrap gap-2 overflow-y-auto justify-center items-start">
							{Object.keys(providersConfig).map((key) => {
								const provider =
									providersConfig[key as keyof typeof providersConfig];
								return (
									<div
										className="flex flex-col h-auto bg-stone-300 dark:bg-stone-500 p-6 rounded text-stone-900 dark:text-stone-200 gap-4 aspect-square justify-center items-center cursor-pointer"
										data-key={key}
										key={key}
										onClick={onClick}
									>
										<Image
											src={provider.logoDark}
											width={100}
											height={20}
											alt={provider.title}
											className="dark:hidden"
										/>
										<Image
											src={provider.logo}
											width={100}
											height={20}
											alt={provider.title}
											className="hidden dark:block"
										/>
										<div className="space-y-1 text-sm">
											<p className="text-xs text-muted-foreground">
												{provider.subTitle}
											</p>
										</div>
									</div>
								);
							})}
						</div>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}
