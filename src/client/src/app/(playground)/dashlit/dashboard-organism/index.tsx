import { CSSProperties, forwardRef, useState, useEffect } from "react";
import RGL, { Layout, WidthProvider } from "react-grid-layout";

import Molecule from "./molecule";
import { convertLayoutToMolecules } from "./helper";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import map from "lodash/fp/map";
import _, { range } from "lodash";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import FormBuilder from "@/components/common/form-builder";
import { Button } from "@/components/ui/button";

const ReactGridLayout = WidthProvider(RGL);

interface DashboardOrganismProps {
	layout: any;
	isEditable: boolean;
}

interface GridPos {
	x: number;
	y: number;
	w: number;
	h: number;
	static?: boolean;
}

interface MoleculeGridItemProps extends React.HTMLAttributes<HTMLDivElement> {
	gridWidth?: number;
	gridPos?: GridPos;
	isViewing: boolean;
	windowHeight: number;
	windowWidth: number;
	children: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export const GRID_CELL_HEIGHT = 30;
export const GRID_CELL_VMARGIN = 8;
export const GRID_COLUMN_COUNT = 24;

function translateGridHeightToScreenHeight(gridHeight: number): number {
	return (
		gridHeight * (GRID_CELL_HEIGHT + GRID_CELL_VMARGIN) - GRID_CELL_VMARGIN
	);
}

const MoleculeGridItem = forwardRef<HTMLDivElement, MoleculeGridItemProps>(
	(props, ref) => {
		let width = 100;
		let height = 100;

		const {
			gridWidth,
			gridPos,
			isViewing,
			windowHeight,
			windowWidth,
			...divProps
		} = props;
		const style: CSSProperties = props.style ?? {};

		if (isViewing) {
			// In fullscreen view mode a single panel take up full width & 85% height
			width = gridWidth!;
			height = windowHeight * 0.85;
			style.height = height;
			style.width = "100%";
		} else if (windowWidth < 800) {
			// Mobile layout is a bit different, every panel take up full width
			width = props.gridWidth!;
			height = translateGridHeightToScreenHeight(gridPos!.h);
			style.height = height;
			style.width = gridWidth;
		} else {
			// Normal grid layout. The grid framework passes width and height directly to children as style props.
			if (props.style) {
				const { width: styleWidth, height: styleHeight } = props.style;
				if (styleWidth != null) {
					width =
						typeof styleWidth === "number"
							? styleWidth
							: parseFloat(styleWidth);
				}
				if (styleHeight != null) {
					height =
						typeof styleHeight === "number"
							? styleHeight
							: parseFloat(styleHeight);
				}
			}
		}

		// props.children[0] is our main children. RGL adds the drag handle at props.children[1]
		return (
			<div {...divProps} style={{ ...divProps.style }} ref={ref}>
				{/* Pass width and height to children as render props */}
				{props.children}
			</div>
		);
	}
);

const DashboardOrganism = ({
	layout: initialLayout,
	isEditable,
}: DashboardOrganismProps) => {
	const [editingMolecule, setEditingMolecule] = useState<any>(null);
	const [layout, setLayout] = useState<Layout[]>([]);
	const [molecules, setMolecules] = useState<any[]>([]);
	const [windowHeight, setWindowHeight] = useState(1200);
	const [windowWidth, setWindowWidth] = useState(1920);
	const [gridWidth, setGridWidth] = useState(0);

	useEffect(() => {
		const molecules = convertLayoutToMolecules(layout);
		setMolecules(molecules);
	}, [layout]);

	useEffect(() => {
		setLayout(initialLayout);
	}, []);

	const renderMolecules = (width: number) => {
		if (gridWidth !== width) {
			setWindowHeight(window.innerHeight ?? 1000);
			setWindowWidth(window.innerWidth);
			setGridWidth(width);
		}

		return molecules.map((molecule) => {
			return (
				<MoleculeGridItem
					key={molecule.id}
					data-panelid={molecule.id}
					gridPos={molecule.gridPos}
					gridWidth={molecule.w}
					windowHeight={windowHeight}
					windowWidth={windowWidth}
					isViewing={true}
				>
					<Molecule
						key={molecule.id}
						molecule={molecule}
						isEditable={isEditable}
					/>
				</MoleculeGridItem>
			);
		});
	};

	const generateLayout = () => {
		const res: Layout[] = _.map(new Array(layout.length), function (item, i) {
			const y =
				(_.result(layout[i], "y") as number) ||
				Math.ceil(Math.random() * 4) + 1;
			return {
				x: layout[i].x,
				y: layout[i].y,
				w: layout[i].w,
				h: layout[i].h,
				i: layout[i].i,
				resizeHandles: ["se"],
				isDraggable: true,
			};
		});
		return res;
	};

	const generateDOM = () => {
		return _.map(_.range(layout.length), function (i) {
			return (
				<div key={i}>
					<Molecule
						key={layout[i].i}
						molecule={{ name: "Molecule " + i }}
						isEditable={isEditable}
						setEditingMolecule={setEditingMolecule}
					/>
				</div>
			);
		});
	};

	const onLayoutChange = (layout: Layout[]) => {
		// setLayout(layout);
	};

	const addMolecule = () => {
		setLayout([
			...layout,
			{
				x: 0,
				y: Infinity,
				w: 4,
				h: 4,
				i: layout.length.toString(),
			},
		]);
	};

	// TODO: Implement logic to get width, draggable, isEditable, GRID_CELL_VMARGIN, GRID_COLUMN_COUNT, GRID_CELL_HEIGHT
	const width = 800;
	const draggable = true;

	return (
		<>
			<Button onClick={addMolecule}>Add Molecule</Button>
			<ReactGridLayout
				width={width}
				isDraggable={draggable}
				isResizable={isEditable}
				useCSSTransforms={true}
				layout={generateLayout()}
				className="layout"
				rowHeight={30}
				onLayoutChange={onLayoutChange}
				cols={12}
			>
				{generateDOM()}
			</ReactGridLayout>
			<Sheet open={!!editingMolecule} onOpenChange={setEditingMolecule}>
				<SheetContent>
					<FormBuilder
						fields={[]}
						onSubmit={function () {}}
						submitButtonText="Submit"
					/>
				</SheetContent>
			</Sheet>
		</>
	);
};

export default DashboardOrganism;
