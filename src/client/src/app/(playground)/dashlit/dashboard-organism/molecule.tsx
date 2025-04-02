import { Component } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
interface MoleculeProps {
	molecule: any;
	isEditable: boolean;
	setEditingMolecule: (molecule: any) => void;
}

export default class Molecule extends Component<MoleculeProps> {
	handleEdit = (event: React.MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		this.props.setEditingMolecule(this.props.molecule);
	};
	render() {
		return (
			<Card className="w-full h-full">
				<CardHeader>
					<CardTitle>{this.props.molecule.name || "Molecule"}</CardTitle>
					{this.props.isEditable && (
						<Button
							variant="outline"
							size="icon"
							className="absolute top-0 right-0"
							onClick={this.handleEdit}
						>
							<PencilIcon className="w-4 h-4" />
						</Button>
					)}
				</CardHeader>
			</Card>
		);
	}
}
