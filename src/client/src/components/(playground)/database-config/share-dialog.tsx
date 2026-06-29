import { CornerDownLeft, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MouseEventHandler, useRef, useState } from "react";
import { toast } from "sonner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { set } from "lodash";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { DatabaseConfigPermissions } from "@/constants/dbConfig";
import { escapeEmailForDisplay } from "@/utils/string";
import getMessage from "@/constants/messages";

const validateEmail = (email: string) => {
	return String(email)
		.toLowerCase()
		.match(
			/^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|.(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
		);
};

export default function ShareDialog({
	id,
	permissions,
}: {
	id: string;
	permissions: DatabaseConfigPermissions;
}) {
	const [shareArray, setShareArray] = useState<
		{
			email: string;
			permissions: { canDelete: boolean; canEdit: boolean; canShare: boolean };
		}[]
	>([]);
	const { fireRequest, isLoading } = useFetchWrapper();
	const messages = getMessage();

	const emailRef = useRef<HTMLInputElement>(null);

	const onEnterEmail = () => {
		if (!emailRef.current) return;
		const emailValue = emailRef.current.value || "";
		const doesEmailAlreadyExist = shareArray.find(
			(s) => s.email === emailValue
		);
		if (validateEmail(emailValue) && !doesEmailAlreadyExist) {
			setShareArray((e) => [
				...e,
				{
					email: emailValue,
					permissions: { canDelete: false, canEdit: false, canShare: false },
				},
			]);
			emailRef.current.value = "";
			return;
		}

		toast.error(messages.EMAIL_INVALID, {
			id: "share-db-config",
		});
	};

	const onChangePermission = (path: string, value: boolean) => {
		setShareArray((e) => [...set(e, path, value)]);
	};

	const resetData = () => {
		setShareArray([]);
	};

	const shareRequest = () => {
		if (isLoading) return;
		fireRequest({
			body: JSON.stringify({ shareArray, id }),
			requestType: "POST",
			url: "/api/db-config/share",
			responseDataKey: "data",
			successCb: () => {
				toast.success(messages.DB_CONFIG_SHARED, {
					id: "share-db-config",
				});
				resetData();
			},
			failureCb: (err?: string) => {
				toast.error(err || messages.DB_CONFIG_SHARE_FAILED, {
					id: "db-config-details",
				});
			},
		});
	};

	const onClickDelete: MouseEventHandler<HTMLElement> = (event) => {
		event.stopPropagation();
	};

	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					resetData();
				}
			}}
		>
			<DialogTrigger asChild onClick={onClickDelete}>
				<Share2 className="w-3 h-3 hidden group-hover:inline text-stone-900 dark:text-stone-100" />
			</DialogTrigger>
			<DialogContent className="">
				<DialogHeader>
					<DialogTitle>{messages.SHARE_DATABASE_CONFIG}</DialogTitle>
					<DialogDescription>
						{messages.SHARE_DATABASE_CONFIG_DESCRIPTION}
					</DialogDescription>
				</DialogHeader>
				<div className="flex items-center space-x-2">
					<Input
						id="email"
						name="email"
						className="dark:text-stone-200"
						placeholder={messages.ADD_EMAIL_PLACEHOLDER}
						ref={emailRef}
					/>
					<Button
						type="submit"
						size="sm"
						className="px-3"
						onClick={onEnterEmail}
					>
						<span className="sr-only">{messages.ENTER}</span>
						<CornerDownLeft className="h-4 w-4" />
					</Button>
				</div>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{messages.EMAIL}</TableHead>
							<TableHead className="text-center">{messages.EDIT}</TableHead>
							<TableHead className="text-center">{messages.DELETE}</TableHead>
							<TableHead className="text-center">{messages.SHARE}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{shareArray.map((shareObj, index) => (
							<TableRow key={shareObj.email}>
								<TableCell className="font-medium text-stone-500">
									{escapeEmailForDisplay(shareObj.email)}
								</TableCell>
								<TableCell className="text-center p-0">
									<Checkbox
										name={`share-${index}.permission.canEdit`}
										checked={shareObj.permissions.canEdit}
										onCheckedChange={(checked: boolean) =>
											onChangePermission(
												`[${index}].permissions.canEdit`,
												checked
											)
										}
										disabled={!permissions.canEdit}
									/>
								</TableCell>
								<TableCell className="text-center p-0">
									<Checkbox
										name={`share-${index}.permission.canDelete`}
										checked={shareObj.permissions.canDelete}
										onCheckedChange={(checked: boolean) =>
											onChangePermission(
												`[${index}].permissions.canDelete`,
												checked
											)
										}
										disabled={!permissions.canDelete}
									/>
								</TableCell>
								<TableCell className="text-center p-0">
									<Checkbox
										name={`share-${index}.permission.canShare`}
										checked={shareObj.permissions.canShare}
										onCheckedChange={(checked: boolean) =>
											onChangePermission(
												`[${index}].permissions.canShare`,
												checked
											)
										}
										disabled={!permissions.canShare}
									/>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
				<DialogFooter className="justify-end">
					<Button type="button" variant="default" onClick={shareRequest}>
						{messages.SHARE}
					</Button>
					<DialogClose asChild>
						<Button type="button" variant="secondary">
							{messages.CLOSE}
						</Button>
					</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
