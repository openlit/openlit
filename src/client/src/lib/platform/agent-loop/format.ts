import getMessage from "@/constants/messages";
import {
	asFiniteNumber,
	fillTemplate,
} from "@/lib/platform/generation-health/format";
import { AGENT_LOOP_THRESHOLD, type AgentLoopHit } from "./classify";

export { asFiniteNumber, fillTemplate };

export function agentLoopCountLine(count: number, eligible: number): string {
	const m = getMessage();
	const safeCount = asFiniteNumber(count);
	const safeEligible = asFiniteNumber(eligible);
	if (safeEligible <= 0) return m.AGENT_LOOP_TIP_NO_ELIGIBLE;
	if (safeCount <= 0) {
		return fillTemplate(m.AGENT_LOOP_TIP_NONE, { eligible: safeEligible });
	}
	return fillTemplate(m.AGENT_LOOP_TIP_COUNT, {
		count: safeCount,
		eligible: safeEligible,
	});
}

export function agentLoopBadgeTitle(hit: AgentLoopHit): string {
	return fillTemplate(getMessage().AGENT_LOOP_BADGE_TITLE, {
		tool: hit.toolName,
		count: asFiniteNumber(hit.count),
	});
}

export function agentLoopDetailLine(hit: AgentLoopHit): string {
	return fillTemplate(getMessage().AGENT_LOOP_DETAIL, {
		tool: hit.toolName,
		count: asFiniteNumber(hit.count),
		tokens: Math.round(asFiniteNumber(hit.wastedTokens)),
		cost: asFiniteNumber(hit.wastedCost).toFixed(4),
	});
}

export function agentLoopTipMeaning(): string {
	return fillTemplate(getMessage().AGENT_LOOP_TIP, {
		threshold: AGENT_LOOP_THRESHOLD,
	});
}
