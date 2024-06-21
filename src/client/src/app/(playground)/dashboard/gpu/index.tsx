import GPUMetric from "./gpu-metric";

export default function GPUDashboard() {
	return (
		<div className="grid-cols-2 grid gap-4">
			<GPUMetric gpu_type="memory.available" title="Memory Available (MB)" />
			<GPUMetric gpu_type="memory.total" title="Memory total (MB)" />
			<GPUMetric gpu_type="memory.used" title="Memory Used (MB)" />
			<GPUMetric gpu_type="memory.free" title="Memory Free (MB)" />
			<GPUMetric gpu_type="power.draw" title="Power Draw (Watt)" />
			<GPUMetric gpu_type="power.limit" title="Power Limit (Watt)" />
			<GPUMetric gpu_type="temperature" title="Temperature (Celcius)" />
			<GPUMetric gpu_type="fan_speed" title="Fan speed (0-100)" />
			<GPUMetric
				gpu_type="utilization_percentage"
				title="Utilization Percentage (%)"
			/>
			<GPUMetric
				gpu_type="enc.utilization_percentage"
				title="Encoder Utilization Percentage (%)"
			/>
			<GPUMetric
				gpu_type="dec.utilization_percentage"
				title="Decoder Utilization Percentage (%)"
			/>
		</div>
	);
}
