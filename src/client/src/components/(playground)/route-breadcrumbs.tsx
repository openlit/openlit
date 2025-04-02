import {
	Breadcrumb,
	BreadcrumbList,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbSeparator,
	BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { usePathname } from "next/navigation";
import React from "react";

const PATH_TO_TITLE_MAP = {
	"/": "Home",
	"/requests": "Request",
	"/exceptions": "Exceptions",
	"/prompt-hub": "Prompts",
	"/vault": "Vault",
	"/openground": "Openground",
	"/settings": "Settings",
	"/dashlit": "Dashlit",
	"/dashlit/board": "Board",
};

export default function RouteBreadcrumbs() {
	const params = usePathname();
	const paths = params.split("/");
	const pathArray: string[] = [];

	return (
		<Breadcrumb className="grow">
			<BreadcrumbList>
				{paths.length > 1
					? paths.map((path, index) => {
							if (path === "") return null;
							pathArray.push(path);
							console.log(pathArray);
							const pathField = `/${pathArray.join("/")}`;
							if (index === paths.length - 1) {
								return (
									<BreadcrumbItem key={pathField}>
										<BreadcrumbPage>
											{PATH_TO_TITLE_MAP[
												pathField as keyof typeof PATH_TO_TITLE_MAP
											] || path}
										</BreadcrumbPage>
									</BreadcrumbItem>
								);
							}
							return (
								<React.Fragment key={pathField}>
									<BreadcrumbItem>
										<BreadcrumbLink href={pathField}>
											{PATH_TO_TITLE_MAP[
												pathField as keyof typeof PATH_TO_TITLE_MAP
											] || path}
										</BreadcrumbLink>
									</BreadcrumbItem>
									<BreadcrumbSeparator />
								</React.Fragment>
							);
					  })
					: null}
			</BreadcrumbList>
		</Breadcrumb>
	);
}
