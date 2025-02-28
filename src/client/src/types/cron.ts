export type Job = {
	cronId: string;
	cronSchedule: string;
	cronEnvVars: Record<string, string>;
	cronScriptPath: string;
	cronLogPath: string;
};

export enum CronRunStatus {
	SUCCESS = "SUCCESS",
	FAILURE = "FAILURE",
}

export enum CronType {
	SPAN_EVALUATION = "SPAN_EVALUATION",
}

export interface CronLogData {
	cronId: string;
	cronType: CronType;
	runStatus: CronRunStatus;
	metaProperties?: Record<string, any>;
	errorStacktrace?: string;
	startedAt: Date;
	finishedAt: Date;
	duration: number;
}

export interface GetCronLogsParams {
	page?: number;
	limit?: number;
	cronId?: string;
	cronType?: string;
	runStatus?: "success" | "failure";
	startDate?: Date;
	endDate?: Date;
}
