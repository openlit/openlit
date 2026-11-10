"use client";

import AlertDetail from "./alert-detail";
import ThresholdAlertForm from "./threshold-alert-form";

// Entry points for the Alerts routes. OpenLIT has one alert type, so these
// render the threshold alert views directly. The enterprise overlay replaces
// this file to route between threshold alerts and event alerts.

export function NewAlertEntry() {
	return <ThresholdAlertForm />;
}

export function EditAlertEntry({ alertId }: { alertId: string }) {
	return <ThresholdAlertForm alertId={alertId} />;
}

export function AlertDetailEntry({ alertId }: { alertId: string }) {
	return <AlertDetail alertId={alertId} />;
}
