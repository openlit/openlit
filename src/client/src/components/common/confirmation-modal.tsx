import { Button } from "@/components/ui/button";
import getMessage from "@/constants/messages";
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

type ConfirmationModalProps = {
	title: string;
	subtitle: string;
	children: JSX.Element;
	handleYes: (p?: any) => void;
	handleNo?: () => void;
	params?: any;
	/** Defaults to the shared confirm/cancel messages. */
	confirmLabel?: string;
	cancelLabel?: string;
};

export default function ConfirmationModal(props: ConfirmationModalProps) {
	return (
		<Dialog>
			<DialogTrigger asChild>{props.children}</DialogTrigger>
			<DialogContent className="">
				<DialogHeader>
					<DialogTitle>{props.title}</DialogTitle>
					<DialogDescription>{props.subtitle}</DialogDescription>
				</DialogHeader>
				<DialogFooter className="justify-end">
					<DialogClose asChild>
						<Button variant="secondary" onClick={props.handleNo}>
							{props.cancelLabel ?? getMessage().CONFIRMATION_CANCEL}
						</Button>
					</DialogClose>

					<DialogClose asChild>
						<Button
							variant="default"
							onClick={() => props.handleYes(props.params)}
						>
							{props.confirmLabel ?? getMessage().CONFIRMATION_CONFIRM}
						</Button>
					</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
