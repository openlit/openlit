import { dataCollector } from "./common";

export async function pingClickhouse() {
	const data = await  dataCollector({}, "ping");
	return data;
}
